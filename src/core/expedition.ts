/**
 * 원정 파이프라인 (GDD §5, TECH.md §4) — 생성·정산 전 과정.
 * 결정론: 같은 (seed, choices, save 상태)면 언제 어디서 계산해도 같은 일지가 나온다.
 */
import type { Content } from '../content';
import type { ArtifactRarity, CrossroadEvent, Region, Reward, Tier } from '../content/schema';
import { captureChance, shouldUseLure } from './capture';
import { computePartyPower, enemyPower, partyDamageReduce, resolveClash } from './combat';
import {
  RARITY_ORDER,
  collectTeamEffects,
  findArtifact,
  findMonster,
  query,
  sumDamageReduce,
  sumOf,
  sumRewardMult,
  type ActiveEffect,
  type EffectCtx,
} from './effects';
import { clamp } from './formulas';
import { isRegionUnlocked, teamCount } from './progression';
import { pickWeighted, randInt, streamRng, type Rng } from './rng';
import { settleTasks, type TaskCompletion } from './tasks';
import {
  GameError,
  type ActiveExpedition,
  type CoreCtx,
  type CrossroadChoice,
  type DroppedArtifact,
  type GrantedReward,
  type Journal,
  type JournalEntry,
  type SaveState,
} from './types';

// ── 파견 생성 ────────────────────────────────────────────────────────────────

export interface ExpeditionInput {
  regionId: string;
  tier: Tier;
  partyIds: string[]; // monsterId — 종 단위 편성
  artifactUids: string[];
  teamId?: string; // 파견한 군 (표시·재파견 잠금용 — 2026-08-23)
}

export function createExpedition(
  content: Content,
  save: SaveState,
  input: ExpeditionInput,
  ctx: CoreCtx,
): { save: SaveState; expedition: ActiveExpedition } {
  const region = content.regions.get(input.regionId);
  if (!region) throw new GameError('region-missing', `없는 지역: ${input.regionId}`);
  if (!isRegionUnlocked(content, save, region.id)) throw new GameError('region-locked', `${region.name}은(는) 아직 잠겨 있습니다`);

  const running = save.expeditions.filter((e) => !e.claimed);
  if (running.length >= teamCount(content, save)) {
    throw new GameError('team-limit', '동시에 보낼 수 있는 원정대가 가득 찼습니다');
  }
  if (input.teamId && running.some((e) => e.teamId === input.teamId)) {
    throw new GameError('team-busy', '이 군은 이미 원정 중입니다');
  }

  if (input.partyIds.length < 1) throw new GameError('party-empty', '파티가 비어 있습니다');
  if (input.partyIds.length > save.profile.partySlots) {
    throw new GameError('party-too-big', `파티 슬롯은 ${save.profile.partySlots}칸입니다`);
  }
  if (new Set(input.partyIds).size !== input.partyIds.length) {
    throw new GameError('party-dup', '같은 몬스터를 두 번 편성할 수 없습니다');
  }
  // 종 카드 수 기반 배타 (2026-08-23 군 시스템) — 카드 2장이면 두 원정에 동시 파견 가능
  const runningUse = new Map<string, number>();
  for (const monsterId of running.flatMap((e) => e.partyIds)) {
    runningUse.set(monsterId, (runningUse.get(monsterId) ?? 0) + 1);
  }
  for (const monsterId of input.partyIds) {
    const owned = findMonster(save, monsterId);
    if ((runningUse.get(monsterId) ?? 0) + 1 > owned.count) {
      throw new GameError('monster-busy', '이미 원정 중인 몬스터입니다 (카드가 더 있으면 동시 파견 가능)');
    }
  }

  if (input.artifactUids.length > 4) throw new GameError('artifact-too-many', '유물은 4개까지 장착할 수 있습니다');
  if (new Set(input.artifactUids).size !== input.artifactUids.length) {
    throw new GameError('artifact-dup', '같은 유물을 두 번 장착할 수 없습니다');
  }
  const lockedArtifacts = new Set(running.flatMap((e) => e.artifactUids));
  const usedSlots = new Set<string>();
  for (const uid of input.artifactUids) {
    const owned = findArtifact(save, uid);
    if (lockedArtifacts.has(uid)) throw new GameError('artifact-busy', '이미 원정 중인 팀이 장착한 유물입니다');
    const def = content.artifacts.get(owned.itemId);
    if (!def) throw new GameError('artifact-def-missing', `콘텐츠에 없는 유물: ${owned.itemId}`);
    if (usedSlots.has(def.slot)) throw new GameError('artifact-slot-dup', '같은 슬롯의 유물을 두 개 장착할 수 없습니다');
    usedSlots.add(def.slot);
  }

  const tierDef = content.balance.tiers[input.tier];
  const { effects } = collectTeamEffects(content, save, input.partyIds, input.artifactUids);
  const setupActions = query(effects, 'expeditionSetup', { regionId: region.id, tier: input.tier });
  let timeMult = 1;
  for (const action of setupActions) {
    if (action.kind === 'timeMult') timeMult *= action.value;
  }
  timeMult = Math.max(timeMult, content.balance.artifacts.effectCaps.timeMultMin);

  const now = ctx.now();
  const luresLoaded = Math.min(content.balance.lures.maxLoad, save.wallet.lures);
  const expedition: ActiveExpedition = {
    id: ctx.newUid(),
    regionId: region.id,
    tier: input.tier,
    teamId: input.teamId,
    partyIds: [...input.partyIds],
    artifactUids: [...input.artifactUids],
    seed: ctx.newSeed(),
    startedAt: now,
    endsAt: now + Math.round(tierDef.minutes * 60_000 * timeMult),
    luresLoaded,
    choices: Array.from({ length: tierDef.crossroads }, () => null),
    claimed: false,
  };

  const next = structuredClone(save);
  next.wallet.lures -= luresLoaded;
  next.expeditions.push(expedition);
  // 최고 유효 전투력 기록 — 랭킹 전투력 카테고리 (GDD §9.3)
  const party = input.partyIds.map((id) => save.roster.find((m) => m.monsterId === id)!);
  const power = computePartyPower(content, effects, party, region, input.tier).total;
  next.stats.bestPower = Math.max(next.stats.bestPower, Math.round(power));
  return { save: next, expedition };
}

/** 갈림길 선택 기록 (파견 중 접속 시 미리, 또는 정산 직전 일괄) */
export function chooseCrossroad(save: SaveState, expeditionId: string, index: number, choice: CrossroadChoice): SaveState {
  const next = structuredClone(save);
  const expedition = next.expeditions.find((e) => e.id === expeditionId && !e.claimed);
  if (!expedition) throw new GameError('expedition-missing', '진행 중인 원정이 아닙니다');
  if (index < 0 || index >= expedition.choices.length) throw new GameError('crossroad-index', '잘못된 갈림길 번호입니다');
  expedition.choices[index] = choice;
  return next;
}

// ── 조우 계획 (시드 → 타임라인) ──────────────────────────────────────────────

type PlanItem =
  | { type: 'monster'; monsterId: string }
  | { type: 'treasure'; eventId: string }
  | { type: 'trap'; eventId: string }
  | { type: 'gather'; eventId: string }
  | { type: 'crossroad'; event: CrossroadEvent; index: number };

function buildPlan(content: Content, region: Region, tier: Tier, effects: readonly ActiveEffect[], seed: string): PlanItem[] {
  const rng = streamRng(seed, 'sequence');
  const tierDef = content.balance.tiers[tier];
  const setupCtx: EffectCtx = { regionId: region.id, tier };
  const setupActions = query(effects, 'expeditionSetup', setupCtx);

  let count = tierDef.encounters;
  for (const action of setupActions) {
    if (action.kind === 'encounterAdd') count += action.count;
  }

  const mix = { ...region.encounterMix };
  for (const action of setupActions) {
    if (action.kind === 'encounterMixMult') mix[action.target] *= action.value;
  }

  const spawnWeightOf = (monsterId: string, baseWeight: number): number => {
    const monster = content.monsters.get(monsterId)!;
    let weight = baseWeight;
    // 심층 희귀 가중은 희귀·영웅에만 (고급은 준일반 취급, 전설은 spawns에 없음)
    if (monster.rarity === 'rare' || monster.rarity === 'heroic') weight *= tierDef.rareWeightMult;
    for (const action of setupActions) {
      if (action.kind === 'spawnWeightMult' && RARITY_ORDER[monster.rarity] >= RARITY_ORDER[action.minRarity]) {
        weight *= action.value;
      }
    }
    return weight;
  };

  // 전설 조우 주입 (심층 한정, GDD §6) — 계획 중앙 슬롯을 교체. 지역 전설 2종 중 시드로 1종
  const legendarySlot = tierDef.legendaryChance > 0 && rng() < tierDef.legendaryChance ? Math.floor(count / 2) : -1;
  const legendaryId = legendarySlot >= 0
    ? region.legendary[Math.min(Math.floor(rng() * region.legendary.length), region.legendary.length - 1)]!
    : region.legendary[0]!;

  const kinds = ['monster', 'treasure', 'trap', 'gather'] as const;
  const slots: PlanItem[] = [];
  for (let i = 0; i < count; i++) {
    if (i === legendarySlot) {
      slots.push({ type: 'monster', monsterId: legendaryId });
      continue;
    }
    const kind = pickWeighted(rng, kinds, (k) => mix[k]);
    if (kind === 'monster') {
      const spawn = pickWeighted(rng, region.spawns, (s) => spawnWeightOf(s.monster, s.weight));
      slots.push({ type: 'monster', monsterId: spawn.monster });
    } else if (kind === 'treasure') {
      slots.push({ type: 'treasure', eventId: pickWeighted(rng, content.events.treasures, () => 1).id });
    } else if (kind === 'trap') {
      slots.push({ type: 'trap', eventId: pickWeighted(rng, content.events.traps, () => 1).id });
    } else {
      slots.push({ type: 'gather', eventId: pickWeighted(rng, content.events.gathers, () => 1).id });
    }
  }

  // 갈림길 삽입 — 균등 분할 지점, 이벤트는 중복 없이 추첨
  const crossRng = streamRng(seed, 'crossroad-pick');
  const pool = [...content.events.crossroads];
  const items: PlanItem[] = [...slots];
  for (let c = tierDef.crossroads - 1; c >= 0; c--) {
    const pos = Math.round(((c + 1) * count) / (tierDef.crossroads + 1));
    const pick = pool.length > 0 ? pool.splice(Math.floor(crossRng() * pool.length), 1)[0]! : content.events.crossroads[0]!;
    items.splice(pos, 0, { type: 'crossroad', event: pick, index: c });
  }
  return items;
}

/**
 * 진행 중 원정의 갈림길 이벤트 목록 (결정론 — resolve와 같은 계획을 재생성).
 * UI가 "어느 갈림길에서 무엇을 고르는지" 보여주기 위해 사용한다.
 */
export function previewCrossroads(content: Content, save: SaveState, expedition: ActiveExpedition): CrossroadEvent[] {
  const region = content.regions.get(expedition.regionId);
  if (!region) throw new GameError('region-missing', `없는 지역: ${expedition.regionId}`);
  const { effects } = collectTeamEffects(content, save, expedition.partyIds, expedition.artifactUids);
  const plan = buildPlan(content, region, expedition.tier, effects, expedition.seed);
  return plan
    .filter((item): item is Extract<PlanItem, { type: 'crossroad' }> => item.type === 'crossroad')
    .sort((a, b) => a.index - b.index)
    .map((item) => item.event);
}

// ── 유물 드랍 ────────────────────────────────────────────────────────────────

export function rollArtifact(content: Content, rng: Rng, rarityBonus = 0): DroppedArtifact {
  const { artifacts } = content.balance;
  const weights = { ...artifacts.dropRarity };
  if (rarityBonus > 0) {
    // 보정: 일반 가중치를 깎아 영웅·전설로 이전
    weights.common = Math.max(0, weights.common - rarityBonus);
    weights.heroic += rarityBonus * 0.6;
    weights.legendary += rarityBonus * 0.4;
  }
  // 5단계 전 등급에서 추첨 — 고급(uncommon)이 목록에 빠져 표기 확률과 어긋나던 버그 수정 (2026-08-23)
  const rarity = pickWeighted(rng, ['common', 'uncommon', 'rare', 'heroic', 'legendary'] as const, (r) => weights[r]);
  return rollArtifactOfRarity(content, rng, rarity);
}

/** 지정 등급의 랜덤 유물 1개 (부옵션 포함) — 드랍·유물 합성이 공유 */
export function rollArtifactOfRarity(content: Content, rng: Rng, rarity: ArtifactRarity): DroppedArtifact {
  const { artifacts } = content.balance;
  const defs = content.artifactsByRarity.get(rarity)!;
  const def = defs[Math.floor(rng() * defs.length)]!;

  const substats: DroppedArtifact['substats'] = [];
  const pool = [...artifacts.substatPool];
  const substatCount = artifacts.substatCount[rarity];
  for (let i = 0; i < substatCount && pool.length > 0; i++) {
    const picked = pickWeighted(rng, pool, (s) => s.weight);
    pool.splice(pool.indexOf(picked), 1);
    const value = Math.round((picked.min + rng() * (picked.max - picked.min)) * 1000) / 1000;
    substats.push({ stat: picked.stat, value });
  }
  return { itemId: def.id, substats };
}

// ── 정산 (시드 → 일지) ───────────────────────────────────────────────────────

export function resolveExpedition(content: Content, save: SaveState, expedition: ActiveExpedition): Journal {
  const region = content.regions.get(expedition.regionId);
  if (!region) throw new GameError('region-missing', `없는 지역: ${expedition.regionId}`);
  const tierDef = content.balance.tiers[expedition.tier];
  const { combat, rewards: rewardBalance, crossroad: crossroadBalance, artifacts: artifactBalance } = content.balance;

  const party = expedition.partyIds.map((monsterId) => findMonster(save, monsterId));
  const { effects } = collectTeamEffects(content, save, expedition.partyIds, expedition.artifactUids);
  const plan = buildPlan(content, region, expedition.tier, effects, expedition.seed);

  const captureRng = streamRng(expedition.seed, 'capture');
  const lootRng = streamRng(expedition.seed, 'loot');
  const eventsRng = streamRng(expedition.seed, 'events');
  const crossroadRng = streamRng(expedition.seed, 'crossroad');

  const baseCtx: EffectCtx = { regionId: region.id, tier: expedition.tier };
  const partyPower = computePartyPower(content, effects, party, region, expedition.tier).total;
  const baseDamageReduce = partyDamageReduce(content, effects, baseCtx);

  let retryBudget = 0;
  for (const action of query(effects, 'captureRoll', baseCtx)) {
    if (action.kind === 'captureRetry') retryBudget += action.perExpedition;
  }

  const healReceivedMult = query(effects, 'computeParty', baseCtx).reduce(
    (mult, action) => (action.kind === 'healReceivedMult' ? mult * action.value : mult),
    1,
  );

  const entries: JournalEntry[] = [];
  const totals: Journal['totals'] = {
    gold: 0,
    materials: {},
    cards: {},
    capturedMonsterIds: [],
    seenMonsterIds: [],
    artifacts: [],
    luresUsed: 0,
    luresGained: 0,
  };

  let hp = 1;
  let wiped = false;
  let reviveUsed = false;
  let luresLeft = expedition.luresLoaded;
  let pityAvailable = artifactBalance.firstTreasurePity && !save.profile.flags['firstArtifactDropped'];
  let firstCaptureAvailable =
    content.balance.capture.firstCaptureGuarantee && save.profile.flags['firstCaptured'] !== true;
  let monsterIndex = 0;

  const markSeen = (monsterId: string) => {
    if (!totals.seenMonsterIds.includes(monsterId)) totals.seenMonsterIds.push(monsterId);
  };
  const addMaterial = (materialId: string, count: number) => {
    totals.materials[materialId] = (totals.materials[materialId] ?? 0) + count;
  };
  const addCard = (monsterId: string, count: number) => {
    totals.cards[monsterId] = (totals.cards[monsterId] ?? 0) + count;
  };
  const dropArtifact = (drop: DroppedArtifact) => {
    totals.artifacts.push(drop);
    pityAvailable = false;
  };

  /**
   * HP 차감 후 전멸 판정. 엔트리 순서를 지키기 위해 wipe 엔트리는 호출자가
   * 본 엔트리 뒤에 pushWipeAfter로 넣는다.
   */
  type DamageStatus = 'ok' | 'revived' | 'dead';
  const takeDamage = (amount: number, ctx: EffectCtx): { status: DamageStatus; hpAfterDamage: number } => {
    hp = Math.max(0, hp - amount);
    const hpAfterDamage = hp;
    if (hp > 0) return { status: 'ok', hpAfterDamage };
    if (!reviveUsed) {
      const revive = query(effects, 'afterDefeat', ctx).find((a) => a.kind === 'reviveOnce');
      if (revive && revive.kind === 'reviveOnce') {
        reviveUsed = true;
        hp = revive.hpRatio;
        return { status: 'revived', hpAfterDamage };
      }
    }
    wiped = true;
    return { status: 'dead', hpAfterDamage };
  };
  const pushWipeAfter = (status: DamageStatus): void => {
    if (status === 'revived') entries.push({ type: 'wipe', revived: true, hpAfter: hp });
    else if (status === 'dead') entries.push({ type: 'wipe', revived: false, hpAfter: 0 });
  };

  const grantRewards = (list: readonly Reward[], scale: number, allowArtifact: boolean): GrantedReward[] => {
    const granted: GrantedReward[] = [];
    for (const reward of list) {
      switch (reward.kind) {
        case 'gold': {
          const amount = Math.round(reward.amount * region.rewardScale * tierDef.yieldMult * scale);
          totals.gold += amount;
          granted.push({ kind: 'gold', amount });
          break;
        }
        case 'material': {
          const materialId = region.materials[reward.slot]!;
          const count = Math.max(1, Math.round(reward.count * scale));
          addMaterial(materialId, count);
          granted.push({ kind: 'material', materialId, count });
          break;
        }
        case 'cardRandom': {
          // 보유 종 중 랜덤 카드 — 도감에 없는 종이 갑자기 생기지 않게 로스터에서만 뽑는다
          const owned = save.roster;
          if (owned.length === 0) break;
          const picked = owned[Math.floor(crossroadRng() * owned.length)]!;
          const count = Math.max(1, Math.round(reward.count * scale));
          addCard(picked.monsterId, count);
          granted.push({ kind: 'card', monsterId: picked.monsterId, count });
          break;
        }
        case 'artifactRoll': {
          if (!allowArtifact) break;
          const drop = rollArtifact(content, lootRng, reward.rarityBonus ?? 0);
          dropArtifact(drop);
          granted.push({ kind: 'artifact', drop });
          break;
        }
        case 'lure': {
          const count = Math.max(1, Math.round(reward.count * scale));
          luresLeft += count;
          totals.luresGained += count;
          granted.push({ kind: 'lure', count });
          break;
        }
      }
    }
    return granted;
  };

  for (const item of plan) {
    if (wiped) break;

    if (item.type === 'monster') {
      const monster = content.monsters.get(item.monsterId)!;
      const ctx: EffectCtx = {
        regionId: region.id,
        tier: expedition.tier,
        encounterKind: 'monster',
        element: monster.element,
        tribe: monster.tribe,
        encounterRarity: monster.rarity,
        encounterIndex: monsterIndex,
        hpRatio: hp,
      };
      monsterIndex++;
      markSeen(monster.id);

      const auto = query(effects, 'beforeEncounter', ctx).some((a) => a.kind === 'autoWin');
      const enemy = enemyPower(content, monster);
      const defeatReduce = sumDamageReduce(
        query(effects, 'afterDefeat', ctx).filter((a) => a.kind === 'damageReduce'),
        1,
      );
      const outcome = auto
        ? { win: true, damage: 0 }
        : resolveClash(content, partyPower, enemy, baseDamageReduce, defeatReduce);

      if (outcome.win) {
        if (outcome.damage > 0) {
          const { status } = takeDamage(outcome.damage, ctx);
          if (status !== 'ok') {
            // 승리 피해로 빈사·전멸하는 극단 케이스 — 골드만 챙기고 포획 없이 처리
            const gold = Math.round(
              rewardBalance.goldPerVictory * rewardBalance.rarityGoldMult[monster.rarity] * region.rewardScale * tierDef.yieldMult,
            );
            totals.gold += gold;
            entries.push({
              type: 'encounter', index: monsterIndex - 1, monsterId: monster.id, result: auto ? 'autowin' : 'win',
              enemyPower: Math.round(enemy), partyPower: Math.round(partyPower), hpAfter: status === 'revived' ? hp : 0, gold,
            });
            pushWipeAfter(status);
            continue;
          }
        }
        const gold = Math.round(
          rewardBalance.goldPerVictory * rewardBalance.rarityGoldMult[monster.rarity] * region.rewardScale * tierDef.yieldMult,
        );
        totals.gold += gold;

        // 정령 시너지 등 승리 후 회복
        let heal = 0;
        for (const action of query(effects, 'afterVictory', ctx)) {
          if (action.kind === 'heal') heal += action.ratio;
        }
        if (heal > 0) hp = Math.min(1, hp + heal * healReceivedMult);

        // 포획
        const alreadyCaptured = save.codex[monster.id]?.captured === true || totals.capturedMonsterIds.includes(monster.id);
        const captureAdds = sumOf(query(effects, 'captureRoll', ctx), 'captureAdd');
        const useLure = shouldUseLure(monster, luresLeft);
        if (useLure) {
          luresLeft--;
          totals.luresUsed++;
        }
        const chance = captureChance(content, { monster, captureAddSum: captureAdds, useLure, buffMult: 1 });
        let success = captureRng() < chance;
        let retried = false;
        if (!success && firstCaptureAvailable) {
          success = true; // 계정 첫 포획 100% 보정 (GDD §13 — 초반 이탈 방지)
        } else if (!success && retryBudget > 0) {
          retryBudget--;
          retried = true;
          success = captureRng() < chance;
        }
        firstCaptureAvailable = false; // 보정은 계정 첫 시도 한 번만
        let dupe = false;
        if (success) {
          if (alreadyCaptured) {
            dupe = true;
            addCard(monster.id, 1); // 중복 포획 = 카드 +1 (구 정수 전환 대체)
          } else {
            totals.capturedMonsterIds.push(monster.id);
          }
        }

        // 전설 조우 유물 드랍 (GDD §8.4)
        let artifact: DroppedArtifact | undefined;
        if (monster.rarity === 'legendary' && lootRng() < artifactBalance.sources.legendaryEncounter) {
          artifact = rollArtifact(content, lootRng, 0.2);
          dropArtifact(artifact);
        }

        entries.push({
          type: 'encounter', index: monsterIndex - 1, monsterId: monster.id, result: auto ? 'autowin' : 'win',
          enemyPower: Math.round(enemy), partyPower: Math.round(partyPower), hpAfter: hp, gold,
          capture: { success, retried, ...(dupe ? { dupe } : {}) },
          ...(artifact ? { artifact } : {}),
        });
      } else {
        const { status, hpAfterDamage } = takeDamage(outcome.damage, ctx);
        entries.push({
          type: 'encounter', index: monsterIndex - 1, monsterId: monster.id, result: 'flee',
          enemyPower: Math.round(enemy), partyPower: Math.round(partyPower), hpAfter: hpAfterDamage, gold: 0,
        });
        pushWipeAfter(status);
      }
    } else if (item.type === 'treasure') {
      const ctx: EffectCtx = { regionId: region.id, tier: expedition.tier, encounterKind: 'treasure', hpRatio: hp };
      const gold = Math.round(rewardBalance.goldPerTreasure * region.rewardScale * tierDef.yieldMult);
      totals.gold += gold;
      let artifact: DroppedArtifact | undefined;
      if (pityAvailable || lootRng() < artifactBalance.sources.treasureChance) {
        artifact = rollArtifact(content, lootRng);
        dropArtifact(artifact);
      }
      void ctx;
      entries.push({ type: 'treasure', eventId: item.eventId, gold, hpAfter: hp, ...(artifact ? { artifact } : {}) });
    } else if (item.type === 'trap') {
      const ctx: EffectCtx = { regionId: region.id, tier: expedition.tier, encounterKind: 'trap', hpRatio: hp };
      let avoidChance = 0;
      for (const action of query(effects, 'beforeEncounter', ctx)) {
        if (action.kind === 'trapAvoid') avoidChance += action.chance;
      }
      avoidChance = clamp(avoidChance, 0, artifactBalance.effectCaps.trapAvoidMax);
      const avoided = eventsRng() < avoidChance;
      let trapStatus: DamageStatus = 'ok';
      let trapHp = hp;
      if (!avoided) {
        const result = takeDamage(combat.trapDamage * (1 - baseDamageReduce), ctx);
        trapStatus = result.status;
        trapHp = result.hpAfterDamage;
      }
      entries.push({ type: 'trap', eventId: item.eventId, avoided, hpAfter: trapHp });
      pushWipeAfter(trapStatus);
    } else if (item.type === 'gather') {
      const materialId = region.materials[randInt(eventsRng, 0, 1)]!;
      const count = randInt(eventsRng, rewardBalance.gatherMaterialMin, rewardBalance.gatherMaterialMax);
      addMaterial(materialId, count);
      entries.push({ type: 'gather', eventId: item.eventId, materialId, count });
    } else {
      // 갈림길
      const ctx: EffectCtx = { regionId: region.id, tier: expedition.tier, hpRatio: hp };
      const choice: CrossroadChoice = expedition.choices[item.index] ?? 'safe';
      const crossActions = query(effects, 'crossroad', ctx);
      if (choice === 'safe') {
        const rewards = grantRewards(item.event.safe, 1, true);
        entries.push({ type: 'crossroad', eventId: item.event.id, choice, success: true, salvaged: false, rewards, hpAfter: hp });
      } else {
        const base = clamp(
          partyPower / (region.recommendedCp * crossroadBalance.riskyCheckRatio),
          crossroadBalance.baseChanceFloor,
          crossroadBalance.baseChanceCeil,
        );
        const chance = clamp(base + sumOf(crossActions, 'crossroadSuccessAdd'), 0, 0.98);
        const success = crossroadRng() < chance;
        if (success) {
          const rewards = grantRewards(item.event.risky.success, 1, true);
          entries.push({ type: 'crossroad', eventId: item.event.id, choice, success: true, salvaged: false, rewards, hpAfter: hp });
        } else {
          let salvageRatio = 0;
          for (const action of crossActions) {
            if (action.kind === 'salvageOnFail') salvageRatio = Math.max(salvageRatio, action.ratio);
          }
          const rewards = salvageRatio > 0 ? grantRewards(item.event.risky.success, salvageRatio, false) : [];
          const { status, hpAfterDamage } = takeDamage(item.event.risky.fail.ratio * (1 - baseDamageReduce), ctx);
          entries.push({
            type: 'crossroad', eventId: item.event.id, choice, success: false, salvaged: salvageRatio > 0, rewards, hpAfter: hpAfterDamage,
          });
          pushWipeAfter(status);
        }
      }
    }
  }

  // 심층 완주 상자 (전멸 시 없음)
  if (!wiped && expedition.tier === 'deep' && artifactBalance.sources.deepClearBox) {
    const artifact = rollArtifact(content, lootRng, 0.15);
    dropArtifact(artifact);
    entries.push({ type: 'clearBox', artifact });
  }

  // 정산 배수 (journalEnd) → 전멸 페널티 순서로 적용
  const endCtx: EffectCtx = { regionId: region.id, tier: expedition.tier, hpRatio: hp };
  const endActions = query(effects, 'journalEnd', endCtx);
  const goldMult = 1 + sumRewardMult(endActions, 'gold', artifactBalance.effectCaps.rewardMult);
  const materialMult = 1 + sumRewardMult(endActions, 'materials', artifactBalance.effectCaps.rewardMult);
  totals.gold = Math.round(totals.gold * goldMult);
  for (const key of Object.keys(totals.materials)) {
    totals.materials[key] = Math.round(totals.materials[key]! * materialMult);
  }

  if (wiped) {
    // 전멸 페널티는 재화(골드·재료)만 — 카드는 포획물이라 신규 등록과 마찬가지로 유지
    let fleeRatio = combat.fleeRewardRatio;
    for (const action of endActions) {
      if (action.kind === 'fleeRewardRatioSet') fleeRatio = Math.max(fleeRatio, action.value);
    }
    totals.gold = Math.floor(totals.gold * fleeRatio);
    for (const key of Object.keys(totals.materials)) {
      totals.materials[key] = Math.floor(totals.materials[key]! * fleeRatio);
    }
  }

  return {
    expeditionId: expedition.id,
    regionId: region.id,
    tier: expedition.tier,
    seed: expedition.seed,
    entries,
    wiped,
    totals,
  };
}

// ── 귀환 정산 적용 ───────────────────────────────────────────────────────────

export interface ClaimResult {
  save: SaveState;
  journal: Journal;
  newMilestones: string[];
  newTasks: TaskCompletion[];
}

export function claimExpedition(
  content: Content,
  save: SaveState,
  expeditionId: string,
  ctx: CoreCtx,
  opts: { force?: boolean } = {},
): ClaimResult {
  const expedition = save.expeditions.find((e) => e.id === expeditionId && !e.claimed);
  if (!expedition) throw new GameError('expedition-missing', '진행 중인 원정이 아닙니다');
  if (!opts.force && ctx.now() < expedition.endsAt) {
    throw new GameError('expedition-running', '원정대가 아직 돌아오지 않았습니다');
  }

  const journal = resolveExpedition(content, save, expedition);
  const next = structuredClone(save);

  // 재화
  next.wallet.gold += journal.totals.gold;
  for (const [materialId, count] of Object.entries(journal.totals.materials)) {
    next.wallet.materials[materialId] = (next.wallet.materials[materialId] ?? 0) + count;
  }
  next.wallet.lures += expedition.luresLoaded - journal.totals.luresUsed + journal.totals.luresGained;

  // 도감·로스터
  for (const monsterId of journal.totals.seenMonsterIds) {
    const entry = next.codex[monsterId] ?? { seen: false, captured: false, awakened: false };
    entry.seen = true;
    next.codex[monsterId] = entry;
  }
  for (const monsterId of journal.totals.capturedMonsterIds) {
    const entry = next.codex[monsterId] ?? { seen: true, captured: false, awakened: false };
    entry.seen = true;
    if (!entry.captured) {
      entry.captured = true;
      entry.firstCapturedAt = expedition.endsAt;
    }
    next.codex[monsterId] = entry;
    if (!next.roster.some((m) => m.monsterId === monsterId)) {
      next.roster.push({ monsterId, level: 1, star: 1, count: 1 });
    }
  }
  // 중복 카드 반영 (신규 등록 뒤에 — 같은 원정에서 신규 포획 후 중복까지 나온 경우 대비)
  for (const [monsterId, count] of Object.entries(journal.totals.cards)) {
    const owned = next.roster.find((m) => m.monsterId === monsterId);
    if (owned) owned.count += count;
  }

  // 유물
  for (const drop of journal.totals.artifacts) {
    next.artifacts.push({ uid: ctx.newUid(), itemId: drop.itemId, enhance: 0, substats: [...drop.substats] });
  }
  if (journal.totals.artifacts.length > 0) next.profile.flags['firstArtifactDropped'] = true;
  if (journal.entries.some((entry) => entry.type === 'encounter' && entry.capture?.success)) {
    next.profile.flags['firstCaptured'] = true;
  }

  // 원정 종료 + 일지 요약 보관
  next.expeditions = next.expeditions.filter((e) => e.id !== expeditionId);
  next.journalArchive.unshift({
    expeditionId: expedition.id,
    regionId: expedition.regionId,
    tier: expedition.tier,
    endedAt: expedition.endsAt,
    gold: journal.totals.gold,
    capturedCount: journal.totals.capturedMonsterIds.length,
    artifactCount: journal.totals.artifacts.length,
    wiped: journal.wiped,
  });
  next.journalArchive = next.journalArchive.slice(0, 20);

  // 마일스톤 평가 (도감 변화 반영 후)
  const newMilestones = evaluateNewMilestones(content, next);
  for (const id of newMilestones) {
    next.milestones.push(id);
    const milestone = content.milestones.find((m) => m.id === id)!;
    next.wallet.gold += milestone.reward.gold ?? 0;
    next.wallet.dust += milestone.reward.dust ?? 0;
  }

  // 누적 통계 + 반복 과업 정산 (GDD §9.3)
  next.stats.expeditions[expedition.tier] += 1;
  if (journal.wiped) next.stats.wipes[expedition.tier] += 1;
  next.stats.captures += journal.entries.filter((e) => e.type === 'encounter' && e.capture?.success).length;
  const newTasks = settleTasks(content, next);

  return { save: next, journal, newMilestones, newTasks };
}

/** 아직 미달성인 마일스톤 중 새로 조건을 채운 것들 — 정산·합성 등 도감이 변한 직후 호출 */
export function evaluateNewMilestones(content: Content, save: SaveState): string[] {
  const captured = Object.entries(save.codex).filter(([, entry]) => entry.captured);
  const total = captured.length;
  const byRegion = new Map<string, number>();
  const byTribe = new Map<string, number>();
  for (const [monsterId] of captured) {
    const monster = content.monsters.get(monsterId);
    if (!monster) continue;
    byRegion.set(monster.habitat, (byRegion.get(monster.habitat) ?? 0) + 1);
    byTribe.set(monster.tribe, (byTribe.get(monster.tribe) ?? 0) + 1);
  }
  const done: string[] = [];
  for (const milestone of content.milestones) {
    if (save.milestones.includes(milestone.id)) continue;
    const c = milestone.condition;
    const satisfied =
      c.kind === 'totalCaptured'
        ? total >= c.count
        : c.kind === 'regionCaptured'
          ? (byRegion.get(c.region) ?? 0) >= c.count
          : (byTribe.get(c.tribe) ?? 0) >= c.count;
    if (satisfied) done.push(milestone.id);
  }
  return done;
}

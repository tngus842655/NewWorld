/**
 * 경제 액션 — 레벨업·각성·합성·제작·강화·해금. 전부 순수 함수, 실패는 GameError.
 */
import type { Content } from '../content';
import { RARITIES, RARITY_LABEL, type ArtifactRarity, type MonsterRarity, type RecipeOutput, type Region } from '../content/schema';
import { findArtifact, findMonster, grantArtifact } from './effects';
import { evaluateNewMilestones, rollArtifactOfRarity } from './expedition';
import { artifactEnhanceCost, monsterLevelUpCost, monsterStarUpCost } from './formulas';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, nextPartySlotUnlock, regionFlagKey } from './progression';
import { streamRng } from './rng';
import { settleTasks } from './tasks';
import { GameError, type CoreCtx, type SaveState } from './types';

function spendGold(save: SaveState, amount: number): void {
  if (save.wallet.gold < amount) throw new GameError('gold-short', `골드가 부족합니다 (필요: ${amount})`);
  save.wallet.gold -= amount;
}

/**
 * 합성 사다리의 정본 — RARITIES에서 파생한다 (2026-08-25).
 * 최상위 등급만 null. 몬스터·유물·UI가 전부 이 한 벌을 쓴다 (이전에는 세 벌로 갈려 있었다).
 */
export const RARITY_NEXT = Object.fromEntries(
  RARITIES.map((rarity, index) => [rarity, RARITIES[index + 1] ?? null]),
) as Record<MonsterRarity, MonsterRarity | null>;

/**
 * 최종 티어(마지막 권역) — **유물** 초월 합성의 관문. 지역이 늘어나면 자동으로 따라온다 (별빛 폐허 등).
 * 12지역 개편(2026-08-26)으로 "마지막 지역"이 소지역 하나가 아니라 묶음이 됐다.
 * 몬스터 초월 관문은 여기가 아니라 transcendGateRegion(분화구 심장부)이다 — 2026-08-31 개편 전에는
 * "최종 티어 서식 전설만 재료"로 몬스터 쪽도 이 티어에 묶여 있었다.
 */
export function finalTier(content: Content): number {
  return content.regionList[content.regionList.length - 1]!.tier;
}

/** 최종 티어의 진입 지역 — 유물 초월 관문 안내·해금 조건 표시용 ("잿빛 화산 권역") */
export function finalTierEntry(content: Content) {
  const tier = finalTier(content);
  return content.regionList.find((r) => r.tier === tier)!;
}

/**
 * 몬스터 초월 관문 지역 — 초월 종 서식지 중 해금이 가장 늦은 곳 (2026-08-31 사용자: 분화구 심장부).
 * 관문이 서식지 중 하나이므로 관문이 열리면 결과 풀은 절대 비지 않고, 가장 늦은 서식지를 고르므로 관문이 열린
 * 시점에는 초월 전 종이 풀에 있다 — 폴백(미해금 초월 몬스터 유출)이 발동할 여지가 0이 되는 지점이다.
 * 관문을 정하는 것은 regionList가 아니라 초월 종의 habitat이다: 새 권역에 초월 종을 서식시키면 관문이 따라오고,
 * 지역만 추가하면 제자리다 (유물 관문 finalTierEntry는 지역 추가만으로 이동 — 의도된 비대칭).
 * 전제: 지역 해금은 순차적이다 (가장 뒤 지역이 열렸으면 앞 지역도 전부 열려 있다 — 현재 콘텐츠 참).
 */
export function transcendGateRegion(content: Content): Region {
  const homes = new Set(content.transcendentList.map((m) => m.habitat));
  const gate = content.regionList.filter((r) => homes.has(r.id)).sort((a, b) => b.order - a.order)[0];
  if (!gate) throw new Error('[content] 초월 종의 서식 지역이 없다 — transcendGateRegion');
  return gate;
}

/** 초월로 올라가는 합성인가 — 최상위 등급이 결과인 경우 */
function isTranscendStep(nextRarity: MonsterRarity): boolean {
  return RARITY_NEXT[nextRarity] === null;
}


/** 레벨업 — 종 단위 (카드가 몇 장이든 종당 레벨 하나, 골드 소모) */
export function levelUpMonster(content: Content, save: SaveState, monsterId: string): SaveState {
  const next = structuredClone(save);
  const monster = findMonster(next, monsterId);
  if (monster.level >= content.balance.level.max) throw new GameError('level-max', '이미 최대 레벨입니다');
  spendGold(next, monsterLevelUpCost(content, monsterId, monster.level)); // 지역·등급 차등 (2026-08-23)
  monster.level++;
  return next;
}

/** 각성 — 정수 폐기(2026-08-23), 골드 소모로 변경 */
export function awakenMonster(content: Content, save: SaveState, monsterId: string): SaveState {
  const next = structuredClone(save);
  const owned = findMonster(next, monsterId);
  if (owned.star >= content.balance.star.max) throw new GameError('star-max', '이미 최대 성급입니다');
  spendGold(next, monsterStarUpCost(content, monsterId, owned.star)); // 지역·등급 차등 (2026-08-23)
  owned.star++;
  if (owned.star >= 3) {
    const entry = next.codex[owned.monsterId];
    if (entry) entry.awakened = true;
  }
  return next;
}

// ── 카드 합성 (GDD §4.5) ─────────────────────────────────────────────────────

/** 재료: 종별 사용 장수 (합계 = balance.fusion.materials, 전부 같은 등급의 여분 카드) */
export interface FusionInput {
  materials: { monsterId: string; count: number }[];
}

export interface FusionResult {
  save: SaveState;
  success: boolean;
  materialRarity: string;
  resultMonsterId?: string; // 성공 시 획득 종
  isNew?: boolean; // 도감 신규 등록 여부
  returnedMonsterId?: string; // 실패 시 반환된 카드 1장의 종
  newMilestones: string[];
}

/**
 * 같은 등급 여분 카드 N장 → 다음 등급 랜덤 1종 도전.
 * 각 종의 마지막 1장은 재료 불가 (여분 = count - 1).
 * 실패 시 재료 중 1장은 돌려받는다 (실소모 1장 — 도전 문턱 완화).
 * 결과 풀은 해금 지역의 다음 등급 전 종 (미보유면 도감 신규 등록 + 마일스톤 평가).
 * 초월 단계는 분화구 심장부 해금이 관문 — 재료 서식 제한은 없다 (2026-08-31, transcendGateRegion).
 */
export function fuseMonsters(content: Content, save: SaveState, input: FusionInput, ctx: CoreCtx): FusionResult {
  const { fusion } = content.balance;
  const totalUsed = input.materials.reduce((sum, m) => sum + m.count, 0);
  if (totalUsed !== fusion.materials) {
    throw new GameError('fusion-materials', `재료 카드는 정확히 ${fusion.materials}장이어야 합니다`);
  }

  let rarity: MonsterRarity | null = null;
  for (const material of input.materials) {
    if (material.count < 1) throw new GameError('fusion-materials', '재료 수량이 잘못되었습니다');
    const owned = findMonster(save, material.monsterId);
    const monster = content.monsters.get(material.monsterId);
    if (!monster) throw new GameError('monster-def-missing', `콘텐츠에 없는 몬스터: ${material.monsterId}`);
    if (owned.count - 1 < material.count) {
      throw new GameError('fusion-spare', `${monster.name}의 여분 카드가 부족합니다 (마지막 1장은 재료가 될 수 없습니다)`);
    }
    if (rarity === null) rarity = monster.rarity;
    else if (rarity !== monster.rarity) throw new GameError('fusion-rarity', '재료는 같은 등급이어야 합니다');
  }
  const nextRarity = RARITY_NEXT[rarity!];
  if (!nextRarity) throw new GameError('fusion-top', `${RARITY_LABEL[rarity!]} 카드는 더 합성할 수 없습니다`);
  // 초월 도전은 분화구 심장부 해금이 관문이다 (2026-08-31 사용자) — 재료는 전 지역 전설 여분.
  // 유물 초월(fuseArtifacts)과 같은 방식이되 관문 지역만 다르다 (몬스터=분화구, 유물=화산 — 의도된 비대칭).
  // 구 규칙(2026-08-25~09-01, 최종 티어 서식 카드만 재료)은 하위 권역 전설을 출구 없는 사표로 만들었다.
  if (isTranscendStep(nextRarity)) {
    const gate = transcendGateRegion(content);
    if (!isRegionUnlocked(content, save, gate.id)) {
      throw new GameError('fusion-region', `${RARITY_LABEL[nextRarity]} 합성은 ${gate.name} 해금 후에 도전할 수 있습니다`);
    }
  }
  const chance = fusion.chance[rarity!] ?? 0;

  const next = structuredClone(save);
  for (const material of input.materials) {
    findMonster(next, material.monsterId).count -= material.count;
  }

  next.stats.fusions += 1;
  const rng = streamRng(ctx.newSeed(), 'fusion');
  const success = rng() < chance;
  if (!success) {
    // 실패 — 재료 중 1장을 랜덤으로 돌려준다 (시드 결정론)
    const usedPool: string[] = input.materials.flatMap((m) => Array.from({ length: m.count }, () => m.monsterId));
    const returnedMonsterId = usedPool[Math.floor(rng() * usedPool.length)]!;
    findMonster(next, returnedMonsterId).count += 1;
    settleTasks(content, next);
    return { save: next, success: false, materialRarity: rarity!, returnedMonsterId, newMilestones: [] };
  }

  // 결과 풀: 해금 지역의 다음 등급 전 종 (전 지역 미해금 케이스 방어로 전체 폴백)
  let pool = content.monsterList.filter(
    (m) => m.rarity === nextRarity && isRegionUnlocked(content, next, m.habitat),
  );
  if (pool.length === 0) {
    // 초월 단계는 폴백 금지 (2026-08-31) — 관문(transcendGateRegion)이 초월 종 서식지 중 하나라 관문이 열렸으면
    // 정의상 풀이 빌 수 없다. 즉 이 throw는 정상 콘텐츠·세이브로는 도달 불가한 이중 방어다 (관문 계산이 finalTierEntry 등
    // 서식지 밖 지역으로 되돌아가는 회귀를 잡는다). 폴백을 타면 미해금 지역의 초월 몬스터를 그냥 내준다 (진행 파괴).
    // tests/transcendent.test.ts «초월 관문»이 가짜 콘텐츠(초월 서식지를 미해금 지역으로 옮김)로 이 경로를 강제 실행한다.
    if (isTranscendStep(nextRarity)) {
      throw new GameError('fusion-pool', `${RARITY_LABEL[nextRarity]} 결과 풀이 비어 있습니다 [관문 검사 오류 — 제보해 주세요]`);
    }
    pool = content.monsterList.filter((m) => m.rarity === nextRarity);
  }
  const result = pool[Math.floor(rng() * pool.length)]!;

  const owned = next.roster.find((m) => m.monsterId === result.id);
  const isNew = !owned;
  if (owned) {
    owned.count += 1;
  } else {
    next.roster.push({ monsterId: result.id, level: 1, star: 1, count: 1 });
    const entry = next.codex[result.id] ?? { seen: false, captured: false, awakened: false };
    entry.seen = true;
    if (!entry.captured) {
      entry.captured = true;
      entry.firstCapturedAt = ctx.now();
    }
    next.codex[result.id] = entry;
  }

  const newMilestones = evaluateNewMilestones(content, next);
  for (const id of newMilestones) {
    next.milestones.push(id);
    const milestone = content.milestones.find((m) => m.id === id)!;
    next.wallet.gold += milestone.reward.gold ?? 0;
    next.wallet.dust += milestone.reward.dust ?? 0;
  }
  settleTasks(content, next);

  return { save: next, success: true, materialRarity: rarity!, resultMonsterId: result.id, isNew, newMilestones };
}

// ── 유물 합성 (GDD §4.5 — 카드 합성과 완전 동일 규칙, v6 종 단위) ────────────

/** 재료: 종별 사용 개수 (합계 = balance.fusion.materials, 전부 같은 등급의 여분) */
export interface ArtifactFusionInput {
  materials: { itemId: string; count: number }[];
}

export interface ArtifactFusionResult {
  save: SaveState;
  success: boolean;
  materialRarity: string;
  resultItemId?: string; // 성공 시 획득 종
  isNew?: boolean; // 신규 종 여부
  returnedItemId?: string; // 실패 시 반환된 1개의 종
}

/**
 * 같은 등급 여분 유물 N개 → 다음 등급 유물 1종(랜덤) 도전. 확률은 카드 합성과 공유.
 * 각 종의 마지막 1개는 재료 불가 (여분 = count - 1) — 강화한 종이 합성으로 사라지는 사고 방지.
 * 실패 시 재료 중 1개는 돌려받는다.
 */
export function fuseArtifacts(content: Content, save: SaveState, input: ArtifactFusionInput, ctx: CoreCtx): ArtifactFusionResult {
  const { fusion } = content.balance;
  const totalUsed = input.materials.reduce((sum, m) => sum + m.count, 0);
  if (totalUsed !== fusion.materials) {
    throw new GameError('fusion-materials', `재료 유물은 정확히 ${fusion.materials}개여야 합니다`);
  }

  let rarity: ArtifactRarity | null = null;
  for (const material of input.materials) {
    if (material.count < 1) throw new GameError('fusion-materials', '재료 수량이 잘못되었습니다');
    const owned = findArtifact(save, material.itemId);
    const def = content.artifacts.get(material.itemId);
    if (!def) throw new GameError('artifact-def-missing', `콘텐츠에 없는 유물: ${material.itemId}`);
    if (owned.count - 1 < material.count) {
      throw new GameError('fusion-spare', `${def.name}의 여분이 부족합니다 (마지막 1개는 재료가 될 수 없습니다)`);
    }
    if (rarity === null) rarity = def.rarity;
    else if (rarity !== def.rarity) throw new GameError('fusion-rarity', '재료는 같은 등급이어야 합니다');
  }
  const nextRarity = RARITY_NEXT[rarity!];
  if (!nextRarity) throw new GameError('fusion-top', `${RARITY_LABEL[rarity!]} 유물은 더 합성할 수 없습니다`);
  // 유물에는 서식 지역이 없다 — 최종 티어 진입(화산 권역)을 관문으로 둔다. 몬스터 초월 관문(분화구 심장부,
  // transcendGateRegion)과 지역이 다른 의도된 비대칭 (2026-08-31): 유물은 서식 풀 폴백 구멍이 없다
  if (isTranscendStep(nextRarity)) {
    const entry = finalTierEntry(content);
    if (!isRegionUnlocked(content, save, entry.id)) {
      throw new GameError('fusion-region', `${RARITY_LABEL[nextRarity]} 합성은 ${entry.name} 권역을 해금해야 도전할 수 있습니다`);
    }
  }
  const chance = fusion.chance[rarity!] ?? 0;

  const next = structuredClone(save);
  for (const material of input.materials) {
    findArtifact(next, material.itemId).count -= material.count;
  }

  next.stats.fusions += 1;
  const rng = streamRng(ctx.newSeed(), 'fusion-artifact');
  const success = rng() < chance;
  if (!success) {
    // 실패 — 재료 중 1개를 랜덤으로 돌려준다 (시드 결정론)
    const usedPool: string[] = input.materials.flatMap((m) => Array.from({ length: m.count }, () => m.itemId));
    const returnedItemId = usedPool[Math.floor(rng() * usedPool.length)]!;
    findArtifact(next, returnedItemId).count += 1;
    settleTasks(content, next);
    return { save: next, success: false, materialRarity: rarity!, returnedItemId };
  }

  const drop = rollArtifactOfRarity(content, rng, nextRarity);
  const isNew = !next.artifacts.some((a) => a.itemId === drop.itemId);
  grantArtifact(next, drop.itemId);
  settleTasks(content, next);
  return { save: next, success: true, materialRarity: rarity!, resultItemId: drop.itemId, isNew };
}

/**
 * 제작 산출 지급 (2026-08-25) — 미끼 또는 모래시계.
 * exhaustive switch라 RecipeOutput에 종류를 추가하면 여기가 컴파일 에러로 미구현을 알린다.
 * 모래시계 지급은 상점(core/shop.ts)과 같은 모양이다 — 지갑 구조가 하나뿐이라 의도된 일치.
 */
function grantRecipeOutput(save: SaveState, output: RecipeOutput): void {
  switch (output.kind) {
    case 'lures':
      save.wallet.lures += output.count;
      return;
    case 'hourglass':
      save.wallet.hourglasses[output.hourglassId] =
        (save.wallet.hourglasses[output.hourglassId] ?? 0) + output.count;
      return;
  }
}

export function craftRecipe(content: Content, save: SaveState, recipeId: string): SaveState {
  const recipe = content.recipes.get(recipeId);
  if (!recipe) throw new GameError('recipe-missing', `없는 레시피: ${recipeId}`);
  const next = structuredClone(save);
  spendGold(next, recipe.cost.gold);
  for (const [materialId, count] of Object.entries(recipe.cost.materials)) {
    const have = next.wallet.materials[materialId] ?? 0;
    if (have < count) {
      const name = content.materials.get(materialId)?.name ?? materialId;
      throw new GameError('material-short', `${name}이(가) 부족합니다 (필요: ${count})`);
    }
    next.wallet.materials[materialId] = have - count;
  }
  grantRecipeOutput(next, recipe.output);
  next.stats.crafts += 1;
  settleTasks(content, next); // 반복 과업 — 보상은 제자리 지급, 알림은 store가 tasks 변화로 감지
  return next;
}

/** 강화 — 종 단위 (개수가 몇이든 강화는 종당 하나, 몬스터 레벨과 동일하게 파견 중에도 허용) */
export function enhanceArtifact(content: Content, save: SaveState, itemId: string): SaveState {
  const next = structuredClone(save);
  const artifact = findArtifact(next, itemId);
  if (artifact.enhance >= content.balance.artifacts.enhance.max) throw new GameError('enhance-max', '이미 최대 강화입니다');
  const cost = artifactEnhanceCost(content, artifact.itemId, artifact.enhance); // 등급 차등 (2026-08-23)
  if (next.wallet.dust < cost) throw new GameError('dust-short', `가루가 부족합니다 (필요: ${cost})`);
  next.wallet.dust -= cost;
  artifact.enhance++;
  return next;
}

export function buyPartySlot(content: Content, save: SaveState): SaveState {
  const unlock = nextPartySlotUnlock(content, save);
  if (!unlock) throw new GameError('slot-max', '파티 슬롯이 이미 최대입니다');
  const counts = capturedCounts(content, save);
  if (counts.total < unlock.totalCaptured) {
    throw new GameError('slot-locked', `도감 ${unlock.totalCaptured}종 포획이 필요합니다`);
  }
  const next = structuredClone(save);
  spendGold(next, unlock.gold);
  next.profile.partySlots = unlock.slots;
  return next;
}

export function unlockRegion(content: Content, save: SaveState, regionId: string): SaveState {
  const check = canUnlockRegion(content, save, regionId);
  if (!check.ok) throw new GameError('region-unlock', check.reason ?? '해금 조건을 채우지 못했습니다');
  const region = content.regions.get(regionId)!;
  const next = structuredClone(save);
  for (const [materialId, count] of Object.entries(region.unlock.materials ?? {})) {
    next.wallet.materials[materialId] = (next.wallet.materials[materialId] ?? 0) - count;
  }
  next.profile.flags[regionFlagKey(regionId)] = true;
  return next;
}

/** 몬스터 편성 잠금 검사 — UI에서 사용 */

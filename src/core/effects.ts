/**
 * Effect 훅 엔진 (DATA.md §1.5) — 시너지·유물 주옵션/부옵션/고유능력·세트·마일스톤 버프를
 * 전부 ActiveEffect 목록으로 정규화하고, 훅+조건으로 조회한다.
 * 새 Action variant를 추가하면 이 파일의 exhaustive switch가 컴파일 에러로 미구현을 알린다.
 */
import type { Content } from '../content';
import type {
  Action,
  ArtifactDef,
  Condition,
  Effect,
  Hook,
  MainStat,
  Monster,
  MonsterRarity,
  Substat,
  Tier,
  Tribe,
} from '../content/schema';
import { clamp } from './formulas';
import type { OwnedArtifact, OwnedMonster, SaveState } from './types';
import { GameError } from './types';

export interface ActiveEffect extends Effect {
  source: string; // 디버그·일지용 출처 (예: "artifact:predators-fang")
}

/** 훅 조회 시점의 상황 — 훅마다 채워지는 필드가 다르다 (schema.ts Condition 주석 참조) */
export interface EffectCtx {
  regionId: string;
  tier: Tier;
  element?: Monster['element'];
  tribe?: Tribe;
  encounterKind?: 'monster' | 'treasure' | 'trap' | 'gather';
  encounterRarity?: MonsterRarity;
  encounterIndex?: number;
  hpRatio?: number;
}

export const RARITY_ORDER: Record<MonsterRarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

export function matchCondition(when: Condition | undefined, ctx: EffectCtx): boolean {
  if (!when) return true;
  if (when.region && !when.region.includes(ctx.regionId)) return false;
  if (when.tier && when.tier !== ctx.tier) return false;
  if (when.element && when.element !== ctx.element) return false;
  if (when.tribe && when.tribe !== ctx.tribe) return false;
  if (when.encounterKind && when.encounterKind !== ctx.encounterKind) return false;
  if (when.encounterRarity) {
    if (ctx.encounterRarity === undefined) return false;
    if (RARITY_ORDER[ctx.encounterRarity] < RARITY_ORDER[when.encounterRarity]) return false;
  }
  if (when.encounterIndex !== undefined && when.encounterIndex !== ctx.encounterIndex) return false;
  if (when.hpBelow !== undefined) {
    if (ctx.hpRatio === undefined || ctx.hpRatio > when.hpBelow) return false;
  }
  return true;
}

export function query(effects: readonly ActiveEffect[], hook: Hook, ctx: EffectCtx): Action[] {
  const out: Action[] = [];
  for (const effect of effects) {
    if (effect.hook !== hook) continue;
    if (!matchCondition(effect.when, ctx)) continue;
    out.push(effect.do);
  }
  return out;
}

// ── 수치 집계 헬퍼 ───────────────────────────────────────────────────────────

/** statMult 합산 — stat 지정분 + 'cp'(양쪽 적용) */
export function sumStatMult(actions: readonly Action[], stat: 'atk' | 'hp'): number {
  let sum = 0;
  for (const action of actions) {
    if (action.kind === 'statMult' && (action.stat === stat || action.stat === 'cp')) sum += action.value;
  }
  return sum;
}

export function sumDamageReduce(actions: readonly Action[], cap: number): number {
  let sum = 0;
  for (const action of actions) {
    if (action.kind === 'damageReduce') sum += action.value;
  }
  return clamp(sum, 0, cap);
}

export function sumOf(actions: readonly Action[], kind: 'captureAdd' | 'crossroadSuccessAdd' | 'synergyAmp'): number {
  let sum = 0;
  for (const action of actions) {
    if (action.kind === kind) sum += action.value;
  }
  return sum;
}

export function sumRewardMult(actions: readonly Action[], target: 'gold' | 'materials', cap: number): number {
  let sum = 0;
  for (const action of actions) {
    if (action.kind === 'rewardMult' && (action.target === target || action.target === 'all')) sum += action.value;
  }
  return Math.min(sum, cap - 1); // 배수 상한: 1 + sum ≤ cap
}

// ── 유물 주옵션/부옵션 → Effect 정규화 ──────────────────────────────────────

function mainStatEffect(stat: MainStat, value: number, source: string): ActiveEffect {
  switch (stat) {
    case 'atkMult':
      return { hook: 'computeParty', do: { kind: 'statMult', stat: 'atk', value }, source };
    case 'hpMult':
      return { hook: 'computeParty', do: { kind: 'statMult', stat: 'hp', value }, source };
    case 'captureAdd':
      return { hook: 'captureRoll', do: { kind: 'captureAdd', value }, source };
    case 'synergyAmp':
      return { hook: 'computeParty', do: { kind: 'synergyAmp', value }, source };
    case 'goldMult':
      return { hook: 'journalEnd', do: { kind: 'rewardMult', target: 'gold', value }, source };
  }
}

function substatEffect(stat: Substat, value: number, source: string): ActiveEffect {
  switch (stat) {
    case 'atkMult':
      return { hook: 'computeParty', do: { kind: 'statMult', stat: 'atk', value }, source };
    case 'hpMult':
      return { hook: 'computeParty', do: { kind: 'statMult', stat: 'hp', value }, source };
    case 'captureAdd':
      return { hook: 'captureRoll', do: { kind: 'captureAdd', value }, source };
    case 'goldMult':
      return { hook: 'journalEnd', do: { kind: 'rewardMult', target: 'gold', value }, source };
    case 'materialMult':
      return { hook: 'journalEnd', do: { kind: 'rewardMult', target: 'materials', value }, source };
    case 'damageReduce':
      return { hook: 'computeParty', do: { kind: 'damageReduce', value }, source };
  }
}

/** 시너지 증폭 — 수치형 payload에 (1+amp) 곱. 정수형(count)·구조형은 그대로 둔다. */
function amplifyAction(action: Action, mult: number): Action {
  switch (action.kind) {
    case 'statMult':
      return { ...action, value: action.value * mult };
    case 'heal':
      return { ...action, ratio: clamp(action.ratio * mult, 0, 1) };
    case 'damageReduce':
      return { ...action, value: clamp(action.value * mult, 0, 1) };
    case 'trapAvoid':
      return { ...action, chance: clamp(action.chance * mult, 0, 1) };
    case 'reviveOnce':
      return { ...action, hpRatio: clamp(action.hpRatio * mult, 0, 1) };
    case 'captureAdd':
      return { ...action, value: action.value * mult };
    case 'rewardMult':
      return { ...action, value: action.value * mult };
    case 'crossroadSuccessAdd':
      return { ...action, value: action.value * mult };
    // 증폭 대상이 아닌 것들 — 구조·정수 semantics 유지
    case 'autoWin':
    case 'captureRetry':
    case 'synergyAmp':
    case 'timeMult':
    case 'encounterAdd':
    case 'encounterMixMult':
    case 'spawnWeightMult':
    case 'salvageOnFail':
    case 'fleeRewardRatioSet':
    case 'healReceivedMult':
      return action;
  }
}

// ── 팀 효과 수집 ─────────────────────────────────────────────────────────────

export interface TeamEffects {
  effects: ActiveEffect[];
  tribeCounts: Map<Tribe, number>;
  synergyAmp: number;
}

export function findArtifact(save: SaveState, uid: string): OwnedArtifact {
  const owned = save.artifacts.find((a) => a.uid === uid);
  if (!owned) throw new GameError('artifact-not-found', `보유하지 않은 유물: ${uid}`);
  return owned;
}

export function findMonster(save: SaveState, uid: string): OwnedMonster {
  const owned = save.roster.find((m) => m.uid === uid);
  if (!owned) throw new GameError('monster-not-found', `보유하지 않은 몬스터: ${uid}`);
  return owned;
}

/**
 * 파티 + 유물 + 마일스톤에서 활성 효과 전체를 수집한다.
 * 순서: ① 유물(주/부옵션·고유)·세트·마일스톤 → ② synergyAmp 합산 → ③ 시너지 효과(증폭 적용)
 */
export function collectTeamEffects(content: Content, save: SaveState, partyUids: string[], artifactUids: string[]): TeamEffects {
  const effects: ActiveEffect[] = [];

  // 유물
  const setCounts = new Map<string, number>();
  for (const uid of artifactUids) {
    const owned = findArtifact(save, uid);
    const def = content.artifacts.get(owned.itemId);
    if (!def) throw new GameError('artifact-def-missing', `콘텐츠에 없는 유물: ${owned.itemId}`);
    const source = `artifact:${def.id}`;
    const mainValue = def.main.base + def.main.perEnhance * owned.enhance;
    effects.push(mainStatEffect(def.main.stat, mainValue, source));
    for (const sub of owned.substats) effects.push(substatEffect(sub.stat, sub.value, source));
    for (const unique of def.unique) effects.push({ ...unique, source });
    if (def.set) setCounts.set(def.set, (setCounts.get(def.set) ?? 0) + 1);
  }

  // 세트 보너스
  for (const [setId, count] of setCounts) {
    const set = content.sets.get(setId);
    if (!set) throw new GameError('set-missing', `콘텐츠에 없는 세트: ${setId}`);
    if (count >= 2) for (const effect of set.bonuses['2']) effects.push({ ...effect, source: `set:${setId}:2` });
    if (count >= 4) for (const effect of set.bonuses['4']) effects.push({ ...effect, source: `set:${setId}:4` });
  }

  // 마일스톤 영구 버프 (저장하지 않고 재계산 — DATA.md §2)
  for (const milestone of content.milestones) {
    if (!save.milestones.includes(milestone.id)) continue;
    for (const effect of milestone.reward.effects ?? []) {
      effects.push({ ...effect, source: `milestone:${milestone.id}` });
    }
  }

  // 시너지 증폭 합산 (조건 없는 synergyAmp만 — 콘텐츠 규약)
  let synergyAmp = 0;
  for (const effect of effects) {
    if (effect.do.kind === 'synergyAmp') synergyAmp += effect.do.value;
  }
  synergyAmp = clamp(synergyAmp, 0, content.balance.artifacts.effectCaps.synergyAmpMax);

  // 종족 시너지
  const tribeCounts = new Map<Tribe, number>();
  for (const uid of partyUids) {
    const owned = findMonster(save, uid);
    const monster = content.monsters.get(owned.monsterId);
    if (!monster) throw new GameError('monster-def-missing', `콘텐츠에 없는 몬스터: ${owned.monsterId}`);
    tribeCounts.set(monster.tribe, (tribeCounts.get(monster.tribe) ?? 0) + 1);
  }
  const ampMult = 1 + synergyAmp;
  for (const [tribe, count] of tribeCounts) {
    if (count < 2) continue;
    const def = content.synergies.get(tribe);
    if (!def) continue;
    const tierEffects = count >= 3 ? def.at3 : def.at2;
    const label = `synergy:${tribe}:${count >= 3 ? 3 : 2}`;
    for (const effect of tierEffects) {
      effects.push({ ...effect, do: amplifyAction(effect.do, ampMult), source: label });
    }
  }

  return { effects, tribeCounts, synergyAmp };
}

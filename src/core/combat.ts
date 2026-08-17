import type {
  BattleLogEntry,
  BattleReport,
  EquipItem,
  Hero,
  Resources,
  UnitCount,
  UnitDef,
} from './types';
import { commandLimit, critChance, troopBonuses } from './heroes';
import { equipTotals, rollItem } from './equipment';

/**
 * 스택 단위 전투 시뮬레이션 (HoMM3 계열 구조).
 * 유닛은 4399 실측 스탯상 물리형(물공>0)과 마법형(마공>0)으로 갈리므로,
 * 각 유닛은 자신이 가진 쪽 공격을 쓰고 상대의 대응 방어로 경감된다.
 *
 * 피해 공식은 원작 자료가 없어 추정: 1기당 피해 = 공격² / (공격 + 방어).
 * 방어가 높을수록 감쇠하되 0이 되지 않는 표준적인 곡선.
 */

const MAX_ROUNDS = 30;
const MAX_LOG = 60;
const CRIT_MULTIPLIER = 1.5;
/** 처치한 적 1기당 경험치 = 병계 × 이 값 (추정) */
const XP_PER_TIER = 5;

interface Stack {
  unitId: string;
  name: string;
  tier: number;
  side: 'attacker' | 'defender';
  unitHp: number;
  /** 남은 총 체력 — 선두 유닛 부상까지 자연히 표현된다 */
  hpPool: number;
  initialCount: number;
  patk: number;
  matk: number;
  pdef: number;
  mdef: number;
  speed: number;
  critChance: number;
}

function aliveCount(s: Stack): number {
  return s.hpPool <= 0 ? 0 : Math.ceil(s.hpPool / s.unitHp);
}

function attackOf(s: Stack): { atk: number; magic: boolean } {
  return s.matk > s.patk ? { atk: s.matk, magic: true } : { atk: s.patk, magic: false };
}

function perUnitDamage(atk: number, def: number): number {
  if (atk <= 0) return 0;
  return (atk * atk) / (atk + Math.max(0, def));
}

function makeStack(
  def: UnitDef,
  n: number,
  side: 'attacker' | 'defender',
  bonus: ReturnType<typeof troopBonuses> | null,
  crit: number,
  unitLevel: number,
): Stack {
  const s = def.stats.find((x) => x.level === unitLevel) ?? def.stats[0];
  const b = bonus ?? { hp: 1, patk: 1, pdef: 1, matk: 1, mdef: 1, speed: 1 };
  const unitHp = Math.max(1, s.hp * b.hp);
  return {
    unitId: def.id,
    name: def.nameKo,
    tier: def.tier,
    side,
    unitHp,
    hpPool: unitHp * n,
    initialCount: n,
    patk: s.patk * b.patk,
    matk: s.matk * b.matk,
    pdef: s.pdef * b.pdef,
    mdef: s.mdef * b.mdef,
    speed: (def.speed ?? 1) * b.speed,
    critChance: crit,
  };
}

/** 위협도가 가장 높은(총 공격력이 큰) 적 스택을 노린다 */
function pickTarget(stacks: Stack[], side: 'attacker' | 'defender'): Stack | null {
  let best: Stack | null = null;
  let bestThreat = -1;
  for (const s of stacks) {
    if (s.side === side || s.hpPool <= 0) continue;
    const threat = aliveCount(s) * attackOf(s).atk;
    if (threat > bestThreat) {
      bestThreat = threat;
      best = s;
    }
  }
  return best;
}

export interface BattleInput {
  hero: Hero;
  attackerArmy: UnitCount[];
  defenderArmy: UnitCount[];
  campId: string;
  campName: string;
  loot: Partial<Resources>;
  unitDefs: Map<string, UnitDef>;
  /** 아군 유닛의 연구 레벨 (없으면 1). 적은 항상 1레벨 */
  unitLevels?: Record<string, number>;
  /** 장비 드롭 판정용 사냥터 난이도 0~1 (없으면 드롭 없음) */
  dropDifficulty?: number;
  now: number;
}

export function simulateBattle(input: BattleInput): BattleReport {
  const { hero, attackerArmy, defenderArmy, unitDefs, unitLevels, now } = input;
  const bonus = troopBonuses(hero);
  const crit = critChance(hero);

  const stacks: Stack[] = [];
  for (const { unitId, count } of attackerArmy) {
    const def = unitDefs.get(unitId);
    if (def && count > 0) {
      stacks.push(makeStack(def, count, 'attacker', bonus, crit, unitLevels?.[unitId] ?? 1));
    }
  }
  for (const { unitId, count } of defenderArmy) {
    const def = unitDefs.get(unitId);
    if (def && count > 0) stacks.push(makeStack(def, count, 'defender', null, 0, 1));
  }

  const log: BattleLogEntry[] = [];
  let round = 0;

  const sideAlive = (side: 'attacker' | 'defender') =>
    stacks.some((s) => s.side === side && s.hpPool > 0);

  while (round < MAX_ROUNDS && sideAlive('attacker') && sideAlive('defender')) {
    round++;
    // 속도 순 행동, 동률이면 공격 측이 먼저
    const order = [...stacks]
      .filter((s) => s.hpPool > 0)
      .sort((a, b) => b.speed - a.speed || (a.side === 'attacker' ? -1 : 1));

    for (const s of order) {
      if (s.hpPool <= 0) continue;
      const target = pickTarget(stacks, s.side);
      if (!target) break;

      const { atk, magic } = attackOf(s);
      const def = magic ? target.mdef : target.pdef;
      const isCrit = s.critChance > 0 && Math.random() < s.critChance;
      const damage =
        perUnitDamage(atk, def) * aliveCount(s) * (isCrit ? CRIT_MULTIPLIER : 1);

      const before = aliveCount(target);
      target.hpPool -= damage;
      const killed = before - aliveCount(target);

      if (log.length < MAX_LOG) {
        log.push({
          round,
          side: s.side,
          attacker: s.name,
          target: target.name,
          damage: Math.round(damage),
          killed,
          crit: isCrit,
        });
      }
    }
  }

  const victory = !sideAlive('defender');

  const losses = (side: 'attacker' | 'defender'): UnitCount[] =>
    stacks
      .filter((s) => s.side === side)
      .map((s) => ({ unitId: s.unitId, count: s.initialCount - aliveCount(s) }))
      .filter((x) => x.count > 0);

  const survivors: UnitCount[] = stacks
    .filter((s) => s.side === 'attacker' && aliveCount(s) > 0)
    .map((s) => ({ unitId: s.unitId, count: aliveCount(s) }));

  const defenderLosses = losses('defender');
  const xpGained = defenderLosses.reduce((sum, l) => {
    const tier = unitDefs.get(l.unitId)?.tier ?? 1;
    return sum + tier * XP_PER_TIER * l.count;
  }, 0);

  // 장비 드롭: 승리 시에만. 보물탐색 목걸이(寻宝项链)가 확률을 배로 올린다(4399 실측 효과)
  const drops: EquipItem[] = [];
  if (victory && input.dropDifficulty !== undefined) {
    const eff = equipTotals(hero).effects;
    const dropMult = eff.dropRate ?? 1;
    const chance = Math.min(0.95, (0.35 + input.dropDifficulty * 0.4) * dropMult);
    if (Math.random() < chance) {
      drops.push(rollItem(hero.level, input.dropDifficulty, Math.random));
    }
  }

  // 약탈 목걸이(掠夺项链)의 약탈 비율 증가 — 4399 실측 효과
  let loot = victory ? { ...input.loot } : {};
  const plunder = equipTotals(hero).effects.plunder ?? 0;
  if (victory && plunder > 0) {
    loot = Object.fromEntries(
      Object.entries(loot).map(([k, v]) => [k, Math.round((v as number) * (1 + plunder / 100))]),
    );
  }

  // 경험 반지(经验戒指)의 획득 경험치 증가 — 4399 실측 효과
  const xpBonus = equipTotals(hero).effects.xpGain ?? 0;

  return {
    id: `${input.campId}-${now}`,
    at: now,
    campId: input.campId,
    campName: input.campName,
    heroName: hero.name,
    victory,
    rounds: round,
    log,
    attackerLosses: losses('attacker'),
    defenderLosses,
    survivors,
    loot,
    xpGained: Math.round(xpGained * (1 + xpBonus / 100)),
    drops,
  };
}

/**
 * 영웅이 지휘할 수 있는 만큼 병력을 고른다 (병계 높은 유닛 우선).
 * 원작의 "영웅 레벨별 지휘 병력" 개념을 따른다.
 */
export function selectArmyForMarch(
  army: Record<string, number>,
  hero: Hero,
  unitDefs: Map<string, UnitDef>,
): UnitCount[] {
  const limit = commandLimit(hero);
  const entries = Object.entries(army)
    .filter(([, n]) => n > 0)
    .sort((a, b) => (unitDefs.get(b[0])?.tier ?? 0) - (unitDefs.get(a[0])?.tier ?? 0));

  const picked: UnitCount[] = [];
  let remaining = limit;
  for (const [unitId, n] of entries) {
    if (remaining <= 0) break;
    const take = Math.min(n, remaining);
    picked.push({ unitId, count: take });
    remaining -= take;
  }
  return picked;
}

import raidData from '../../data/combat/raids.json';
import type {
  BattleReport,
  BuildingDef,
  GameState,
  Hero,
  Resources,
  UnitCount,
  UnitDef,
} from './types';
import { buildingEffect } from './city';
import { simulateBattle } from './combat';

/**
 * 기지 침공(방어전).
 *
 * 출정과 반대로 **내가 수비 측**이다. 놀고 있던 방어 건물 6종이 여기서 각자
 * 다른 방식으로 개입한다:
 *
 *   성벽 · 성문        → 방어 병력의 방어력 배율
 *   실드 제너레이터    → 방어 병력의 실효 체력 배율(역장)
 *   포탑 · 미사일 포탑 → 교전 **전에** 접근하는 적을 요격
 *   지하 병영          → 병력 일부를 대피시켜 전투에서 뺀다(대신 싸우지 않는다)
 *   물류 창고          → 방어 실패 시 약탈량 감소
 *
 * 원작에 NPC 습격이 있었는지는 자료가 없어 수치는 전부 estimate다.
 */

export const RAID_INTERVAL_SECONDS: number = raidData.intervalSeconds;
/** 총 건물 레벨이 이 값 미만이면 아직 침공하지 않는다 (초반 보호) */
const GRACE_BUILDING_LEVELS: number = raidData.graceBuildingLevels;
/** 오래 자리를 비워도 한 번에 이 횟수까지만 몰아친다 */
export const MAX_RAIDS_PER_CATCH_UP: number = raidData.maxPerCatchUp;
const PLUNDER_PERCENT: number = raidData.plunderPercent;
const SCALE_PER_100_POWER: number = raidData.scalePer100Power;

interface RaidWave {
  minPower: number;
  name: string;
  monsters: UnitCount[];
}
const WAVES = raidData.waves as RaidWave[];

/** 침략군은 지휘관이 없다 — 스탯 0짜리 중립 지휘관이면 모든 배율이 1이 된다 */
const NEUTRAL: Hero = {
  id: '__raid',
  name: '침략군',
  level: 1,
  xp: 0,
  stats: { endurance: 0, strength: 0, agility: 0, intellect: 0, spirit: 0, charisma: 0 },
  equipment: {},
};

/** 침공 규모를 정하는 내 전력 = 건물 레벨 합 + 병력 수/10 */
export function raidPower(state: GameState): number {
  const buildings = state.buildings.reduce((sum, b) => sum + b.level, 0);
  const troops = Object.values(state.army).reduce((sum, n) => sum + n, 0);
  return Math.round(buildings + troops / 10);
}

export function totalBuildingLevels(state: GameState): number {
  return state.buildings.reduce((sum, b) => sum + b.level, 0);
}

/** 아직 침공이 시작되지 않는 초반인가 */
export function raidsPaused(state: GameState): boolean {
  return totalBuildingLevels(state) < GRACE_BUILDING_LEVELS;
}

/** 지금 전력에 맞는 침공 규모 */
export function nextWave(state: GameState): { name: string; monsters: UnitCount[] } {
  const power = raidPower(state);
  const wave = [...WAVES].reverse().find((w) => power >= w.minPower) ?? WAVES[0];
  // 같은 파도 안에서도 전력이 높을수록 조금씩 불어난다
  const scale = 1 + ((power - wave.minPower) / 100) * SCALE_PER_100_POWER;
  return {
    name: wave.name,
    monsters: wave.monsters.map((m) => ({
      unitId: m.unitId,
      count: Math.max(1, Math.round(m.count * scale)),
    })),
  };
}

/** 포탑류의 요격 — 위협이 큰(병계 높은) 적부터 걷어 낸다 */
function intercept(
  army: UnitCount[],
  damage: number,
  unitDefs: Map<string, UnitDef>,
): { left: UnitCount[]; killed: UnitCount[] } {
  let budget = damage;
  const order = [...army].sort(
    (a, b) => (unitDefs.get(b.unitId)?.tier ?? 0) - (unitDefs.get(a.unitId)?.tier ?? 0),
  );
  const left: UnitCount[] = [];
  const killed: UnitCount[] = [];
  for (const stack of order) {
    const hp = unitDefs.get(stack.unitId)?.stats.find((s) => s.level === 1)?.hp ?? 1;
    const canKill = Math.min(stack.count, Math.floor(budget / hp));
    budget -= canKill * hp;
    if (canKill > 0) killed.push({ unitId: stack.unitId, count: canKill });
    if (stack.count - canKill > 0) left.push({ unitId: stack.unitId, count: stack.count - canKill });
  }
  return { left, killed };
}

/** 같은 유닛끼리 합친다 */
function mergeCounts(...lists: UnitCount[][]): UnitCount[] {
  const acc: Record<string, number> = {};
  for (const list of lists) {
    for (const { unitId, count } of list) acc[unitId] = (acc[unitId] ?? 0) + count;
  }
  return Object.entries(acc)
    .filter(([, n]) => n > 0)
    .map(([unitId, count]) => ({ unitId, count }));
}

/**
 * 지하 병영이 빼돌리는 병력 — 병계가 높은(비싼) 쪽부터 지킨다.
 *
 * 주둔 병력의 절반까지만 대피시킨다. 상한이 없으면 병영이 클수록 수비대가
 * 텅 비어 **지하 병영 때문에 기지가 함락되는** 뒤집힌 상황이 나온다.
 */
const MAX_HIDE_RATIO = 0.5;

function hideTroops(
  army: Record<string, number>,
  capacity: number,
  unitDefs: Map<string, UnitDef>,
): UnitCount[] {
  if (capacity <= 0) return [];
  const total = Object.values(army).reduce((sum, n) => sum + n, 0);
  const slots = Math.min(capacity, Math.floor(total * MAX_HIDE_RATIO));
  if (slots <= 0) return [];
  const order = Object.entries(army)
    .filter(([, n]) => n > 0)
    .sort((a, b) => (unitDefs.get(b[0])?.tier ?? 0) - (unitDefs.get(a[0])?.tier ?? 0));
  const hidden: UnitCount[] = [];
  let left = slots;
  for (const [unitId, n] of order) {
    if (left <= 0) break;
    const take = Math.min(n, left);
    hidden.push({ unitId, count: take });
    left -= take;
  }
  return hidden;
}

function subtract(army: Record<string, number>, list: UnitCount[]): UnitCount[] {
  const rest: Record<string, number> = { ...army };
  for (const { unitId, count } of list) rest[unitId] = (rest[unitId] ?? 0) - count;
  return Object.entries(rest)
    .filter(([, n]) => n > 0)
    .map(([unitId, count]) => ({ unitId, count }));
}

/**
 * 침공 한 번을 정산한다. state를 직접 바꾸고 리포트를 돌려준다.
 * at은 '침공이 닥친 시각'이라 오프라인 정산에서도 시간이 어긋나지 않는다.
 */
export function resolveRaid(
  state: GameState,
  unitDefs: Map<string, UnitDef>,
  buildingDefs: Map<string, BuildingDef>,
  at: number,
): BattleReport {
  const wave = nextWave(state);

  // ── 지하 병영: 병력 일부를 대피시킨다 (대신 싸우지 않는다) ──
  const hidden = hideTroops(
    state.army,
    buildingEffect(state, buildingDefs, 'hideTroops'),
    unitDefs,
  );
  const garrison = subtract(state.army, hidden);

  // ── 포탑류: 교전 전 요격 ──
  const interceptPower = buildingEffect(state, buildingDefs, 'interceptDamage');
  const { left: raidArmy, killed: interceptedUnits } = intercept(
    wave.monsters,
    interceptPower,
    unitDefs,
  );
  const intercepted = interceptedUnits.reduce((sum, u) => sum + u.count, 0);

  // ── 성벽·성문·실드: 수비 병력 배율 ──
  const defPct = buildingEffect(state, buildingDefs, 'baseDefensePercent');
  const shieldPct = buildingEffect(state, buildingDefs, 'baseShieldPercent');
  const defenderBonus = {
    hp: 1 + shieldPct / 100,
    patk: 1,
    pdef: 1 + defPct / 100,
    matk: 1,
    mdef: 1 + defPct / 100,
    speed: 1,
  };

  const id = `raid-${at}`;
  const base = {
    id,
    at,
    kind: 'raid' as const,
    campId: '__base',
    campName: wave.name,
    heroName: '수비대',
    intercepted,
    hidden,
  };

  // 요격만으로 다 막았다 — 교전이 없다
  if (!raidArmy.length) {
    return {
      ...base,
      victory: true,
      rounds: 0,
      log: [],
      attackerLosses: [],
      defenderLosses: wave.monsters,
      survivors: garrison,
      loot: {},
      xpGained: 0,
    };
  }

  const raw = simulateBattle({
    hero: NEUTRAL,
    attackerArmy: raidArmy,
    defenderArmy: garrison,
    campId: '__base',
    campName: wave.name,
    loot: {},
    unitDefs,
    defenderBonus,
    now: at,
  });

  // 리포트는 늘 '내 편 = attacker* 필드' 규약을 따르므로 양쪽을 뒤집는다
  const defended = !raw.victory;
  const myLosses = raw.defenderLosses;
  const survivors = subtract(
    Object.fromEntries(garrison.map((u) => [u.unitId, u.count])),
    myLosses,
  );

  // 의무동: 막아 냈을 때만 부상병을 수습한다 (출정 전투와 같은 규칙)
  const woundedPct = buildingEffect(state, buildingDefs, 'woundedRecoveryPercent');
  const recovered: UnitCount[] = [];
  if (defended && woundedPct > 0) {
    for (const loss of myLosses) {
      const back = Math.floor((loss.count * woundedPct) / 100);
      if (back <= 0) continue;
      recovered.push({ unitId: loss.unitId, count: back });
      loss.count -= back;
    }
  }

  // ── 병력 반영: 살아남은 수비대 + 대피 병력 + 부상 복귀 ──
  const nextArmy: Record<string, number> = {};
  for (const { unitId, count } of [...survivors, ...hidden, ...recovered]) {
    nextArmy[unitId] = (nextArmy[unitId] ?? 0) + count;
  }
  state.army = nextArmy;

  // ── 약탈: 막지 못하면 자원을 털린다 ──
  const plundered: Partial<Resources> = {};
  if (!defended) {
    const resist = Math.min(90, buildingEffect(state, buildingDefs, 'plunderResistPercent'));
    const pct = (PLUNDER_PERCENT * (1 - resist / 100)) / 100;
    for (const [k, v] of Object.entries(state.resources) as [keyof Resources, number][]) {
      const taken = Math.floor(v * pct);
      if (taken <= 0) continue;
      plundered[k] = taken;
      state.resources[k] = v - taken;
    }
  }

  return {
    ...base,
    victory: defended,
    rounds: raw.rounds,
    // 로그의 진영 표기도 '내 편 = attacker'에 맞춰 뒤집는다
    log: raw.log.map((l) => ({
      ...l,
      side: l.side === 'attacker' ? ('defender' as const) : ('attacker' as const),
    })),
    attackerLosses: myLosses.filter((l) => l.count > 0),
    // 요격으로 없앤 적도 전과에 함께 센다
    defenderLosses: mergeCounts(raw.attackerLosses, interceptedUnits),
    survivors,
    recovered,
    loot: {},
    xpGained: 0,
    plundered,
  };
}

import type { BuildingDef, GameState, Resources, UnitDef } from './types';

/** 유닛 훈련을 담당하는 건물 id */
export const BARRACKS_ID = 'barracks';

export type ActionResult = { ok: true } | { ok: false; reason: string };

export function canAfford(have: Resources, cost: Partial<Resources>): boolean {
  return (Object.entries(cost) as [keyof Resources, number][]).every(
    ([k, v]) => have[k] >= v,
  );
}

function pay(have: Resources, cost: Partial<Resources>): void {
  for (const [k, v] of Object.entries(cost) as [keyof Resources, number][]) {
    have[k] -= v;
  }
}

/** 건물 업그레이드를 큐에 넣는다. 상태를 직접 변경한다(호출 전 advance 필수). */
export function startUpgrade(
  state: GameState,
  def: BuildingDef,
  now: number,
): ActionResult {
  if (state.upgradeQueue) return { ok: false, reason: '건설 큐가 이미 사용 중입니다.' };

  const building = state.buildings.find((b) => b.defId === def.id);
  if (!building) return { ok: false, reason: '도시에 없는 건물입니다.' };

  const targetLevel = building.level + 1;
  const levelDef = def.levels[targetLevel - 1];
  if (!levelDef) return { ok: false, reason: '이미 최대 레벨입니다.' };

  if (!canAfford(state.resources, levelDef.upgradeCost)) {
    return { ok: false, reason: '자원이 부족합니다.' };
  }

  pay(state.resources, levelDef.upgradeCost);
  state.upgradeQueue = {
    defId: def.id,
    targetLevel,
    finishesAt: now + levelDef.upgradeSeconds * 1000,
  };
  return { ok: true };
}

/** 유닛 훈련을 큐에 넣는다. 상태를 직접 변경한다(호출 전 advance 필수). */
export function startTraining(
  state: GameState,
  def: UnitDef,
  count: number,
  now: number,
): ActionResult {
  if (count < 1) return { ok: false, reason: '수량이 잘못됐습니다.' };
  if (state.trainQueue) return { ok: false, reason: '훈련 큐가 이미 사용 중입니다.' };

  const barracks = state.buildings.find((b) => b.defId === BARRACKS_ID);
  const barracksLevel = barracks?.level ?? 0;
  if (barracksLevel < 1) return { ok: false, reason: '병영을 먼저 지어야 합니다.' };
  if (def.tier > barracksLevel) {
    return { ok: false, reason: `병영 Lv.${def.tier} 필요 (현재 Lv.${barracksLevel})` };
  }

  const totalCost: Partial<Resources> = {};
  for (const [k, v] of Object.entries(def.cost) as [keyof Resources, number][]) {
    if (v > 0) totalCost[k] = v * count;
  }
  if (!canAfford(state.resources, totalCost)) {
    return { ok: false, reason: '자원이 부족합니다.' };
  }

  pay(state.resources, totalCost);
  state.trainQueue = {
    unitId: def.id,
    count,
    finishesAt: now + (def.trainSeconds ?? 60) * count * 1000,
  };
  return { ok: true };
}

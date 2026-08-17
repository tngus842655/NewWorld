import type { BuildingDef, GameState, Resources } from './types';

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

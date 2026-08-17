import type { BuildingDef, GameState, UnitDef } from './types';

/**
 * 경과 시간만큼 상태를 전진시키는 순수 함수.
 * 원작의 특징인 "접속하지 않아도 실시간 진행"(오프라인 진행)이 여기서 나온다:
 * 저장된 updatedAt과 현재 시각의 차이만큼 자원 생산·건설·훈련 완료를 몰아서 반영한다.
 *
 * 완료 이벤트(건설/훈련)를 시간순으로 처리하고 그 사이 구간마다 생산·식량소모를
 * 계산해야 "완료 시점 이후부터 새 수치 적용"이 정확해진다.
 */
export function advance(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  now: number,
): GameState {
  if (now <= state.updatedAt) return state;

  const next: GameState = structuredClone(state);

  type Ev = { at: number; kind: 'build' | 'train' };
  const events: Ev[] = [];
  if (next.upgradeQueue && next.upgradeQueue.finishesAt <= now) {
    events.push({ at: next.upgradeQueue.finishesAt, kind: 'build' });
  }
  if (next.trainQueue && next.trainQueue.finishesAt <= now) {
    events.push({ at: next.trainQueue.finishesAt, kind: 'train' });
  }
  events.sort((a, b) => a.at - b.at);

  let from = next.updatedAt;
  for (const ev of events) {
    settle(next, buildingDefs, unitDefs, from, ev.at);
    if (ev.kind === 'build' && next.upgradeQueue) {
      const b = next.buildings.find((x) => x.defId === next.upgradeQueue!.defId);
      if (b) b.level = next.upgradeQueue.targetLevel;
      next.upgradeQueue = null;
    } else if (ev.kind === 'train' && next.trainQueue) {
      const { unitId, count } = next.trainQueue;
      next.army[unitId] = (next.army[unitId] ?? 0) + count;
      next.trainQueue = null;
    }
    from = ev.at;
  }
  settle(next, buildingDefs, unitDefs, from, now);

  next.updatedAt = now;
  return next;
}

/** from~to 구간의 자원 생산과 병력 식량 소모를 반영 */
function settle(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  from: number,
  to: number,
): void {
  const hours = (to - from) / 3_600_000;
  if (hours <= 0) return;

  for (const b of state.buildings) {
    if (b.level <= 0) continue;
    const def = buildingDefs.get(b.defId);
    if (!def?.produces) continue;
    const lvl = def.levels[b.level - 1];
    if (!lvl?.productionPerHour) continue;
    state.resources[def.produces] += lvl.productionPerHour * hours;
  }

  // 병력 식량 소모 (원작 每小时消耗粮食). 지금은 0 밑으로 내려가지 않게만 처리 —
  // 식량 고갈 페널티(병력 이탈 등)는 원작 사양 확인 후 구현.
  let upkeepPerHour = 0;
  for (const [unitId, count] of Object.entries(state.army)) {
    const def = unitDefs.get(unitId);
    if (def?.foodUpkeepPerHour) upkeepPerHour += def.foodUpkeepPerHour * count;
  }
  if (upkeepPerHour > 0) {
    state.resources.food = Math.max(0, state.resources.food - upkeepPerHour * hours);
  }
}

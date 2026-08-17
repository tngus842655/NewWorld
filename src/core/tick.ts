import type { BuildingDef, GameState, NodeDef, ResourceKind, Resources, UnitDef } from './types';
import { grantXp } from './heroes';
import { productionBoosts } from './city';

/** 리포트 보관 개수 — Supabase jsonb 크기를 억제한다. 직접 삭제도 가능. */
const MAX_REPORTS = 30;

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
  nodeDefs: Map<string, NodeDef>,
  now: number,
): GameState {
  if (now <= state.updatedAt) return state;

  const next: GameState = structuredClone(state);

  type Ev = { at: number; kind: 'build' | 'train' | 'march' | 'research' };
  const events: Ev[] = [];
  if (next.upgradeQueue && next.upgradeQueue.finishesAt <= now) {
    events.push({ at: next.upgradeQueue.finishesAt, kind: 'build' });
  }
  if (next.trainQueue && next.trainQueue.finishesAt <= now) {
    events.push({ at: next.trainQueue.finishesAt, kind: 'train' });
  }
  if (next.researchQueue && next.researchQueue.finishesAt <= now) {
    events.push({ at: next.researchQueue.finishesAt, kind: 'research' });
  }
  if (next.march && next.march.returnsAt <= now) {
    events.push({ at: next.march.returnsAt, kind: 'march' });
  }
  events.sort((a, b) => a.at - b.at);

  let from = next.updatedAt;
  for (const ev of events) {
    settle(next, buildingDefs, unitDefs, nodeDefs, from, ev.at);
    if (ev.kind === 'build' && next.upgradeQueue) {
      const b = next.buildings.find((x) => x.defId === next.upgradeQueue!.defId);
      if (b) b.level = next.upgradeQueue.targetLevel;
      next.upgradeQueue = null;
    } else if (ev.kind === 'train' && next.trainQueue) {
      const { unitId, count } = next.trainQueue;
      next.army[unitId] = (next.army[unitId] ?? 0) + count;
      next.trainQueue = null;
    } else if (ev.kind === 'research' && next.researchQueue) {
      const { unitId, targetLevel } = next.researchQueue;
      next.unitLevels[unitId] = targetLevel;
      next.researchQueue = null;
    } else if (ev.kind === 'march' && next.march) {
      finishMarch(next);
    }
    from = ev.at;
  }
  settle(next, buildingDefs, unitDefs, nodeDefs, from, now);

  next.updatedAt = now;
  return next;
}

/** 부대 귀환: 생존자 복귀 + 전리품·경험치 반영 + 점령 처리 + 리포트 보관 */
function finishMarch(state: GameState): void {
  const march = state.march;
  if (!march) return;
  const { report } = march;

  for (const { unitId, count } of report.survivors) {
    state.army[unitId] = (state.army[unitId] ?? 0) + count;
  }

  if (march.kind === 'capture' && report.victory) {
    report.captured = true;
    state.heldNodes.push({ nodeId: march.campId, capturedAt: march.returnsAt });
  }
  for (const [k, v] of Object.entries(report.loot) as [keyof Resources, number][]) {
    state.resources[k] += v;
  }
  const hero = state.heroes.find((h) => h.id === march.heroId);
  if (hero) grantXp(hero, report.xpGained);

  for (const item of report.drops ?? []) state.inventory.push(item);

  state.reports.unshift(report);
  state.reports.length = Math.min(state.reports.length, MAX_REPORTS);
  state.march = null;
}

/** from~to 구간의 자원 생산(건물+점령 자원지)과 병력 식량 소모를 반영 */
function settle(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  nodeDefs: Map<string, NodeDef>,
  from: number,
  to: number,
): void {
  const hours = (to - from) / 3_600_000;
  if (hours <= 0) return;

  // 가공 건물(정제소·발전소 등)이 올려 주는 산출 보정 — 자원 건물과 자원지 모두에 곱한다
  const boosts = productionBoosts(state, buildingDefs);
  const rate = (kind: ResourceKind) => 1 + (boosts[kind] ?? 0) / 100;

  for (const b of state.buildings) {
    if (b.level <= 0) continue;
    const def = buildingDefs.get(b.defId);
    if (!def?.produces) continue;
    const lvl = def.levels[b.level - 1];
    if (!lvl?.productionPerHour) continue;
    state.resources[def.produces] += lvl.productionPerHour * hours * rate(def.produces);
  }

  // 점령한 자원지 생산 — 점령 시각 이후 구간만 반영
  for (const h of state.heldNodes) {
    const def = nodeDefs.get(h.nodeId);
    if (!def) continue;
    const effFrom = Math.max(from, h.capturedAt);
    const effHours = (to - effFrom) / 3_600_000;
    if (effHours > 0) state.resources[def.produces] += def.perHour * effHours * rate(def.produces);
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

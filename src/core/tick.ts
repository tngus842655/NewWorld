import type {
  BuildingDef,
  GameState,
  MarchJob,
  NodeDef,
  ResourceKind,
  Resources,
  UnitDef,
  UpgradeJob,
} from './types';
import { grantXp } from './heroes';
import { productionBoosts, storageCap } from './city';
import {
  MAX_RAIDS_PER_CATCH_UP,
  RAID_INTERVAL_SECONDS,
  raidsPaused,
  resolveRaid,
} from './raid';

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

  type Ev = {
    at: number;
    kind: 'build' | 'train' | 'march' | 'research' | 'raid';
    job?: UpgradeJob;
    march?: MarchJob;
  };
  const events: Ev[] = [];
  // 건설은 슬롯마다 따로 끝난다 — 끝난 순서대로 하나씩 반영해야
  // "완료 시점 이후부터 새 생산량" 계산이 어긋나지 않는다
  for (const job of next.upgradeQueue) {
    if (job.finishesAt <= now) events.push({ at: job.finishesAt, kind: 'build', job });
  }
  if (next.trainQueue && next.trainQueue.finishesAt <= now) {
    events.push({ at: next.trainQueue.finishesAt, kind: 'train' });
  }
  if (next.researchQueue && next.researchQueue.finishesAt <= now) {
    events.push({ at: next.researchQueue.finishesAt, kind: 'research' });
  }
  // 출정도 부대마다 따로 돌아온다
  for (const march of next.march) {
    if (march.returnsAt <= now) events.push({ at: march.returnsAt, kind: 'march', march });
  }
  // 침공 — 자리를 오래 비웠어도 한 번에 몰아치지 않게 횟수를 제한한다
  for (const at of scheduleRaids(next, now)) events.push({ at, kind: 'raid' });
  events.sort((a, b) => a.at - b.at);

  let from = next.updatedAt;
  for (const ev of events) {
    settle(next, buildingDefs, unitDefs, nodeDefs, from, ev.at);
    if (ev.kind === 'build' && ev.job) {
      const b = next.buildings.find((x) => x.defId === ev.job!.defId);
      if (b) b.level = Math.max(b.level, ev.job.targetLevel);
      next.upgradeQueue = next.upgradeQueue.filter((j) => j !== ev.job);
    } else if (ev.kind === 'train' && next.trainQueue) {
      const { unitId, count } = next.trainQueue;
      next.army[unitId] = (next.army[unitId] ?? 0) + count;
      next.trainQueue = null;
    } else if (ev.kind === 'research' && next.researchQueue) {
      const { unitId, targetLevel } = next.researchQueue;
      next.unitLevels[unitId] = targetLevel;
      next.researchQueue = null;
    } else if (ev.kind === 'march' && ev.march) {
      finishMarch(next, ev.march);
    } else if (ev.kind === 'raid') {
      const report = resolveRaid(next, unitDefs, buildingDefs, ev.at);
      next.reports.unshift(report);
      next.reports.length = Math.min(next.reports.length, MAX_REPORTS);
    }
    from = ev.at;
  }
  settle(next, buildingDefs, unitDefs, nodeDefs, from, now);

  next.updatedAt = now;
  return next;
}

/**
 * 침공 일정을 잡고, 이번 구간에 닥친 침공을 이벤트로 만든다.
 *
 * 오래 자리를 비우면 밀린 침공이 수십 번 쌓일 수 있어 한 번에 처리하는 횟수를
 * 제한한다(자비 규칙). 남은 몫은 버리고 다음 침공 시각을 now 기준으로 다시 잡는다.
 */
function scheduleRaids(state: GameState, now: number): number[] {
  const interval = RAID_INTERVAL_SECONDS * 1000;

  // 아직 지킬 게 없는 초반이거나 첫 일정이면 그냥 다음 시각만 잡아 둔다
  if (raidsPaused(state) || state.nextRaidAt === undefined) {
    state.nextRaidAt = now + interval;
    return [];
  }

  const due: number[] = [];
  let at = state.nextRaidAt;
  while (at <= now && due.length < MAX_RAIDS_PER_CATCH_UP) {
    due.push(at);
    at += interval;
  }
  // 밀린 몫이 남았으면 버리고 지금 기준으로 다시 잡는다
  state.nextRaidAt = at <= now ? now + interval : at;
  return due;
}

/** 부대 귀환: 생존자 복귀 + 전리품·경험치 반영 + 점령 처리 + 리포트 보관 */
function finishMarch(state: GameState, march: MarchJob): void {
  const { report } = march;

  // 생환자 + 의무동이 살려 낸 부상병이 함께 복귀한다
  for (const { unitId, count } of [...report.survivors, ...(report.recovered ?? [])]) {
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
  state.march = state.march.filter((m) => m !== march);
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

  /**
   * 생산분을 보관 한도까지만 채운다.
   * 이미 한도를 넘겨 들고 있어도(전리품 등) 깎지 않는다 — 생산이 멈출 뿐이다.
   */
  const cap = storageCap(state, buildingDefs);
  const produce = (kind: ResourceKind, amount: number) => {
    const have = state.resources[kind];
    state.resources[kind] = Math.max(have, Math.min(cap, have + amount));
  };

  for (const b of state.buildings) {
    if (b.level <= 0) continue;
    const def = buildingDefs.get(b.defId);
    if (!def?.produces) continue;
    const lvl = def.levels[b.level - 1];
    if (!lvl?.productionPerHour) continue;
    produce(def.produces, lvl.productionPerHour * hours * rate(def.produces));
  }

  // 점령한 자원지 생산 — 점령 시각 이후 구간만 반영
  for (const h of state.heldNodes) {
    const def = nodeDefs.get(h.nodeId);
    if (!def) continue;
    const effFrom = Math.max(from, h.capturedAt);
    const effHours = (to - effFrom) / 3_600_000;
    if (effHours > 0) produce(def.produces, def.perHour * effHours * rate(def.produces));
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

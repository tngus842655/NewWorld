import type { BuildingDef, GameState } from './types';

/**
 * 경과 시간만큼 상태를 전진시키는 순수 함수.
 * 원작의 특징인 "접속하지 않아도 실시간 진행"(오프라인 진행)이 여기서 나온다:
 * 저장된 updatedAt과 현재 시각의 차이만큼 자원 생산과 건설 완료를 몰아서 반영한다.
 */
export function advance(state: GameState, defs: Map<string, BuildingDef>, now: number): GameState {
  if (now <= state.updatedAt) return state;

  const next: GameState = structuredClone(state);

  // 1) 건설 완료 처리 — 완료 시점 이전/이후로 나눠 생산량을 계산해야
  //    "업그레이드가 끝난 뒤부터 새 생산량 적용"이 정확해진다.
  let from = state.updatedAt;
  const queue = next.upgradeQueue;
  if (queue && queue.finishesAt <= now) {
    produce(next, defs, from, queue.finishesAt);
    const b = next.buildings.find((x) => x.defId === queue.defId);
    if (b) b.level = queue.targetLevel;
    next.upgradeQueue = null;
    from = queue.finishesAt;
  }

  // 2) 남은 구간 생산
  produce(next, defs, from, now);

  next.updatedAt = now;
  return next;
}

function produce(state: GameState, defs: Map<string, BuildingDef>, from: number, to: number): void {
  const hours = (to - from) / 3_600_000;
  if (hours <= 0) return;

  for (const b of state.buildings) {
    if (b.level <= 0) continue;
    const def = defs.get(b.defId);
    if (!def?.produces) continue;
    const lvl = def.levels[b.level - 1];
    if (!lvl?.productionPerHour) continue;
    state.resources[def.produces] += lvl.productionPerHour * hours;
  }
}

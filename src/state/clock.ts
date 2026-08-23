/**
 * 게임 시계 (TECH.md §7) — 서버 오프셋(M4) 보정을 한 곳에서.
 * core에는 항상 이 now()를 ctx로 주입한다. core 내부 Date.now() 금지.
 * 시계를 앞으로 감는 기능은 없다 — 출석 등 달력 시스템이 같이 밀리기 때문.
 * 개발용 가속은 원정 시간축만 미는 store.devAccelerateExpeditions()로.
 */

let serverOffset = 0; // M4: Supabase 시간과의 보정치
const listeners = new Set<() => void>();

export function now(): number {
  return Date.now() + serverOffset;
}

export function setServerOffset(ms: number): void {
  serverOffset = ms;
  for (const listener of listeners) listener();
}

export function onClockJump(listener: () => void): void {
  listeners.add(listener);
}

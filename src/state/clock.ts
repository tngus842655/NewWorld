/**
 * 게임 시계 (TECH.md §7) — 서버 오프셋(M4)과 개발용 시간 가속을 한 곳에서.
 * core에는 항상 이 now()를 ctx로 주입한다. core 내부 Date.now() 금지.
 */

let serverOffset = 0; // M4: Supabase 시간과의 보정치
let devSkew = 0; // 개발용 시간 가속 (DEV 빌드에서만 조작)
const listeners = new Set<() => void>();

export function now(): number {
  return Date.now() + serverOffset + devSkew;
}

export function setServerOffset(ms: number): void {
  serverOffset = ms;
  for (const listener of listeners) listener();
}

/** 개발용: 시간을 앞으로 감는다 (빌드가 DEV일 때만 UI 노출) */
export function addDevSkew(ms: number): void {
  devSkew += ms;
  for (const listener of listeners) listener();
}

export function onClockJump(listener: () => void): void {
  listeners.add(listener);
}

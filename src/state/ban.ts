/**
 * 이용 제한(블랙리스트) 판정 — 순수부 (검토 ⑥, 2026-08-30).
 * 정본은 profiles.banned_until(timestamptz): null = 정상, 'infinity' = 영구,
 * 미래 시각 = 임시. 지정·해제는 대시보드(service role) SQL로만 — 컬럼 권한이
 * 클라 변경을 막는다 (0006·0007). 서버 강제는 saves RLS·submit-score가 담당하고,
 * 클라는 이 판정으로 안내 화면만 띄운다.
 */

export interface BanInfo {
  until: string; // PostgREST 직렬화 값 — ISO 8601 또는 'infinity'
  reason: string | null;
}

/** banned_until 값이 현재 유효한 제한인지 — 'infinity'는 항상, ISO는 미래일 때만 */
export function isBanActive(until: string | null | undefined, now: number): boolean {
  if (!until) return false;
  if (until === 'infinity') return true;
  const at = Date.parse(until);
  return Number.isFinite(at) && at > now;
}

/** 안내 화면용 기간 표기 */
export function describeBanUntil(until: string): string {
  if (until === 'infinity') return '영구';
  const at = new Date(until);
  return `${at.getFullYear()}.${at.getMonth() + 1}.${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}까지`;
}

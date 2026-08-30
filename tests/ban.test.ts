/**
 * 이용 제한 판정 (검토 ⑥) — 순수부만. 서버 강제(saves RLS·submit-score)는 원격 검증.
 */
import { describe, expect, it } from 'vitest';
import { describeBanUntil, isBanActive } from '../src/state/ban';

describe('이용 제한 판정 (isBanActive)', () => {
  const now = Date.parse('2026-08-30T12:00:00+09:00');

  it('null·undefined = 정상', () => {
    expect(isBanActive(null, now)).toBe(false);
    expect(isBanActive(undefined, now)).toBe(false);
  });

  it("'infinity'(영구)는 항상 제한 — JS Date.parse가 못 읽는 값이라 특별 취급", () => {
    expect(isBanActive('infinity', now)).toBe(true);
  });

  it('미래 시각 = 임시 제한, 지난 시각 = 자동 해제', () => {
    expect(isBanActive('2026-09-06T12:00:00+09:00', now)).toBe(true);
    expect(isBanActive('2026-08-30T11:59:59+09:00', now)).toBe(false);
  });

  it('알 수 없는 문자열은 제한으로 오판하지 않는다', () => {
    expect(isBanActive('garbage', now)).toBe(false);
  });
});

describe('기간 표기 (describeBanUntil)', () => {
  it('영구와 임시를 구분한다', () => {
    expect(describeBanUntil('infinity')).toBe('영구');
    expect(describeBanUntil(new Date(2026, 8, 6, 9, 5).toISOString())).toBe('2026.9.6 09:05까지');
  });
});

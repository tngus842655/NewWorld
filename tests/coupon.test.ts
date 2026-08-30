/**
 * 쿠폰 재화 지급 (검토 ⑦) — 순수부만. 서버 원자성(인당 1회·수량·만료)은 RPC로 원격 검증 완료.
 */
import { describe, expect, it } from 'vitest';
import { applyCouponGoods, parseCouponGoods } from '../src/core/coupon';
import { content, makeCtx, saveWithParty } from './helpers';

describe('쿠폰 goods 검증 (parseCouponGoods)', () => {
  it('알 수 없는 키는 벗겨내고 정상 필드만 남긴다', () => {
    expect(parseCouponGoods({ diamonds: 300, hax: 999 })).toEqual({ diamonds: 300 });
  });

  it('음수·소수·비객체는 거부한다 — 깨진 운영 데이터가 지갑을 오염시키지 않게', () => {
    expect(parseCouponGoods({ gold: -100 })).toBeNull();
    expect(parseCouponGoods({ diamonds: 1.5 })).toBeNull();
    expect(parseCouponGoods('gold')).toBeNull();
    expect(parseCouponGoods(null)).toBeNull();
  });
});

describe('쿠폰 지급 (applyCouponGoods)', () => {
  it('재화 4종 + 재료를 지갑에 더하고 요약을 만든다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { gold: 100 });
    const materialId = content.regionList[0]!.materials[0]!;
    const { next, summary } = applyCouponGoods(content, save, {
      gold: 1000, diamonds: 300, lures: 5, materials: { [materialId]: 10 },
    });
    expect(next.wallet.gold).toBe(1100);
    expect(next.wallet.diamonds).toBe(save.wallet.diamonds + 300);
    expect(next.wallet.lures).toBe(save.wallet.lures + 5);
    expect(next.wallet.materials[materialId]).toBe((save.wallet.materials[materialId] ?? 0) + 10);
    expect(summary).toContain('골드 1,000');
    expect(summary).toContain('💎 300');
    // 원본은 불변
    expect(save.wallet.gold).toBe(100);
  });

  it('콘텐츠에 없는 재료 id는 조용히 건너뛴다 (운영 오타 방어)', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const { next, summary } = applyCouponGoods(content, save, { materials: { 'no-such-material': 5 } });
    expect(next.wallet.materials['no-such-material']).toBeUndefined();
    expect(summary).toBe('지급 품목 없음');
  });
});

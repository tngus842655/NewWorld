/**
 * 다이아 원장 (검토 ⑤ 2층) — 합계 불변식(원장 합계 = 잔액)이 핵심.
 * 서버 감사(0012 diamond_audit)가 이 불변식으로 조작을 걸러낸다.
 */
import { describe, expect, it } from 'vitest';
import { checkIn } from '../src/core/attendance';
import { applyCouponGoods } from '../src/core/coupon';
import { DIAMOND_LOG_CAP, diamondLedgerSum, logDiamonds } from '../src/core/diamondLog';
import { buyShopProduct } from '../src/core/shop';
import { content, makeCtx, saveWithParty } from './helpers';

describe('원장 기록 (logDiamonds)', () => {
  it('상한 초과분은 오래된 항목부터 base로 접힌다 — 합계는 불변', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    for (let i = 0; i < DIAMOND_LOG_CAP + 30; i++) {
      save.wallet.diamonds += 1;
      logDiamonds(save, 1, `coupon:T${i}`, i);
    }
    expect(save.diamondLog).toHaveLength(DIAMOND_LOG_CAP);
    expect(save.diamondLogBase).toBe(30);
    expect(diamondLedgerSum(save)).toBe(save.wallet.diamonds);
    expect(save.diamondLog[0]!.source).toBe('coupon:T30'); // 앞이 잘려나갔다
  });

  it('delta 0은 기록하지 않는다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    logDiamonds(save, 0, 'coupon:ZERO', 0);
    expect(save.diamondLog).toHaveLength(0);
  });
});

describe('증감 지점 계측 — 합계 불변식 유지', () => {
  it('출석 다이아 보상이 attendance:월-일 로 남는다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    // 3번째 출석이 💎 (balance.attendance.rewards[2]) — 1·2일차 먼저 소화
    const day = 86_400_000;
    let state = checkIn(content, save, day).save;
    state = checkIn(content, state, day * 2).save;
    const before = state.wallet.diamonds;
    const result = checkIn(content, state, day * 3);
    const gained = result.save.wallet.diamonds - before;
    expect(gained).toBeGreaterThan(0);
    const entry = result.save.diamondLog.at(-1)!;
    expect(entry.delta).toBe(gained);
    expect(entry.source).toMatch(/^attendance:\d{4}-\d{1,2}-\d{1,2}$/);
    expect(diamondLedgerSum(result.save)).toBe(result.save.wallet.diamonds);
  });

  it('다이아 상점 소비가 shop:상품id 음수로 남는다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { unlockAll: true });
    const product = content.shopProducts.find((p) => p.shop === 'diamond' && p.limit.kind === 'none')!;
    save.wallet.diamonds = product.price + 10;
    logDiamonds(save, save.wallet.diamonds, 'coupon:SEED', 0); // 시드 정합
    const result = buyShopProduct(content, save, { productId: product.id }, clock.ctx);
    const entry = result.save.diamondLog.find((e) => e.source === `shop:${product.id}`)!;
    expect(entry.delta).toBe(-product.price);
    expect(diamondLedgerSum(result.save)).toBe(result.save.wallet.diamonds);
  });

  it('쿠폰 다이아가 coupon:코드 로 남는다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const { next } = applyCouponGoods(content, save, { diamonds: 300 }, { code: 'WELCOME-300', at: 123 });
    expect(next.diamondLog.at(-1)).toEqual({ at: 123, delta: 300, source: 'coupon:WELCOME-300' });
    expect(diamondLedgerSum(next)).toBe(next.wallet.diamonds);
  });
});

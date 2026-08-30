/**
 * 쿠폰 사용 (검토 ⑦, 2026-08-30) — 서버(redeem-coupon 엣지 함수)가 인당 1회·수량·만료를
 * 원자적으로 판정하고, 클라는 응답 goods를 core/coupon.ts로 검증·지급한다.
 * 지급이 서버 확정 직후라 앱이 그 틈에 죽으면 쿠폰만 소모될 수 있는데(밀리초 창),
 * 실결제가 아니라 수용 — 문의 오면 기록(coupon_redemptions)으로 확인 가능.
 */
import { content } from '../content';
import { applyCouponGoods, parseCouponGoods } from '../core/coupon';
import { cloudSession } from './cloud';
import { save } from './store';
import { supabase } from './supabaseClient';

const ERROR_MESSAGE: Record<string, string> = {
  invalid: '존재하지 않는 쿠폰입니다',
  expired: '기간이 지난 쿠폰입니다',
  exhausted: '준비된 수량이 모두 소진되었습니다',
  already: '이미 사용한 쿠폰입니다',
  banned: '이용 제한 중에는 사용할 수 없습니다',
  auth: '로그인이 필요합니다',
};

export interface CouponResult {
  ok: boolean;
  message: string; // 토스트 문구 — 성공 시 지급 요약
}

export async function redeemCoupon(rawCode: string): Promise<CouponResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) return { ok: false, message: '쿠폰 번호 형식이 올바르지 않습니다' };

  // DEV 한정 시뮬 (dev-guest — 세션 없음): 서버 없이 지급 경로를 검증한다 (IAP DEV_SIM과 같은 관례)
  if (import.meta.env.DEV && !cloudSession()) {
    if (code !== 'DEV-TEST') return { ok: false, message: ERROR_MESSAGE['invalid']! };
    const { next, summary } = applyCouponGoods(content, save(), { gold: 1000, diamonds: 300, lures: 5 });
    save.set(next);
    return { ok: true, message: `지급 완료 — ${summary}` };
  }

  interface RedeemResponse { ok?: boolean; error?: string; goods?: unknown }
  let data: RedeemResponse | null = null;
  try {
    const res = await supabase.functions.invoke('redeem-coupon', { body: { code } });
    if (res.error) {
      // invoke는 2xx가 아니면 error로 떨어진다 — 본문의 error 코드를 건져 안내한다
      const body = await (res.error as { context?: Response }).context?.json?.().catch(() => null);
      const known = body && typeof body === 'object' ? ERROR_MESSAGE[String((body as Record<string, unknown>)['error'])] : undefined;
      return { ok: false, message: known ?? '쿠폰 사용에 실패했습니다 — 잠시 후 다시 시도해 주세요' };
    }
    data = res.data as RedeemResponse | null;
  } catch {
    return { ok: false, message: '네트워크 오류 — 연결을 확인해 주세요' };
  }

  if (!data?.ok) {
    return { ok: false, message: ERROR_MESSAGE[String(data?.error)] ?? '쿠폰 사용에 실패했습니다' };
  }
  const goods = parseCouponGoods(data.goods);
  if (!goods) return { ok: false, message: '쿠폰 구성이 올바르지 않습니다 — 문의해 주세요' };
  const { next, summary } = applyCouponGoods(content, save(), goods);
  save.set(next);
  return { ok: true, message: `지급 완료 — ${summary}` };
}

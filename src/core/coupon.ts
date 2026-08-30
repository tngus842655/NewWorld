/**
 * 쿠폰 재화 지급 — 순수부 (검토 ⑦, 2026-08-30).
 * 사용 판정(1인 1회·수량·만료)은 서버가 원자적으로 끝내고(redeem_coupon RPC),
 * 클라는 서버가 돌려준 goods를 여기서 검증·지급만 한다. goods는 서버 데이터지만
 * 운영자 입력이라 스키마로 방어한다 — 깨진 값이 지갑을 오염시키지 않게.
 */
import { z } from 'zod';
import type { Content } from '../content';
import type { SaveState } from './types';

const CouponGoodsSchema = z.object({
  gold: z.number().int().nonnegative().optional(),
  dust: z.number().int().nonnegative().optional(),
  diamonds: z.number().int().nonnegative().optional(),
  lures: z.number().int().nonnegative().optional(),
  materials: z.record(z.string(), z.number().int().nonnegative()).optional(),
}).strip();

export type CouponGoods = z.infer<typeof CouponGoodsSchema>;

/** 서버 응답의 goods 검증 — 스키마 위반은 null (지급하지 않는다) */
export function parseCouponGoods(raw: unknown): CouponGoods | null {
  const parsed = CouponGoodsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface CouponApplyResult {
  next: SaveState;
  summary: string; // 토스트용 — "골드 1,000 · 💎 300 · 미끼 5"
}

export function applyCouponGoods(content: Content, save: SaveState, goods: CouponGoods): CouponApplyResult {
  const next = structuredClone(save);
  const parts: string[] = [];
  if (goods.gold) {
    next.wallet.gold += goods.gold;
    parts.push(`골드 ${goods.gold.toLocaleString()}`);
  }
  if (goods.dust) {
    next.wallet.dust += goods.dust;
    parts.push(`가루 ${goods.dust.toLocaleString()}`);
  }
  if (goods.diamonds) {
    next.wallet.diamonds += goods.diamonds;
    parts.push(`💎 ${goods.diamonds.toLocaleString()}`);
  }
  if (goods.lures) {
    next.wallet.lures += goods.lures;
    parts.push(`미끼 ${goods.lures}`);
  }
  for (const [materialId, count] of Object.entries(goods.materials ?? {})) {
    if (!count) continue;
    const material = content.materials.get(materialId);
    if (!material) continue; // 콘텐츠에 없는 재료 id는 조용히 건너뛴다 — 운영 오타 방어
    next.wallet.materials[materialId] = (next.wallet.materials[materialId] ?? 0) + count;
    parts.push(`${material.name} ${count}`);
  }
  return { next, summary: parts.join(' · ') || '지급 품목 없음' };
}

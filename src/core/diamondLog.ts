/**
 * 다이아 원장 (검토 ⑤ 2층, 2026-08-30) — 모든 다이아 증감을 출처와 함께 건별 기록한다.
 * 목적은 방지가 아니라 **사후 탐지**: 원장도 세이브 안에 있어 조작 가능하지만,
 * 서버 감사(0011 diamond_audit)가 "합계 ≠ 잔액", "서버 기록 없는 iap/coupon 항목",
 * "출석 상한 초과", "상점 가격 불일치"를 걸러 블랙 처리(⑥)의 근거를 만든다.
 *
 * source 규약 (서버 감사가 접두사로 분류한다):
 *   iap:<transactionId>   실결제 충전 — 1층(영수증 서버 검증) 도입 시 영수증 대조 키
 *   attendance:<YYYY-M-D> 출석 보상
 *   coupon:<CODE>         쿠폰 지급 — coupon_redemptions와 대조
 *   shop:<productId>      다이아 상점 소비 (음수)
 *   dev-sim:<id>          웹 DEV 충전 시뮬 (프로드 세이브에 있으면 그 자체가 이상 신호)
 *   legacy                v14 마이그레이션 시점의 기존 잔액 (출처 미상 — 도입 이전분)
 */
import type { DiamondLogEntry, SaveState } from './types';

/** 원장 상한 — 넘치면 오래된 항목을 base로 접는다 (세이브 비대 방지, 합계 불변식 유지) */
export const DIAMOND_LOG_CAP = 500;

/** 다이아 증감 기록 — wallet.diamonds를 바꾼 바로 그 자리에서 함께 부른다 (next는 클론) */
export function logDiamonds(next: SaveState, delta: number, source: string, at: number): void {
  if (delta === 0) return;
  next.diamondLog.push({ at, delta, source });
  while (next.diamondLog.length > DIAMOND_LOG_CAP) {
    const trimmed = next.diamondLog.shift()!;
    next.diamondLogBase += trimmed.delta;
  }
}

/** 원장 합계 — 항상 wallet.diamonds와 같아야 한다 (서버 감사·테스트 공용 불변식) */
export function diamondLedgerSum(save: SaveState): number {
  return save.diamondLog.reduce((sum, entry) => sum + entry.delta, save.diamondLogBase);
}

export type { DiamondLogEntry };

/**
 * 포획 판정 (GDD §7.1) — 확률 = (기본률 + 가산) × 배수(미끼·버프, 상한), 최종 상한 clamp.
 */
import type { Content } from '../content';
import type { Monster } from '../content/schema';
import { RARITY_ORDER } from './effects';
import { clamp } from './formulas';

export interface CaptureInput {
  monster: Monster;
  captureAddSum: number; // captureRoll 훅의 captureAdd 합
  useLure: boolean;
  buffMult: number; // 광고 버프 등 (없으면 1)
}

export function captureChance(content: Content, input: CaptureInput): number {
  const { capture } = content.balance;
  const base = capture.base[input.monster.rarity] ?? 0;
  const mult = Math.min((input.useLure ? capture.lureMult : 1) * input.buffMult, capture.multCap);
  return clamp((base + input.captureAddSum) * mult, 0, capture.chanceCap);
}

/**
 * 미끼 자동 사용 정책: **아직 도감에 없는** 희귀 이상 조우에만 (GDD §7.1 — 콘텐츠 값으로 승격 여지)
 *
 * 이미 포획한 종에 쓰면 얻는 건 카드 1장뿐인데, 미끼의 값어치는 도감을 늘리는 데 있다.
 * 2026-08-25 이전에는 보유 여부를 보지 않아 늪 도감 39~41종 구간(= 화산 해금 게이트가 걸리는
 * 바로 그 구간)에서 소모 미끼의 약 78%가 이미 잡은 종에 버려졌다.
 * 안 쓴 미끼는 귀환 시 반환되므로(expedition.ts) 아껴서 손해 볼 일이 없다.
 */
export function shouldUseLure(monster: Monster, luresLeft: number, alreadyCaptured: boolean): boolean {
  if (alreadyCaptured) return false;
  return luresLeft > 0 && RARITY_ORDER[monster.rarity] >= RARITY_ORDER['rare'];
}

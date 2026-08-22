/**
 * 포획 판정 (GDD §7.1) — 확률 = (기본률 + 가산) × 배수(미끼·버프, 상한), 최종 상한 clamp.
 */
import type { Content } from '../content';
import type { Monster } from '../content/schema';
import { clamp } from './formulas';

export interface CaptureInput {
  monster: Monster;
  captureAddSum: number; // captureRoll 훅의 captureAdd 합
  useLure: boolean;
  buffMult: number; // 광고 버프 등 (없으면 1)
}

export function captureChance(content: Content, input: CaptureInput): number {
  const { capture } = content.balance;
  const base = capture.base[input.monster.rarity];
  const mult = Math.min((input.useLure ? capture.lureMult : 1) * input.buffMult, capture.multCap);
  return clamp((base + input.captureAddSum) * mult, 0, capture.chanceCap);
}

/** 미끼 자동 사용 정책: 레어 이상 조우에 우선 사용 (GDD §7.1 — 콘텐츠 값으로 승격 여지) */
export function shouldUseLure(monster: Monster, luresLeft: number): boolean {
  return luresLeft > 0 && monster.rarity !== 'common';
}

/** 중복 포획 정수 전환량 */
export function essenceForDupe(content: Content, monster: Monster): number {
  return content.balance.essencePerDupe[monster.rarity];
}

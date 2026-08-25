/**
 * 계정 영구 보너스 — 조련(몬스터 레벨·각성 총합)·공명(유물 강화 총합) 계단 (GDD §4.6, 2026-08-25).
 * 마일스톤 버프처럼 저장하지 않고 세이브에서 재계산한다 — 발동 효과는 collectTeamEffects가
 * `account:` 출처로 주입하고, 이 모듈은 점수·계단 상태만 계산한다. 계단·수치는 balance.json accountBonus.
 */
import type { Content } from '../content';
import type { AccountBonusTier } from '../content/schema';
import type { SaveState } from './types';

export interface AxisState {
  score: number;
  tiers: readonly AccountBonusTier[];
  active: number; // 달성한 계단 수 — tiers[0..active-1]이 발동 중
  next: AccountBonusTier | null;
}

/** 조련 점수 — 전 종 Σ(레벨−1) + starWeight×Σ(성급−1). 레벨 1·성급 1은 기본값이라 0 기여 */
export function trainingScore(content: Content, save: SaveState): number {
  const weight = content.balance.accountBonus.starWeight;
  let score = 0;
  for (const owned of save.roster) score += (owned.level - 1) + weight * (owned.star - 1);
  return score;
}

/** 공명 점수 — 전 종 Σ강화 (강화는 종 공통 0~5) */
export function resonanceScore(save: SaveState): number {
  let score = 0;
  for (const owned of save.artifacts) score += owned.enhance;
  return score;
}

function axisState(score: number, tiers: readonly AccountBonusTier[]): AxisState {
  let active = 0;
  while (active < tiers.length && score >= tiers[active]!.score) active++;
  return { score, tiers, active, next: tiers[active] ?? null };
}

export function accountBonusState(content: Content, save: SaveState): { training: AxisState; resonance: AxisState } {
  const { training, resonance } = content.balance.accountBonus;
  return {
    training: axisState(trainingScore(content, save), training),
    resonance: axisState(resonanceScore(save), resonance),
  };
}

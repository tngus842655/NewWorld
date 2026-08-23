/**
 * 순수 계산식 — 모든 계수는 balance.json에서 온다 (코드에 매직넘버 금지).
 */
import type { Balance, Element, Monster } from '../content/schema';

/** 레벨·성급 반영 스탯 */
export function statAt(base: number, level: number, star: number, balance: Balance): number {
  const levelMult = 1 + balance.level.statGrowth * (level - 1);
  const starMult = Math.pow(balance.star.mult, star - 1);
  return base * levelMult * starMult;
}

export function cpOf(atk: number, hp: number, balance: Balance): number {
  return atk * balance.cp.atkWeight + hp * balance.cp.hpWeight;
}

export function monsterBaseCp(monster: Monster, balance: Balance): number {
  return cpOf(monster.baseAtk, monster.baseHp, balance);
}

/** 속성 상성 삼각: 화염→자연→냉기→화염, 빛↔어둠 상호 유리 */
const BEATS: Record<Element, Element | null> = {
  fire: 'nature',
  nature: 'frost',
  frost: 'fire',
  light: 'dark',
  dark: 'light',
};

/** 유닛 속성 vs 지역 우세 속성 배수 (GDD §4.2, §6) */
export function elementMult(unit: Element, regionElement: Element, balance: Balance): number {
  if (unit === regionElement) return balance.element.same;
  if (BEATS[unit] === regionElement) return balance.element.advantage;
  if (BEATS[regionElement] === unit) return balance.element.disadvantage;
  return 1;
}

/** 레벨업 골드 비용: goldBase × level^goldExp (현재 레벨 → +1) */
export function levelUpCost(level: number, balance: Balance): number {
  return Math.round(balance.level.goldBase * Math.pow(level, balance.level.goldExp));
}

/** 성급 각성 골드 비용 (★star → ★star+1) — 정수 폐기(2026-08-23), 성장 재화는 골드로 일원화 */
export function starUpCost(star: number, balance: Balance): number {
  const cost = balance.star.goldCost[star - 1];
  if (cost === undefined) throw new Error(`starUpCost: 잘못된 성급 ${star}`);
  return cost;
}

/** 유물 강화 가루 비용 (+enhance → +enhance+1) */
export function enhanceCost(enhance: number, balance: Balance): number {
  const cost = balance.artifacts.enhance.dustCost[enhance];
  if (cost === undefined) throw new Error(`enhanceCost: 잘못된 강화 단계 ${enhance}`);
  return cost;
}

/**
 * 현재 강화 단계까지 투자된 가루 총액 — 합성·분해 시 전액 환급.
 * 재화 보존 원칙 (2026-08-23): 한번 수집한 골드·가루는 시스템이 소멸시키지 않는다.
 */
export function investedEnhanceDust(enhance: number, balance: Balance): number {
  let total = 0;
  for (let level = 0; level < enhance; level++) total += enhanceCost(level, balance);
  return total;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

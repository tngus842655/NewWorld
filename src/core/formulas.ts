/**
 * 순수 계산식 — 모든 계수는 balance.json에서 온다 (코드에 매직넘버 금지).
 */
import type { Content } from '../content';
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

// ── 지역·등급 차등 비용 (2026-08-23) — 원정 단계가 깊을수록 성장도 비싸진다 ──

/** 몬스터 성장 비용 배수 = 출신 지역 growthCostMult × 등급 배수 (레벨·성급 공용) */
export function monsterCostMult(content: Content, monsterId: string): number {
  const monster = content.monsters.get(monsterId);
  if (!monster) return 1;
  const regionMult = content.regions.get(monster.habitat)?.growthCostMult ?? 1;
  const rarityMult = content.balance.level.rarityCostMult[monster.rarity] ?? 1;
  return regionMult * rarityMult;
}

export function monsterLevelUpCost(content: Content, monsterId: string, level: number): number {
  return Math.round(levelUpCost(level, content.balance) * monsterCostMult(content, monsterId));
}

export function monsterStarUpCost(content: Content, monsterId: string, star: number): number {
  return Math.round(starUpCost(star, content.balance) * monsterCostMult(content, monsterId));
}

/** 유물 강화 비용 = 단계 기본 가루 × 등급 배수 */
export function artifactEnhanceCost(content: Content, itemId: string, enhance: number): number {
  const rarity = content.artifacts.get(itemId)?.rarity;
  const mult = rarity ? (content.balance.artifacts.enhance.rarityCostMult[rarity] ?? 1) : 1;
  return Math.round(enhanceCost(enhance, content.balance) * mult);
}

// (v6) investedEnhanceDust 폐지 — 유물이 종 단위가 되며 강화는 종에 영구히 남는 소모로 재분류
// (여분만 합성 재료 + 분해 기능 제거(2026-08-25)로 강화 종이 사라지는 시스템 경로가 없다)

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

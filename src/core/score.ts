/**
 * 랭킹 점수 (GDD §9.3) — 전부 세이브에서 파생한다 (bestPower만 저장값).
 * 카테고리: 원정 / 몬스터 / 유물 / 과업 / 전투력 → 종합.
 */
import type { Content } from '../content';
import type { MonsterRarity, Tier } from '../content/schema';
import type { OwnedArtifact, OwnedMonster, SaveState } from './types';

export const RARITY_SCORE: Record<MonsterRarity, number> = {
  common: 10, uncommon: 20, rare: 40, heroic: 80, legendary: 200, transcendent: 500,
};

/** 파견 길이별 점수 — 시간 비례 + 위험 가중 (전멸 귀환은 절반) */
export const TIER_SCORE: Record<Tier, number> = { scout: 1, standard: 6, deep: 30 };

/** 종 기본점 = 등급점 × 지역 배수(order) — 도감·상세에 그대로 노출 */
export function monsterBaseScore(content: Content, monsterId: string): number {
  const monster = content.monsters.get(monsterId);
  if (!monster) return 0;
  return RARITY_SCORE[monster.rarity] * (content.regions.get(monster.habitat)?.order ?? 1);
}

/** 보유 종 점수 = 기본점 + 육성 가산 (레벨당 5%, 성급당 50%) */
export function monsterScore(content: Content, owned: OwnedMonster): number {
  const base = monsterBaseScore(content, owned.monsterId);
  return Math.round(base * (1 + 0.05 * (owned.level - 1) + 0.5 * (owned.star - 1)));
}

/** 유물 점수 = 등급점 + 강화 단계당 20% */
export function artifactScore(content: Content, owned: OwnedArtifact): number {
  const def = content.artifacts.get(owned.itemId);
  if (!def) return 0;
  const base = RARITY_SCORE[def.rarity];
  return Math.round(base * (1 + 0.2 * owned.enhance));
}

export function expeditionScore(save: SaveState): number {
  let total = 0;
  for (const tier of ['scout', 'standard', 'deep'] as const) {
    const done = save.stats.expeditions[tier];
    const wiped = Math.min(save.stats.wipes[tier], done);
    total += TIER_SCORE[tier] * (done - wiped) + Math.ceil(TIER_SCORE[tier] / 2) * wiped;
  }
  return total;
}

export function taskScore(content: Content, save: SaveState): number {
  return content.tasks.reduce((sum, task) => sum + (save.tasks[task.id] ?? 0) * task.score, 0);
}

export interface ScoreBreakdown {
  expedition: number;
  monster: number;
  artifact: number;
  task: number;
  power: number; // 최고 유효 전투력 기록 그대로
  total: number;
}

export function scoreBreakdown(content: Content, save: SaveState): ScoreBreakdown {
  const expedition = expeditionScore(save);
  const monster = save.roster.reduce((sum, owned) => sum + monsterScore(content, owned), 0);
  const artifact = save.artifacts.reduce((sum, owned) => sum + artifactScore(content, owned), 0);
  const task = taskScore(content, save);
  const power = save.stats.bestPower;
  // 종합: 과업은 반복 노력 가중 ×2, 전투력은 1/10 반영 (절대값 크기 보정)
  const total = expedition + monster + artifact + task * 2 + Math.round(power / 10);
  return { expedition, monster, artifact, task, power, total };
}

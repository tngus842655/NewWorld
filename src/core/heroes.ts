import formulas from '../../data/heroes/formulas.json';
import namePool from '../../data/heroes/names.json';
import type { GameState, Hero, HeroCandidate, HeroStats } from './types';

export const TAVERN_ID = 'tavern';

const STAT_KEYS: (keyof HeroStats)[] = [
  'endurance',
  'strength',
  'agility',
  'intellect',
  'spirit',
  'charisma',
];

export function statTotal(stats: HeroStats): number {
  return STAT_KEYS.reduce((sum, k) => sum + stats[k], 0);
}

/** 고용가 = 속성 합 × 5골드 (17173 실측: 속성 1점당 5골드) */
export function hirePrice(stats: HeroStats): number {
  return statTotal(stats) * formulas.hirePricePerStatPoint.value;
}

/** 지휘 가능 병력 수 (공식 미확보 — estimate) */
export function commandLimit(hero: Hero): number {
  const { base, perLevel } = formulas.commandLimit;
  return base + perLevel * (hero.level - 1);
}

/** 치명타 확률 (민첩 기준 0.2%/pt — baike) */
export function critChance(hero: Hero): number {
  return hero.stats.agility * formulas.critChancePerPoint.value;
}

/** 영웅 스탯이 지휘 병종에 주는 보정 배율 (계수는 estimate) */
export function troopBonuses(hero: Hero): {
  hp: number;
  patk: number;
  pdef: number;
  matk: number;
  mdef: number;
  speed: number;
} {
  const b = formulas.bonusPerPoint;
  const s = hero.stats;
  return {
    hp: 1 + s.endurance * b.hpPerEndurance,
    patk: 1 + s.strength * b.patkPerStrength,
    pdef: 1 + s.agility * b.pdefPerAgility,
    matk: 1 + s.intellect * b.matkPerIntellect,
    mdef: 1 + s.spirit * b.mdefPerSpirit,
    speed: 1 + s.agility * b.speedPerAgility,
  };
}

function randomCandidate(): HeroCandidate {
  const { min, max } = formulas.candidateStatTotalRange;
  const total = min + Math.floor(Math.random() * (max - min + 1));
  const stats: HeroStats = {
    endurance: 0,
    strength: 0,
    agility: 0,
    intellect: 0,
    spirit: 0,
    charisma: 0,
  };
  for (let i = 0; i < total; i++) {
    stats[STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)]]++;
  }
  const name = namePool.names[Math.floor(Math.random() * namePool.names.length)];
  return { name, stats, price: hirePrice(stats) };
}

/**
 * 주점 후보를 채운다. 주점이 지어져 있고 (후보가 없거나 자동 갱신 주기가 지났으면)
 * 새 후보 3명을 뽑는다. 갱신됐으면 true.
 */
export function maybeRestockTavern(state: GameState, tavernLevel: number, now: number): boolean {
  if (tavernLevel < 1) return false;
  const { candidateCount, freeRestockSeconds } = formulas.tavern;
  const stale = now - state.tavern.refreshedAt >= freeRestockSeconds * 1000;
  if (state.tavern.candidates.length > 0 && !stale) return false;
  state.tavern.candidates = Array.from({ length: candidateCount }, randomCandidate);
  state.tavern.refreshedAt = now;
  return true;
}

export const MANUAL_REFRESH_GOLD: number = formulas.tavern.manualRefreshGold;
export const FREE_RESTOCK_SECONDS: number = formulas.tavern.freeRestockSeconds;

export function restockNow(state: GameState, now: number): void {
  state.tavern.candidates = Array.from(
    { length: formulas.tavern.candidateCount },
    randomCandidate,
  );
  state.tavern.refreshedAt = now;
}

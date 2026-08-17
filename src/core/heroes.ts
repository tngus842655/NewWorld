import formulas from '../../data/heroes/formulas.json';
import namePool from '../../data/heroes/names.json';
import type { GameState, Hero, HeroCandidate, HeroStats } from './types';
import { equipMultipliers, equipTotals } from './equipment';

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

/**
 * 지휘 가능 병력 수 (기본 공식은 estimate).
 * 통솔 목걸이(统驭项链)의 "지휘 병력 상한 +3/6/9%"는 4399 실측 효과.
 */
export function commandLimit(hero: Hero): number {
  const { base, perLevel } = formulas.commandLimit;
  const raw = base + perLevel * (hero.level - 1);
  const bonus = equipTotals(hero).effects.commandLimit ?? 0;
  return Math.floor(raw * (1 + bonus / 100));
}

/**
 * 치명타 확률. 민첩 0.2%/pt는 바이두백과 실측이고,
 * 힘 반지·마법 반지의 치명타율 +3/6/9%는 4399 실측 효과.
 */
export function critChance(hero: Hero): number {
  const base = hero.stats.agility * formulas.critChancePerPoint.value;
  const eff = equipTotals(hero).effects;
  const fromGear = ((eff.physCrit ?? 0) + (eff.magicCrit ?? 0)) / 100;
  return base + fromGear;
}

/** 영웅 스탯 + 착용 장비가 지휘 병종에 주는 보정 배율 (계수는 estimate) */
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
  const eq = equipMultipliers(hero);
  return {
    hp: 1 + s.endurance * b.hpPerEndurance,
    patk: (1 + s.strength * b.patkPerStrength) * eq.patk,
    pdef: (1 + s.agility * b.pdefPerAgility) * eq.pdef,
    matk: (1 + s.intellect * b.matkPerIntellect) * eq.matk,
    mdef: (1 + s.spirit * b.mdefPerSpirit) * eq.mdef,
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

/** 다음 레벨까지 필요한 경험치 (공식 미확보 — estimate) */
export function xpToNext(level: number): number {
  return 100 * level;
}

/**
 * 경험치를 주고 필요하면 레벨업시킨다.
 * 레벨업 시 속성 2점이 무작위로 붙는다(원작 사양 미확인 — 추후 수동 분배로 교체 예정).
 * 오른 레벨 수를 돌려준다.
 */
export function grantXp(hero: Hero, xp: number): number {
  hero.xp += xp;
  let gained = 0;
  while (hero.xp >= xpToNext(hero.level)) {
    hero.xp -= xpToNext(hero.level);
    hero.level++;
    gained++;
    for (let i = 0; i < 2; i++) {
      hero.stats[STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)]]++;
    }
  }
  return gained;
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

/**
 * 조우 판정 (GDD §5.3) — P vs E 결정론 모델. 전투 연출 없음, 숫자만 낸다.
 */
import type { Content } from '../content';
import type { Monster, Region } from '../content/schema';
import { type ActiveEffect, type EffectCtx, query, sumDamageReduce, sumStatMult } from './effects';
import { clamp, cpOf, elementMult, monsterBaseCp, statAt } from './formulas';
import type { OwnedMonster } from './types';
import { GameError } from './types';

export interface PartyUnitPower {
  uid: string;
  monsterId: string;
  cp: number;
}

export interface PartyPower {
  total: number;
  units: PartyUnitPower[];
}

/**
 * 파티 유효 전투력.
 * 유닛별로 (레벨·성급 스탯) × (해당 유닛에 걸리는 statMult) × (지역 속성 배수)를 계산해 합산.
 * 조건에 element/tribe가 있는 computeParty 효과는 해당 유닛에게만 적용된다.
 */
export function computePartyPower(
  content: Content,
  effects: readonly ActiveEffect[],
  party: readonly OwnedMonster[],
  region: Region,
  tier: EffectCtx['tier'],
): PartyPower {
  const { balance } = content;
  const units: PartyUnitPower[] = [];
  let total = 0;
  for (const owned of party) {
    const monster = content.monsters.get(owned.monsterId);
    if (!monster) throw new GameError('monster-def-missing', `콘텐츠에 없는 몬스터: ${owned.monsterId}`);
    const ctx: EffectCtx = { regionId: region.id, tier, element: monster.element, tribe: monster.tribe };
    const actions = query(effects, 'computeParty', ctx);
    const atk = statAt(monster.baseAtk, owned.level, owned.star, balance) * (1 + sumStatMult(actions, 'atk'));
    const hp = statAt(monster.baseHp, owned.level, owned.star, balance) * (1 + sumStatMult(actions, 'hp'));
    const cp = cpOf(Math.max(0, atk), Math.max(0, hp), balance) * elementMult(monster.element, region.element, balance);
    units.push({ uid: owned.uid, monsterId: owned.monsterId, cp });
    total += cp;
  }
  return { total, units };
}

/** 파티 전역 피해 경감 (computeParty 훅, 유닛 조건 없는 것만 집계) */
export function partyDamageReduce(content: Content, effects: readonly ActiveEffect[], ctx: EffectCtx): number {
  const actions = query(effects, 'computeParty', ctx);
  return sumDamageReduce(actions, content.balance.artifacts.effectCaps.damageReduceMax);
}

export function enemyPower(content: Content, monster: Monster): number {
  return monsterBaseCp(monster, content.balance) * content.balance.combat.encounterPowerMult;
}

export interface EncounterOutcome {
  win: boolean;
  damage: number; // 파티 HP 비율 차감분
}

/** 승리/패주 판정과 피해량. damageReduce는 [0,1] 비율. */
export function resolveClash(content: Content, partyPower: number, enemy: number, damageReduce: number, defeatExtraReduce: number): EncounterOutcome {
  const { combat } = content.balance;
  if (partyPower <= 0) {
    return { win: false, damage: clamp(combat.defeatRatioCap * combat.defeatDamageK, 0, 1) };
  }
  const ratio = enemy / partyPower;
  if (partyPower >= enemy) {
    const damage = clamp(ratio * combat.victoryDamageK * (1 - damageReduce), 0, 1);
    return { win: true, damage };
  }
  const reduce = clamp(damageReduce + defeatExtraReduce, 0, 1);
  const damage = clamp(Math.min(ratio, combat.defeatRatioCap) * combat.defeatDamageK * (1 - reduce), 0, 1);
  return { win: false, damage };
}

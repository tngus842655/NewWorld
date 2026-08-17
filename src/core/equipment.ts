import equipData from '../../data/equipment/base.json';
import type { EquipItem, EquipSlot, Hero, Rarity, Resources } from './types';

/**
 * 장비 시스템. 아이템 수치·세트 구성·액세서리 효과는 4399 공식 가이드 실측이고,
 * 드롭 확률·희귀도 배율·전투 반영 계수는 원자료에 없어 추정(estimate)이다.
 */

export const RARITIES = equipData.rarities as { id: Rarity; ko: string; color: string }[];
export const SLOTS = equipData.slots as { id: EquipSlot; ko: string }[];
export const SLOT_LABELS: Record<string, string> = Object.fromEntries(
  SLOTS.map((s) => [s.id, s.ko]),
);

/** 희귀도별 능력치 배율 (estimate) */
const RARITY_MULT: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.15,
  rare: 1.35,
  epic: 1.6,
  legendary: 1.9,
  artifact: 2.3,
};

/** 희귀도 추첨 가중치 (estimate). 사냥터가 어려울수록 상위 등급이 잘 뜨게 보정 */
const RARITY_WEIGHT: [Rarity, number][] = [
  ['common', 44],
  ['uncommon', 27],
  ['rare', 16],
  ['epic', 8],
  ['legendary', 4],
  ['artifact', 1],
];

interface WeaponEntry {
  heroLevel: number;
  nameCn: string;
  nameKo: string;
  attack: number;
  patk: number;
  matk: number;
}
interface ShieldEntry {
  heroLevel: number;
  nameCn: string;
  nameKo: string;
  defense: number;
  pdef: number;
  mdef: number;
}
interface ArmorPiece {
  slot: EquipSlot;
  nameCn: string;
  nameKo: string;
  defense: number;
  pdef: number;
  mdef: number;
}
interface ArmorSet {
  id: string;
  type: string;
  nameCn: string;
  nameKo: string;
  heroLevel: number;
  pieces: ArmorPiece[];
  setBonus: { defense: number; pdef: number; mdef: number } | null;
}
interface AccessoryEntry {
  slot: EquipSlot;
  nameCn: string;
  nameKo: string;
  effect: string;
  effectKo: string;
  tiers: number[];
  unit: 'percent' | 'multiplier';
}

const weapons = equipData.weapons as { key: string; nameKo: string; items: WeaponEntry[] }[];
const shields = equipData.shields as ShieldEntry[];
const armorSets = equipData.armorSets as ArmorSet[];
const accessories = equipData.accessories as AccessoryEntry[];

export function setById(id: string): ArmorSet | undefined {
  return armorSets.find((s) => s.id === id);
}

function pickRarity(difficulty: number, rng: () => number): Rarity {
  // difficulty 0~1: 높을수록 상위 등급 가중치를 키운다
  const weighted = RARITY_WEIGHT.map(([r, w], i) => [r, w * Math.pow(1 + difficulty * 1.6, i)] as const);
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [r, w] of weighted) {
    roll -= w;
    if (roll <= 0) return r;
  }
  return 'common';
}

const scale = (v: number, mult: number) => Math.max(1, Math.round(v * mult));

/**
 * 사냥터 난이도(0~1)와 영웅 레벨에 맞는 장비 한 점을 만든다.
 * 요구 레벨이 영웅 레벨을 넘지 않는 것 중 가장 좋은 등급을 고른다.
 */
export function rollItem(heroLevel: number, difficulty: number, rng: () => number): EquipItem {
  const rarity = pickRarity(difficulty, rng);
  const mult = RARITY_MULT[rarity];
  const uid = `eq-${Math.floor(rng() * 1e9).toString(36)}-${Math.floor(rng() * 1e6).toString(36)}`;

  // 어떤 부위를 줄지: 무기 2 / 방패 1 / 방어구 5 / 액세서리 2 비중
  const kindRoll = rng();
  const usable = <T extends { heroLevel: number }>(list: T[]): T[] => {
    const ok = list.filter((x) => x.heroLevel <= heroLevel);
    return ok.length ? ok : [list[0]];
  };

  if (kindRoll < 0.2) {
    const type = weapons[Math.floor(rng() * weapons.length)];
    const pool = usable(type.items);
    const it = pool[pool.length - 1];
    return {
      id: uid,
      slot: 'weapon',
      nameKo: it.nameKo,
      nameCn: it.nameCn,
      rarity,
      heroLevel: it.heroLevel,
      patk: scale(it.patk, mult),
      matk: scale(it.matk, mult),
    };
  }

  if (kindRoll < 0.3) {
    const pool = usable(shields);
    const it = pool[pool.length - 1];
    return {
      id: uid,
      slot: 'shield',
      nameKo: it.nameKo,
      nameCn: it.nameCn,
      rarity,
      heroLevel: it.heroLevel,
      pdef: scale(it.pdef, mult),
      mdef: scale(it.mdef, mult),
    };
  }

  if (kindRoll < 0.8) {
    const pool = armorSets.filter((s) => s.heroLevel <= heroLevel);
    const set = (pool.length ? pool : [armorSets[0]])[
      Math.floor(rng() * (pool.length || 1))
    ] ?? armorSets[0];
    const piece = set.pieces[Math.floor(rng() * set.pieces.length)];
    return {
      id: uid,
      slot: piece.slot,
      nameKo: piece.nameKo,
      nameCn: piece.nameCn,
      rarity,
      heroLevel: set.heroLevel,
      pdef: scale(piece.pdef, mult),
      mdef: scale(piece.mdef, mult),
      setId: set.id,
      setNameKo: set.nameKo,
    };
  }

  const acc = accessories[Math.floor(rng() * accessories.length)];
  // 희귀도가 높을수록 상위 등급 수치
  const tierIdx = Math.min(
    acc.tiers.length - 1,
    Math.floor((RARITIES.findIndex((r) => r.id === rarity) / RARITIES.length) * acc.tiers.length),
  );
  return {
    id: uid,
    slot: acc.slot,
    nameKo: acc.nameKo,
    nameCn: acc.nameCn,
    rarity,
    heroLevel: 1,
    effect: acc.effect,
    effectKo: acc.effectKo,
    effectValue: acc.tiers[tierIdx],
    effectUnit: acc.unit,
  };
}

// ── 강화 ──────────────────────────────────────────────────────

/** 강화 한 단계당 능력치 증가율 (estimate) */
export const ENHANCE_STEP = 0.08;

/** 강화가 반영된 능력치 */
export function enhancedStat(base: number | undefined, plus: number | undefined): number {
  if (!base) return 0;
  return Math.round(base * (1 + (plus ?? 0) * ENHANCE_STEP));
}

/** 강화할 수치가 있는 장비인가 (액세서리는 특수효과뿐이라 강화 대상이 아니다) */
export function canEnhance(item: EquipItem): boolean {
  return Boolean(item.patk || item.matk || item.pdef || item.mdef);
}

/**
 * 다음 단계 강화 비용 (estimate).
 * 등급이 높고 이미 많이 강화했을수록 가파르게 오른다.
 */
export function enhanceCost(item: EquipItem): Partial<Resources> {
  const rarityIdx = Math.max(0, RARITIES.findIndex((r) => r.id === item.rarity));
  const k = Math.pow(1.6, item.plus ?? 0) * (1 + rarityIdx * 0.35);
  return {
    stone: Math.round(250 * k),
    gold: Math.round(400 * k),
    crystal: Math.round(60 * k),
  };
}

export interface EquipTotals {
  patk: number;
  matk: number;
  pdef: number;
  mdef: number;
  /** 완성된 세트 이름들 */
  completedSets: string[];
  /** 액세서리 효과 합계 (effect → 값) */
  effects: Record<string, number>;
}

/** 영웅이 착용한 장비의 합계. 전 부위 세트를 갖추면 세트 보너스가 더해진다 */
export function equipTotals(hero: Hero): EquipTotals {
  const totals: EquipTotals = {
    patk: 0,
    matk: 0,
    pdef: 0,
    mdef: 0,
    completedSets: [],
    effects: {},
  };
  const worn = Object.values(hero.equipment ?? {}).filter(Boolean) as EquipItem[];

  for (const it of worn) {
    // 강화 수치는 기본 능력치에만 곱한다 (액세서리 특수효과는 그대로)
    totals.patk += enhancedStat(it.patk, it.plus);
    totals.matk += enhancedStat(it.matk, it.plus);
    totals.pdef += enhancedStat(it.pdef, it.plus);
    totals.mdef += enhancedStat(it.mdef, it.plus);
    if (it.effect && it.effectValue) {
      totals.effects[it.effect] = (totals.effects[it.effect] ?? 0) + it.effectValue;
    }
  }

  // 세트 완성 판정: 같은 세트의 5부위를 모두 착용
  const bySet = new Map<string, number>();
  for (const it of worn) {
    if (it.setId) bySet.set(it.setId, (bySet.get(it.setId) ?? 0) + 1);
  }
  for (const [setId, count] of bySet) {
    const set = setById(setId);
    if (!set || count < set.pieces.length) continue;
    totals.completedSets.push(set.nameKo);
    if (set.setBonus) {
      totals.pdef += set.setBonus.pdef;
      totals.mdef += set.setBonus.mdef;
    }
  }
  return totals;
}

/**
 * 장비 합계를 병종 배율로 환산 (계수는 estimate).
 * 최고급 무기(공격 150)를 들면 약 +30%가 되도록 잡았다.
 */
export const EQUIP_DIVISOR = 500;

export function equipMultipliers(hero: Hero): {
  patk: number;
  matk: number;
  pdef: number;
  mdef: number;
} {
  const t = equipTotals(hero);
  return {
    patk: 1 + t.patk / EQUIP_DIVISOR,
    matk: 1 + t.matk / EQUIP_DIVISOR,
    pdef: 1 + t.pdef / EQUIP_DIVISOR,
    mdef: 1 + t.mdef / EQUIP_DIVISOR,
  };
}

import type {
  BuildingDef,
  CampDef,
  EquipSlot,
  GameState,
  NodeDef,
  Resources,
  UnitDef,
} from './types';
import { MANUAL_REFRESH_GOLD, restockNow, TAVERN_ID } from './heroes';
import { selectArmyForMarch, simulateBattle, type CityBonus } from './combat';
import { equipTotals } from './equipment';
import {
  buildingAtCell,
  buildingEffect,
  buildSlots,
  hasFreeBuildSlot,
  isBuilding,
  isFreeCell,
  isGridBuilding,
  isHeroMarching,
  isPlaced,
  inGrid,
  marchSlots,
  requirementText,
  unmetRequirements,
} from './city';

/** 유닛 훈련을 담당하는 건물 id */
export const BARRACKS_ID = 'barracks';
/** 병종 연구를 담당하는 건물 id */
export const ACADEMY_ID = 'academy';
/** 유닛 연구 최대 레벨 — 4399 스탯표가 20레벨까지 있다 */
export const MAX_UNIT_LEVEL = 20;

/** 연구소 1레벨당 유닛 2레벨까지 허용 (추정 규칙) */
export function maxResearchableLevel(academyLevel: number): number {
  return Math.min(MAX_UNIT_LEVEL, academyLevel * 2);
}

/** 목표 레벨로 올리는 데 드는 연구 비용 — 훈련 비용을 기준으로 체증 (추정) */
export function researchCost(def: UnitDef, targetLevel: number): Partial<Resources> {
  const scale = Math.pow(1.55, targetLevel - 1) * 12 * def.tier;
  const cost: Partial<Resources> = {};
  for (const [k, v] of Object.entries(def.cost) as [keyof Resources, number][]) {
    if (v > 0) cost[k] = Math.round(v * scale);
  }
  // 훈련에 자원이 거의 안 드는 유닛도 연구에는 목재·석재가 든다
  cost.wood = Math.round((cost.wood ?? 0) + 60 * scale);
  cost.stone = Math.round((cost.stone ?? 0) + 40 * scale);
  return cost;
}

export function researchSeconds(def: UnitDef, targetLevel: number): number {
  return Math.round(90 * def.tier * Math.pow(1.4, targetLevel - 1));
}

/** 병종 연구를 큐에 넣는다. 상태를 직접 변경한다(호출 전 advance 필수). */
export function startResearch(
  state: GameState,
  def: UnitDef,
  now: number,
): ActionResult {
  if (state.researchQueue) return { ok: false, reason: '연구 큐가 이미 사용 중입니다.' };

  const academyLevel = state.buildings.find((b) => b.defId === ACADEMY_ID)?.level ?? 0;
  if (academyLevel < 1) return { ok: false, reason: '연구소를 먼저 지어야 합니다.' };

  const current = state.unitLevels[def.id] ?? 1;
  const targetLevel = current + 1;
  if (targetLevel > MAX_UNIT_LEVEL) return { ok: false, reason: '이미 최대 연구 레벨입니다.' };
  if (targetLevel > maxResearchableLevel(academyLevel)) {
    return {
      ok: false,
      reason: `연구소 Lv.${Math.ceil(targetLevel / 2)} 필요 (현재 Lv.${academyLevel})`,
    };
  }

  const cost = researchCost(def, targetLevel);
  if (!canAfford(state.resources, cost)) return { ok: false, reason: '자원이 부족합니다.' };

  pay(state.resources, cost);
  state.researchQueue = {
    unitId: def.id,
    targetLevel,
    finishesAt: now + researchSeconds(def, targetLevel) * 1000,
  };
  return { ok: true };
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

export function canAfford(have: Resources, cost: Partial<Resources>): boolean {
  return (Object.entries(cost) as [keyof Resources, number][]).every(
    ([k, v]) => have[k] >= v,
  );
}

function pay(have: Resources, cost: Partial<Resources>): void {
  for (const [k, v] of Object.entries(cost) as [keyof Resources, number][]) {
    have[k] -= v;
  }
}

/** 건물 업그레이드를 큐에 넣는다. 상태를 직접 변경한다(호출 전 advance 필수). */
export function startUpgrade(
  state: GameState,
  def: BuildingDef,
  buildingDefs: Map<string, BuildingDef>,
  now: number,
): ActionResult {
  const slots = buildSlots(state);
  if (!hasFreeBuildSlot(state)) {
    return { ok: false, reason: `건설 슬롯이 모두 사용 중입니다 (${slots}/${slots}).` };
  }
  // 같은 건물을 두 슬롯에서 동시에 올릴 수는 없다
  if (isBuilding(state, def.id)) return { ok: false, reason: '이미 짓고 있는 건물입니다.' };

  const building = state.buildings.find((b) => b.defId === def.id);
  if (!building) return { ok: false, reason: '도시에 없는 건물입니다.' };

  const targetLevel = building.level + 1;
  const levelDef = def.levels[targetLevel - 1];
  if (!levelDef) return { ok: false, reason: '이미 최대 레벨입니다.' };

  // 0→1레벨은 '건설'이라 부지와 선행 조건이 필요하다.
  // 성벽·성문은 자리가 정해져 있어 부지를 고르지 않는다.
  if (building.level === 0) {
    if (isGridBuilding(def) && !isPlaced(building)) {
      return { ok: false, reason: '먼저 빈 부지를 골라야 합니다.' };
    }
    const unmet = unmetRequirements(state, def);
    if (unmet.length) return { ok: false, reason: requirementText(unmet, buildingDefs) };
  }

  if (!canAfford(state.resources, levelDef.upgradeCost)) {
    return { ok: false, reason: '자원이 부족합니다.' };
  }

  pay(state.resources, levelDef.upgradeCost);
  state.upgradeQueue.push({
    defId: def.id,
    targetLevel,
    finishesAt: now + levelDef.upgradeSeconds * 1000,
  });
  return { ok: true };
}

/**
 * 빈 부지에 새 건물을 앉히고 곧바로 1레벨 건설을 시작한다.
 * 부지 선택과 건설이 한 동작이라, 건설이 실패하면 부지도 되돌린다.
 */
export function constructBuilding(
  state: GameState,
  def: BuildingDef,
  buildingDefs: Map<string, BuildingDef>,
  c: number,
  r: number,
  now: number,
): ActionResult {
  const building = state.buildings.find((b) => b.defId === def.id);
  if (!building) return { ok: false, reason: '도시에 없는 건물입니다.' };
  if (isPlaced(building)) return { ok: false, reason: '이미 부지에 있는 건물입니다.' };
  if (!isFreeCell(state, c, r)) return { ok: false, reason: '건설할 수 없는 부지입니다.' };

  building.col = c;
  building.row = r;
  const result = startUpgrade(state, def, buildingDefs, now);
  if (!result.ok) {
    delete building.col;
    delete building.row;
  }
  return result;
}

/**
 * 건물을 다른 칸으로 옮긴다(드래그 앤 드롭).
 * 목적지에 다른 건물이 있으면 자리를 맞바꾼다 — 꽉 찬 부지에서도 정리가 되도록.
 */
export function moveBuilding(state: GameState, defId: string, c: number, r: number): ActionResult {
  const building = state.buildings.find((b) => b.defId === defId);
  // 성벽·성문은 애초에 좌표가 없어 여기서 걸러진다
  if (!building || !isPlaced(building)) return { ok: false, reason: '옮길 수 없는 건물입니다.' };
  if (!inGrid(c, r)) return { ok: false, reason: '부지 밖으로는 옮길 수 없습니다.' };
  if (building.col === c && building.row === r) return { ok: true };

  const occupant = buildingAtCell(state, c, r);
  const from = { col: building.col, row: building.row };
  building.col = c;
  building.row = r;
  if (occupant) {
    occupant.col = from.col;
    occupant.row = from.row;
  }
  return { ok: true };
}

/** 유닛 훈련을 큐에 넣는다. 상태를 직접 변경한다(호출 전 advance 필수). */
export function startTraining(
  state: GameState,
  def: UnitDef,
  count: number,
  now: number,
): ActionResult {
  if (count < 1) return { ok: false, reason: '수량이 잘못됐습니다.' };
  if (state.trainQueue) return { ok: false, reason: '훈련 큐가 이미 사용 중입니다.' };

  const barracks = state.buildings.find((b) => b.defId === BARRACKS_ID);
  const barracksLevel = barracks?.level ?? 0;
  if (barracksLevel < 1) return { ok: false, reason: '병영을 먼저 지어야 합니다.' };
  if (def.tier > barracksLevel) {
    return { ok: false, reason: `병영 Lv.${def.tier} 필요 (현재 Lv.${barracksLevel})` };
  }

  const totalCost: Partial<Resources> = {};
  for (const [k, v] of Object.entries(def.cost) as [keyof Resources, number][]) {
    if (v > 0) totalCost[k] = v * count;
  }
  if (!canAfford(state.resources, totalCost)) {
    return { ok: false, reason: '자원이 부족합니다.' };
  }

  pay(state.resources, totalCost);
  state.trainQueue = {
    unitId: def.id,
    count,
    finishesAt: now + (def.trainSeconds ?? 60) * count * 1000,
  };
  return { ok: true };
}

/** 주점 후보를 고용한다. 보유 한도는 주점 레벨(estimate). */
export function hireHero(state: GameState, candidateIndex: number): ActionResult {
  const tavern = state.buildings.find((b) => b.defId === TAVERN_ID);
  const tavernLevel = tavern?.level ?? 0;
  if (tavernLevel < 1) return { ok: false, reason: '주점을 먼저 지어야 합니다.' };

  const candidate = state.tavern.candidates[candidateIndex];
  if (!candidate) return { ok: false, reason: '이미 사라진 후보입니다.' };

  if (state.heroes.length >= tavernLevel) {
    return { ok: false, reason: `영웅 보유 한도 초과 (주점 Lv.${tavernLevel} = ${tavernLevel}명)` };
  }
  if (state.resources.gold < candidate.price) {
    return { ok: false, reason: '금화가 부족합니다.' };
  }

  state.resources.gold -= candidate.price;
  state.heroes.push({
    id: `hero-${Date.now()}-${candidateIndex}`,
    name: candidate.name,
    level: 1,
    xp: 0,
    stats: candidate.stats,
  });
  state.tavern.candidates.splice(candidateIndex, 1);
  return { ok: true };
}

/** 기지 건물이 출정 부대에 얹어 주는 보정을 모은다 */
export function cityBonus(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
): CityBonus {
  return {
    pdefPercent: buildingEffect(state, buildingDefs, 'armyPdefPercent'),
    mdefPercent: buildingEffect(state, buildingDefs, 'armyMdefPercent'),
    xpPercent: buildingEffect(state, buildingDefs, 'heroXpPercent'),
    woundedPercent: buildingEffect(state, buildingDefs, 'woundedRecoveryPercent'),
  };
}

/**
 * 사냥터/자원지로 부대를 출정시킨다.
 * 전투 결과는 출정 시점에 미리 계산해 두고(advance를 순수하게 유지),
 * 부대가 돌아오는 시각에 tick이 결과를 반영한다.
 */
export function dispatchMarch(
  state: GameState,
  target: CampDef | NodeDef,
  kind: 'hunt' | 'capture',
  heroId: string,
  unitDefs: Map<string, UnitDef>,
  buildingDefs: Map<string, BuildingDef>,
  maxHeld: number,
  now: number,
): ActionResult {
  const slots = marchSlots(state, buildingDefs);
  if (state.march.length >= slots) {
    return { ok: false, reason: `출정 부대가 모두 나가 있습니다 (${slots}/${slots}).` };
  }
  // 한 지휘관이 두 부대를 동시에 이끌 수는 없다
  if (isHeroMarching(state, heroId)) {
    return { ok: false, reason: '이 지휘관은 이미 출정 중입니다.' };
  }
  if (state.march.some((m) => m.campId === target.id)) {
    return { ok: false, reason: '이미 그곳으로 출정한 부대가 있습니다.' };
  }

  if (kind === 'capture') {
    if (state.heldNodes.some((h) => h.nodeId === target.id)) {
      return { ok: false, reason: '이미 점령한 자원지입니다.' };
    }
    if (state.heldNodes.length >= maxHeld) {
      return { ok: false, reason: `자원지 점령 한도(${maxHeld}곳)를 넘을 수 없습니다.` };
    }
  }

  const hero = state.heroes.find((h) => h.id === heroId);
  if (!hero) return { ok: false, reason: '영웅을 먼저 고용해야 합니다.' };

  const army = selectArmyForMarch(state.army, hero, unitDefs);
  if (!army.length) return { ok: false, reason: '출정할 병력이 없습니다.' };

  // 출정 병력은 도시에서 빠진다 (생존자는 귀환 시 복귀)
  for (const { unitId, count } of army) {
    state.army[unitId] -= count;
    if (state.army[unitId] <= 0) delete state.army[unitId];
  }

  // 난이도 0~1: 왕복 시간이 길수록 어려운 곳으로 본다 (드롭 등급 보정용)
  const dropDifficulty = Math.min(1, target.marchSeconds / 1500);

  const report = simulateBattle({
    hero,
    attackerArmy: army,
    defenderArmy: target.monsters,
    campId: target.id,
    campName: target.name,
    loot: kind === 'hunt' ? (target as CampDef).loot : {},
    unitDefs,
    unitLevels: state.unitLevels,
    cityBonus: cityBonus(state, buildingDefs),
    dropDifficulty,
    now,
  });

  // 신행 목걸이(神行项链)의 행군 속도 증가 — 4399 실측 효과
  const speedBonus = equipTotals(hero).effects.marchSpeed ?? 0;
  const seconds = target.marchSeconds / (1 + speedBonus / 100);

  state.march.push({
    kind,
    campId: target.id,
    campName: target.name,
    heroId,
    returnsAt: now + seconds * 1000,
    report,
  });
  return { ok: true };
}

/** 창고의 장비를 영웅에게 착용시킨다. 그 부위에 있던 장비는 창고로 돌아간다. */
export function equipItem(state: GameState, heroId: string, itemId: string): ActionResult {
  const hero = state.heroes.find((h) => h.id === heroId);
  if (!hero) return { ok: false, reason: '영웅을 찾을 수 없습니다.' };

  const idx = state.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return { ok: false, reason: '창고에 없는 장비입니다.' };

  const item = state.inventory[idx];
  if (item.heroLevel > hero.level) {
    return { ok: false, reason: `영웅 레벨 ${item.heroLevel} 이상이어야 착용할 수 있습니다.` };
  }

  hero.equipment ??= {};
  const previous = hero.equipment[item.slot];
  hero.equipment[item.slot] = item;
  state.inventory.splice(idx, 1);
  if (previous) state.inventory.push(previous);
  return { ok: true };
}

/** 착용 장비를 벗어 창고로 보낸다 */
export function unequipItem(state: GameState, heroId: string, slot: EquipSlot): ActionResult {
  const hero = state.heroes.find((h) => h.id === heroId);
  if (!hero?.equipment?.[slot]) return { ok: false, reason: '착용한 장비가 없습니다.' };
  state.inventory.push(hero.equipment[slot]!);
  delete hero.equipment[slot];
  return { ok: true };
}

/** 전투 기록 한 건 삭제 */
export function deleteReport(state: GameState, reportId: string): ActionResult {
  const idx = state.reports.findIndex((r) => r.id === reportId);
  if (idx < 0) return { ok: false, reason: '없는 기록입니다.' };
  state.reports.splice(idx, 1);
  return { ok: true };
}

/** 전투 기록 전체 삭제 */
export function clearReports(state: GameState): ActionResult {
  state.reports = [];
  return { ok: true };
}

/** 전투 기록을 읽음으로 표시 */
export function markReportRead(state: GameState, reportId: string): ActionResult {
  const report = state.reports.find((r) => r.id === reportId);
  if (!report) return { ok: false, reason: '없는 기록입니다.' };
  report.read = true;
  return { ok: true };
}

/** 창고 장비를 버린다 */
export function discardItem(state: GameState, itemId: string): ActionResult {
  const idx = state.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return { ok: false, reason: '창고에 없는 장비입니다.' };
  state.inventory.splice(idx, 1);
  return { ok: true };
}

/** 점령한 자원지를 포기한다 */
export function abandonNode(state: GameState, nodeId: string): ActionResult {
  const idx = state.heldNodes.findIndex((h) => h.nodeId === nodeId);
  if (idx < 0) return { ok: false, reason: '점령하지 않은 자원지입니다.' };
  state.heldNodes.splice(idx, 1);
  return { ok: true };
}

/** 주점 후보 수동 갱신 (골드 소모) */
export function refreshTavern(state: GameState, now: number): ActionResult {
  const tavern = state.buildings.find((b) => b.defId === TAVERN_ID);
  if ((tavern?.level ?? 0) < 1) return { ok: false, reason: '주점을 먼저 지어야 합니다.' };
  if (state.resources.gold < MANUAL_REFRESH_GOLD) {
    return { ok: false, reason: '금화가 부족합니다.' };
  }
  state.resources.gold -= MANUAL_REFRESH_GOLD;
  restockNow(state, now);
  return { ok: true };
}

import type { BuildingDef, CityBuilding, GameState, ResourceKind } from './types';
import { RESOURCE_LABELS } from './types';

/**
 * 기지 부지(6×6 격자)의 배치 규칙.
 *
 * 예전에는 건물마다 고정 칸이 코드에 박혀 있었다(ui/cityview.ts의 SLOTS).
 * 이제 배치는 저장 상태(CityBuilding.col/row)에 들어가고, 화면은 그걸 그리기만 한다.
 * 좌표가 없는 건물 = 아직 부지에 올리지 않은 건물 → 빈 칸을 눌렀을 때 나오는
 * 건설 목록에 뜬다.
 *
 * 성벽(placement:'wall')과 성문(placement:'gate')은 부지를 쓰지 않는다.
 * 자리가 정해져 있어 옮길 수도, 건설 목록에 뜰 수도 없다.
 */

export const GRID_COLS = 6;
export const GRID_ROWS = 6;
/** 성 내부 부지 칸 수 = 지을 수 있는 grid 건물 수 */
export const GRID_CELLS = GRID_COLS * GRID_ROWS;

/** 부지를 차지하는 건물인가 (성벽·성문은 아니다) */
export function isGridBuilding(def: BuildingDef | undefined): boolean {
  return (def?.placement ?? 'grid') === 'grid';
}

export interface Cell {
  c: number;
  r: number;
}

export function inGrid(c: number, r: number): boolean {
  return Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < GRID_COLS && r >= 0 && r < GRID_ROWS;
}

/** 부지에 올라와 있는 건물(건설 완료 또는 건설 중)인가 */
export function isPlaced(b: CityBuilding): b is CityBuilding & { col: number; row: number } {
  return typeof b.col === 'number' && typeof b.row === 'number';
}

export function placedBuildings(state: GameState): (CityBuilding & { col: number; row: number })[] {
  return state.buildings.filter(isPlaced);
}

/** 아직 부지에 올리지 않은 건물 = 건설 목록에 뜰 후보 (성벽·성문 제외) */
export function unplacedBuildings(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
): CityBuilding[] {
  return state.buildings.filter((b) => !isPlaced(b) && isGridBuilding(buildingDefs.get(b.defId)));
}

export function buildingAtCell(state: GameState, c: number, r: number): CityBuilding | null {
  return placedBuildings(state).find((b) => b.col === c && b.row === r) ?? null;
}

/** 건물을 놓을 수 있는 칸인가 (격자 안 · 비어 있음) */
export function isFreeCell(state: GameState, c: number, r: number): boolean {
  return inGrid(c, r) && !buildingAtCell(state, c, r);
}

/** 배치가 깨졌을 때 대피시킬 빈 칸 하나 */
export function firstFreeCell(state: GameState): Cell | null {
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (isFreeCell(state, c, r)) return { c, r };
    }
  }
  return null;
}

// ── 건설 선행 조건 ────────────────────────────────────────────

export interface UnmetRequirement {
  buildingId: string;
  /** 요구 레벨 */
  level: number;
  /** 현재 레벨 */
  current: number;
}

/**
 * 아직 만족하지 못한 선행 조건 목록. 비어 있으면 건설 가능.
 * (건물은 내려갈 수 없으므로 한 번 만족하면 계속 만족한다 → 건설 시점에만 본다)
 */
export function unmetRequirements(state: GameState, def: BuildingDef): UnmetRequirement[] {
  const out: UnmetRequirement[] = [];
  for (const req of def.requires ?? []) {
    const current = state.buildings.find((b) => b.defId === req.buildingId)?.level ?? 0;
    if (current < req.level) {
      out.push({ buildingId: req.buildingId, level: req.level, current });
    }
  }
  return out;
}

/** "병영 Lv.2 필요 (현재 Lv.0)" 같은 안내 문구 */
export function requirementText(
  unmet: UnmetRequirement[],
  buildingDefs: Map<string, BuildingDef>,
): string {
  return unmet
    .map((u) => {
      const name = buildingDefs.get(u.buildingId)?.name ?? u.buildingId;
      return `${name} Lv.${u.level} 필요 (현재 Lv.${u.current})`;
    })
    .join(' · ');
}

// ── 가공 건물 보정 ────────────────────────────────────────────

/**
 * 가공 건물이 올려 주는 자원별 산출 보정(%).
 * 원작의 木材加工厂(레벨당 목재 +5%) 구조를 그대로 옮긴 것으로, 자원 건물과
 * 점령 자원지 산출 모두에 곱해진다.
 */
export function productionBoosts(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
): Partial<Record<ResourceKind, number>> {
  const out: Partial<Record<ResourceKind, number>> = {};
  for (const b of state.buildings) {
    if (b.level <= 0) continue;
    const boost = buildingDefs.get(b.defId)?.boosts;
    if (!boost) continue;
    const pct = boost.percentPerLevel * b.level;
    if (boost.resource === 'all') {
      for (const k of Object.keys(RESOURCE_LABELS) as ResourceKind[]) {
        out[k] = (out[k] ?? 0) + pct;
      }
    } else {
      out[boost.resource] = (out[boost.resource] ?? 0) + pct;
    }
  }
  return out;
}

// ── 저장 데이터 보정 ──────────────────────────────────────────

/** 옛 저장 데이터(좌표 없음)를 옮길 때 쓰던 고정 배치 */
export const DEFAULT_SLOTS: Record<string, Cell> = {
  sawmill: { c: 0, r: 0 },
  quarry: { c: 2, r: 0 },
  'crystal-mine': { c: 4, r: 0 },
  radar: { c: 5, r: 1 },
  barracks: { c: 0, r: 2 },
  academy: { c: 4, r: 2 },
  farm: { c: 1, r: 3 },
  market: { c: 5, r: 3 },
  rampart: { c: 0, r: 4 },
  tavern: { c: 2, r: 4 },
  turret: { c: 5, r: 5 },
};

/**
 * 배치 불변식을 강제한다. 저장 데이터가 손상됐거나 격자 규격이 바뀌어도
 * 건물이 사라지거나 겹쳐 보이지 않게 한다.
 *
 * - 건설된(또는 건설 중인) grid 건물은 반드시 유효한 칸 하나를 차지한다
 * - 짓지 않은 건물은 좌표를 갖지 않는다 (→ 건설 목록으로 돌아간다)
 * - 성벽·성문은 부지를 쓰지 않으므로 좌표를 떼어 낸다
 *   (방벽이 성벽으로 승격되기 전 저장분이 여기 걸린다)
 */
export function repairLayout(state: GameState, buildingDefs: Map<string, BuildingDef>): void {
  const taken = new Set<string>();
  const homeless: CityBuilding[] = [];

  for (const b of state.buildings) {
    const onGrid = isGridBuilding(buildingDefs.get(b.defId));
    const building = onGrid && (state.upgradeQueue?.defId === b.defId || b.level >= 1);
    if (!building) {
      delete b.col;
      delete b.row;
      continue;
    }
    const key = `${b.col},${b.row}`;
    if (!isPlaced(b) || !inGrid(b.col!, b.row!) || taken.has(key)) {
      homeless.push(b);
      delete b.col;
      delete b.row;
      continue;
    }
    taken.add(key);
  }

  for (const b of homeless) {
    const cell = firstFreeCell(state);
    if (!cell) break; // 부지가 꽉 찼다 — 좌표 없이 두면 건설 목록에 남는다
    b.col = cell.c;
    b.row = cell.r;
  }
}

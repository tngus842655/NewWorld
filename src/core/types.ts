// 게임 데이터(JSON)와 코드 사이의 계약.
// 데이터 파일은 data/ 아래에 코드와 분리해서 두고, 출처(provenance)를 반드시 기록한다:
//   "4399"     — 원작 4399 가이드 사이트에서 추출한 실측값
//   "baike"    — 바이두백과 문서에서 추출한 값
//   "estimate" — 자료가 없어 임시로 넣은 추정값 (추후 교체 대상)

export type ResourceKind = 'wood' | 'stone' | 'food' | 'crystal' | 'gold';

export type Resources = Record<ResourceKind, number>;

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  wood: '목재',
  stone: '석재',
  food: '식량',
  crystal: '수정',
  gold: '금화',
};

export type Provenance = '4399' | 'baike' | 'estimate';

export interface BuildingLevel {
  /** 이 레벨의 시간당 생산량 (생산 건물만) */
  productionPerHour?: number;
  /** 이 레벨로 올리는 데 드는 비용 */
  upgradeCost: Partial<Resources>;
  /** 업그레이드 소요 시간(초) */
  upgradeSeconds: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  /** 생산 건물이면 어떤 자원을 만드는지 */
  produces?: ResourceKind;
  /** index 0 = 1레벨 */
  levels: BuildingLevel[];
  provenance: Provenance;
}

export interface UnitStatRow {
  level: number;
  [stat: string]: number;
}

export interface UnitDef {
  id: string;
  raceId: string;
  nameKo: string;
  nameCn?: string;
  tier: number;
  /** 스탯 컬럼명 (표시 순서) */
  statColumns: string[];
  stats: UnitStatRow[];
  notes?: string;
  provenance: Provenance;
}

// ── 런타임 상태 ──────────────────────────────────────────────

export interface CityBuilding {
  defId: string;
  level: number; // 0 = 미건설
}

export interface UpgradeJob {
  defId: string;
  targetLevel: number;
  finishesAt: number; // epoch ms
}

export interface GameState {
  /** 마지막으로 틱이 반영된 시각 (epoch ms) — 오프라인 진행 계산의 기준 */
  updatedAt: number;
  resources: Resources;
  buildings: CityBuilding[];
  /** 원작처럼 건설 큐는 한 번에 하나 */
  upgradeQueue: UpgradeJob | null;
}

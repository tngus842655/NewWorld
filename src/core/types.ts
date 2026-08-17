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

export type RaceId = 'human' | 'elf' | 'undead';

export const RACE_LABELS: Record<RaceId, string> = {
  human: '휴먼',
  elf: '엘프',
  undead: '언데드',
};

export interface UnitStatRow {
  level: number;
  [stat: string]: number;
}

export interface UnitDef {
  id: string;
  raceId: string;
  nameKo: string;
  nameCn?: string;
  /** 병계 (원작 兵阶, 1~8) */
  tier: number;
  /** 훈련 비용 */
  cost: Partial<Resources>;
  speed?: number;
  /** 시간당 식량 소모 (원작 每小时消耗粮食) */
  foodUpkeepPerHour?: number;
  /** 1기 훈련 시간(초) */
  trainSeconds?: number;
  /** 스탯 컬럼명 (표시 순서) */
  statColumns: string[];
  stats: UnitStatRow[];
  descriptionCn?: string;
  imageUrls?: string[];
  sourceUrl?: string;
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

export interface TrainJob {
  unitId: string;
  count: number;
  finishesAt: number; // epoch ms
}

// ── 영웅 ──────────────────────────────────────────────────────
// 6대 기초속성은 원작 실측(바이두백과): 내력=생명, 힘=물공, 민첩=물방·속도,
// 지력=마공, 정신=마방, 매력=정찰. 치명타 +0.2%/pt.

export interface HeroStats {
  endurance: number; // 내력
  strength: number; // 힘
  agility: number; // 민첩
  intellect: number; // 지력
  spirit: number; // 정신
  charisma: number; // 매력
}

export const HERO_STAT_LABELS: Record<keyof HeroStats, string> = {
  endurance: '내력',
  strength: '힘',
  agility: '민첩',
  intellect: '지력',
  spirit: '정신',
  charisma: '매력',
};

export interface Hero {
  id: string;
  name: string;
  level: number;
  xp: number;
  stats: HeroStats;
}

export interface HeroCandidate {
  name: string;
  stats: HeroStats;
  price: number; // 골드
}

export interface TavernState {
  candidates: HeroCandidate[];
  /** 마지막 후보 갱신 시각 (epoch ms) */
  refreshedAt: number;
}

export interface GameState {
  /** 저장 데이터 버전 — migrate()의 일회성 마이그레이션 기준 */
  stateVersion?: number;
  /** 마지막으로 틱이 반영된 시각 (epoch ms) — 오프라인 진행 계산의 기준 */
  updatedAt: number;
  /** 선택 종족 — null이면 종족 선택 화면 */
  raceId: RaceId | null;
  resources: Resources;
  buildings: CityBuilding[];
  /** 보유 병력: 유닛 id → 수량 */
  army: Record<string, number>;
  /** 고용한 영웅들 */
  heroes: Hero[];
  /** 주점 상태 */
  tavern: TavernState;
  /** 원작처럼 건설 큐는 한 번에 하나 */
  upgradeQueue: UpgradeJob | null;
  /** 훈련 큐도 한 번에 하나 */
  trainQueue: TrainJob | null;
}

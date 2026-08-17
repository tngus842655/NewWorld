// 게임 데이터(JSON)와 코드 사이의 계약.
// 데이터 파일은 data/ 아래에 코드와 분리해서 두고, 출처(provenance)를 반드시 기록한다:
//   "4399"     — 원작 4399 가이드 사이트에서 추출한 실측값
//   "baike"    — 바이두백과 문서에서 추출한 값
//   "estimate" — 자료가 없어 임시로 넣은 추정값 (추후 교체 대상)

export type ResourceKind = 'wood' | 'stone' | 'food' | 'crystal' | 'gold';

export type Resources = Record<ResourceKind, number>;

// 내부 키는 유지하고 표기만 SF 세계관에 맞춘다 (기존 저장 데이터 호환)
export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  wood: '광물',
  stone: '합금',
  food: '보급품',
  crystal: '가스',
  gold: '크레딧',
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

/** "B를 지으려면 A가 Lv.N 이상" — 원작의 건축 트리(建筑树)에 해당 */
export interface BuildingRequirement {
  buildingId: string;
  level: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  /** 생산 건물이면 어떤 자원을 만드는지 */
  produces?: ResourceKind;
  /** index 0 = 1레벨 */
  levels: BuildingLevel[];
  /** 건설(0→1레벨) 선행 조건. 없으면 처음부터 지을 수 있다 */
  requires?: BuildingRequirement[];
  provenance: Provenance;
}

export type RaceId = 'coalition' | 'cluster' | 'swarm';

export const RACE_LABELS: Record<RaceId, string> = {
  coalition: '연합',
  cluster: '성단',
  swarm: '군체',
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
  /**
   * 부지 격자 위치. 짓지 않은 건물은 좌표가 없다(= 건설 목록에 뜬다).
   * 플레이어가 드래그로 옮길 수 있으므로 코드가 아니라 저장 상태가 들고 있다.
   */
  col?: number;
  row?: number;
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

export interface ResearchJob {
  unitId: string;
  targetLevel: number;
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
  endurance: '내구',
  strength: '화력',
  agility: '기동',
  intellect: '전술',
  spirit: '제어',
  charisma: '통솔',
};

export type EquipSlot =
  | 'weapon'
  | 'shield'
  | 'head'
  | 'chest'
  | 'legs'
  | 'hands'
  | 'feet'
  | 'ring'
  | 'necklace';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'artifact';

/** 실제로 보유한 장비 한 점 */
export interface EquipItem {
  id: string;
  slot: EquipSlot;
  nameKo: string;
  nameCn?: string;
  rarity: Rarity;
  /** 착용 요구 영웅 레벨 */
  heroLevel: number;
  patk?: number;
  matk?: number;
  pdef?: number;
  mdef?: number;
  /** 액세서리 특수효과 */
  effect?: string;
  effectKo?: string;
  effectValue?: number;
  effectUnit?: 'percent' | 'multiplier';
  /** 세트 부위면 세트 id */
  setId?: string;
  setNameKo?: string;
}

export interface Hero {
  id: string;
  name: string;
  level: number;
  xp: number;
  stats: HeroStats;
  /** 착용 장비 (부위 → 장비). 없으면 빈 부위 */
  equipment?: Partial<Record<EquipSlot, EquipItem>>;
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

// ── 전투 ──────────────────────────────────────────────────────

export interface UnitCount {
  unitId: string;
  count: number;
}

/** 월드맵 위 장소의 공통 속성 */
export interface WorldSiteBase {
  id: string;
  name: string;
  description: string;
  /** 월드맵 타일 좌표 */
  pos: [number, number];
  marchSeconds: number;
  monsters: UnitCount[];
}

/** 사냥터 — 이기면 전리품을 한 번 받는다 */
export interface CampDef extends WorldSiteBase {
  loot: Partial<Resources>;
}

/** 자원지 — 점령하면 보유하는 동안 시간당 자원을 생산한다 */
export interface NodeDef extends WorldSiteBase {
  produces: ResourceKind;
  perHour: number;
}

export interface NodeHolding {
  nodeId: string;
  capturedAt: number; // epoch ms
}

export interface BattleLogEntry {
  round: number;
  /** 공격 측 */
  side: 'attacker' | 'defender';
  attacker: string;
  target: string;
  damage: number;
  killed: number;
  crit: boolean;
}

export interface BattleReport {
  id: string;
  at: number; // epoch ms
  campId: string;
  campName: string;
  heroName: string;
  victory: boolean;
  /** 자원지 점령전에서 승리해 점령했는가 */
  captured?: boolean;
  rounds: number;
  log: BattleLogEntry[];
  /** 아군 전사 */
  attackerLosses: UnitCount[];
  /** 적 처치 */
  defenderLosses: UnitCount[];
  survivors: UnitCount[];
  loot: Partial<Resources>;
  xpGained: number;
  /** 전투에서 얻은 장비 */
  drops?: EquipItem[];
  /** 편지함에서 열어본 기록인지 */
  read?: boolean;
}

export interface MarchJob {
  /** hunt = 사냥터 약탈, capture = 자원지 점령 */
  kind: 'hunt' | 'capture';
  campId: string;
  campName: string;
  heroId: string;
  /** 부대가 돌아오는 시각 — 이때 전투 결과가 반영된다 */
  returnsAt: number;
  /** 출정 시점에 미리 계산해 둔 전투 결과 */
  report: BattleReport;
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
  /** 유닛별 연구 레벨 (1~20). 없으면 1. 전투 시 이 레벨의 스탯을 쓴다 */
  unitLevels: Record<string, number>;
  /** 연구 큐도 한 번에 하나 */
  researchQueue: ResearchJob | null;
  /** 고용한 영웅들 */
  heroes: Hero[];
  /** 주점 상태 */
  tavern: TavernState;
  /** 원작처럼 건설 큐는 한 번에 하나 */
  upgradeQueue: UpgradeJob | null;
  /** 훈련 큐도 한 번에 하나 */
  trainQueue: TrainJob | null;
  /** 출정 중인 부대 (한 번에 하나) */
  march: MarchJob | null;
  /** 최근 전투 리포트 (최신순, 최대 10건) */
  reports: BattleReport[];
  /** 점령해 보유 중인 자원지 */
  heldNodes: NodeHolding[];
  /** 창고에 있는 미착용 장비 */
  inventory: EquipItem[];
}

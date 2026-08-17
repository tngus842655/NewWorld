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

/**
 * 건물이 앉는 자리.
 *   grid — 성 내부 6×6 부지 (기본값). 드래그로 옮길 수 있다
 *   wall — 기지를 두르는 외벽 그 자체. 부지를 쓰지 않고 자리도 고정
 *   gate — 남쪽 성벽 한가운데 출입구. 마찬가지로 고정
 */
export type BuildingPlacement = 'grid' | 'wall' | 'gate';

/** 다른 건물의 생산에 곱해지는 가공 건물 (원작 木材加工厂: 레벨당 +5%) */
export interface ProductionBoost {
  /** 'all'이면 자원 5종 전부 */
  resource: ResourceKind | 'all';
  percentPerLevel: number;
}

export type BuildingCategory = '자원' | '군사' | '방어' | '지휘' | '특수';

/**
 * 건물이 주는 효과의 종류. 수치는 데이터(base.json)가 들고,
 * 코드는 종류마다 '어디에 먹이는지'만 안다.
 * 새 효과를 붙이는 순서는 docs/BUILDING_EFFECTS.md 참고.
 */
export type BuildingEffectKind =
  /** 출정 부대의 물리방어 +% */
  | 'armyPdefPercent'
  /** 출정 부대의 마법방어 +% */
  | 'armyMdefPercent'
  /** 전투에서 얻는 지휘관 경험치 +% */
  | 'heroXpPercent'
  /** 전사자 중 부상으로 처리돼 복귀하는 비율 % */
  | 'woundedRecoveryPercent'
  /** 동시에 내보낼 수 있는 부대 수 +N */
  | 'marchSlots'
  /** 행군 시간 −% */
  | 'marchSpeedPercent'
  /** 정찰 등급 +N — 출정 전에 적 전력을 얼마나 자세히 보는지 */
  | 'scoutLevel'
  /** 자원 보관 한도 +N (자원 종류마다) */
  | 'storageCapacity'
  // ── 기지 방어전(침공) ──
  /** 방어 병력의 물리·마법 방어 +% — 성벽·성문 */
  | 'baseDefensePercent'
  /** 방어 병력의 실효 체력 +% — 실드 제너레이터의 역장 */
  | 'baseShieldPercent'
  /** 교전 전에 접근하는 적을 요격하는 피해량 — 포탑류 */
  | 'interceptDamage'
  /** 전투에서 빼돌려 지키는 병력 수 — 지하 병영 */
  | 'hideTroops'
  /** 방어 실패 시 약탈당하는 자원 비율 −% — 물류 창고 */
  | 'plunderResistPercent'
  /** 장비 강화 상한 +N — 장비 공방 */
  | 'maxEnhance'
  /** 자원 교환 수수료 −%p — 암시장 */
  | 'tradeFeeReduction'
  /** 창고 칸 +N — 유물 보관고 */
  | 'inventorySlots';

export interface BuildingEffect {
  kind: BuildingEffectKind;
  /** 레벨당 수치 — 합계는 레벨 × perLevel */
  perLevel: number;
}

/** 화면 표기용 — 효과를 추가하면 여기에도 한 줄 넣는다 */
export const BUILDING_EFFECT_INFO: Record<
  BuildingEffectKind,
  { label: string; unit: 'percent' | 'count' }
> = {
  armyPdefPercent: { label: '출정 부대 물리방어', unit: 'percent' },
  armyMdefPercent: { label: '출정 부대 마법방어', unit: 'percent' },
  heroXpPercent: { label: '전투 획득 경험치', unit: 'percent' },
  woundedRecoveryPercent: { label: '승리 시 전사자 중 부상 복귀', unit: 'percent' },
  marchSlots: { label: '동시 출정 부대', unit: 'count' },
  marchSpeedPercent: { label: '행군 시간 단축', unit: 'percent' },
  scoutLevel: { label: '정찰 등급', unit: 'count' },
  storageCapacity: { label: '자원별 보관 한도', unit: 'count' },
  baseDefensePercent: { label: '방어 병력 방어력', unit: 'percent' },
  baseShieldPercent: { label: '방어 병력 실효 체력', unit: 'percent' },
  interceptDamage: { label: '침공 요격 피해', unit: 'count' },
  hideTroops: { label: '침공 시 대피 병력', unit: 'count' },
  plunderResistPercent: { label: '약탈 피해 감소', unit: 'percent' },
  maxEnhance: { label: '장비 강화 상한', unit: 'count' },
  tradeFeeReduction: { label: '교환 수수료 감소', unit: 'percent' },
  inventorySlots: { label: '창고 칸', unit: 'count' },
};

/** 유물 보관고 없이도 쓰는 기본 창고 칸 수 */
export const BASE_INVENTORY_SLOTS = 20;

/** 암시장 기본 교환 수수료(%)와 아무리 낮춰도 남는 하한 */
export const BASE_TRADE_FEE = 30;
export const MIN_TRADE_FEE = 5;

/**
 * 창고 없이도 쌓아 둘 수 있는 기본 보관 한도 (자원 종류마다).
 * 한도는 **생산에만** 걸린다 — 전리품이나 이미 가진 자원이 깎이는 일은 없다.
 */
export const BASE_STORAGE = 50_000;

export interface BuildingDef {
  id: string;
  name: string;
  description: string;
  /** 건설 목록에서 묶어 보여줄 분류 */
  category: BuildingCategory;
  /** 생산 건물이면 어떤 자원을 만드는지 */
  produces?: ResourceKind;
  /** 가공 건물이면 어떤 자원 산출을 얼마나 올리는지 */
  boosts?: ProductionBoost;
  /** 그 밖의 효과 (전투 보정 등) */
  effects?: BuildingEffect[];
  /** 생략하면 'grid' */
  placement?: BuildingPlacement;
  /** index 0 = 1레벨 */
  levels: BuildingLevel[];
  /** 건설(0→1레벨) 선행 조건. 없으면 처음부터 지을 수 있다 */
  requires?: BuildingRequirement[];
  /** 지을 수는 있지만 효과가 아직 코드에 없는 건물 */
  planned?: boolean;
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

/**
 * 병종 계열 — 어느 건물에서 훈련하는지를 가른다.
 * 원작은 초급병영(1~3계)/고급병영(4~6계)으로 등급만 갈랐는데,
 * 여기서는 기갑·항공을 따로 두어 기갑 공장·우주항이 역할을 갖게 했다.
 */
export type UnitBranch = 'infantry' | 'vehicle' | 'air';

export const UNIT_BRANCH_LABELS: Record<UnitBranch, string> = {
  infantry: '보병',
  vehicle: '기갑',
  air: '항공',
};

export interface UnitDef {
  id: string;
  raceId: string;
  nameKo: string;
  nameCn?: string;
  /** 병계 (원작 兵阶, 1~8) */
  tier: number;
  /** 생략하면 보병 — 침략군·야생종처럼 훈련 대상이 아닌 유닛은 비워 둔다 */
  branch?: UnitBranch;
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

/**
 * 동시에 돌릴 수 있는 건설 슬롯. 슬롯마다 완료 시각이 따로 돌아
 * 10개를 걸어 두면 10개가 나란히 지어진다.
 */
export const DEFAULT_BUILD_SLOTS = 10;
/** 화면·정산이 감당하는 슬롯 상한 */
export const MAX_BUILD_SLOTS = 20;

/** 전술 지휘소 없이 기본으로 내보낼 수 있는 부대 수 */
export const BASE_MARCH_SLOTS = 1;
/** 화면·정산이 감당하는 출정 상한 */
export const MAX_MARCH_SLOTS = 10;

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
  | 'necklace'
  /** 탈것 정비고에서 사는 기동 장비 */
  | 'mount'
  /** 생체 사육장에서 기르는 전투 보조 개체 */
  | 'pet';

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
  /** 강화 수치. 없으면 0 — 능력치가 단계당 일정 비율로 오른다 */
  plus?: number;
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
  /**
   * march = 내가 나가서 친 전투, raid = 기지가 침공당한 방어전.
   * 어느 쪽이든 **attacker* 필드가 내 편**이고 defender* 가 상대다.
   * 생략하면 march (옛 저장분 호환).
   */
  kind?: 'march' | 'raid';
  campId: string;
  campName: string;
  heroName: string;
  /** march면 사냥 성공, raid면 방어 성공 */
  victory: boolean;
  /** raid: 포탑류가 교전 전에 요격해 없앤 적 수 */
  intercepted?: number;
  /** raid: 지하 병영으로 대피시켜 전투에서 뺀 병력 */
  hidden?: UnitCount[];
  /** raid: 방어 실패로 약탈당한 자원 */
  plundered?: Partial<Resources>;
  /** 창고가 꽉 차 버려진 전리품 장비 수 */
  lostDrops?: number;
  /** 자원지 점령전에서 승리해 점령했는가 */
  captured?: boolean;
  rounds: number;
  log: BattleLogEntry[];
  /** 아군 전사 (의무동이 살려 낸 부상병을 뺀 순손실) */
  attackerLosses: UnitCount[];
  /** 적 처치 */
  defenderLosses: UnitCount[];
  survivors: UnitCount[];
  /** 의무동이 전사자 중에서 살려 낸 병력 — 귀환 시 생환자와 함께 복귀한다 */
  recovered?: UnitCount[];
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
  /**
   * 진행 중인 건설 — 슬롯마다 하나씩 병렬로 돈다(각자 finishesAt를 가진다).
   * 지금 열려 있는 슬롯 수는 buildSlots가 정한다.
   */
  upgradeQueue: UpgradeJob[];
  /**
   * 열려 있는 건설 슬롯 수 (1 ~ MAX_BUILD_SLOTS). 없으면 1.
   * 앞으로 건물 효과·과금·이벤트로 늘릴 자리라서 상태로 들고 있다.
   */
  buildSlots?: number;
  /** 훈련 큐도 한 번에 하나 */
  trainQueue: TrainJob | null;
  /** 출정 중인 부대들 — 슬롯마다 하나씩, 각자 귀환 시각을 가진다 */
  march: MarchJob[];
  /** 최근 전투 리포트 (최신순, 최대 10건) */
  reports: BattleReport[];
  /** 투기장 순위와 다음 도전 가능 시각 */
  arena?: { rank: number; nextAt: number };
  /** 연맹 보급을 마지막으로 받은 시각 */
  guild?: { claimedAt: number };
  /**
   * 다음 침공이 닥치는 시각 (epoch ms). 없으면 첫 접속 때 정해진다.
   * 오프라인 중에도 이 시각이 지나면 advance()가 방어전을 정산한다.
   */
  nextRaidAt?: number;
  /** 점령해 보유 중인 자원지 */
  heldNodes: NodeHolding[];
  /** 창고에 있는 미착용 장비 */
  inventory: EquipItem[];
}

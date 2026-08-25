/**
 * 콘텐츠 JSON의 zod 스키마 — 모든 게임 수치·규칙 데이터의 유일한 형태 정의.
 * 빌드·테스트 시 전수 검증되며, 실패하면 게임이 뜨지 않는다 (DATA.md §3).
 */
import { z } from 'zod';

// ── 기본 열거 ────────────────────────────────────────────────────────────────
export const ELEMENTS = ['fire', 'nature', 'frost', 'light', 'dark'] as const;
export const TRIBES = ['beast', 'spirit', 'undead', 'aquatic', 'flying', 'construct'] as const;
// 등급 6단계 — 몬스터·유물 공용 (2026-08-23 통일, 2026-08-25 초월 추가)
// 순서가 곧 서열이다 — 반드시 뒤에 append (core/teams.ts가 indexOf를 서열로 쓴다).
// 'transcendent'(초월)는 합성으로만 도달하는 최종 등급 — 조우·드랍·상점 뽑기 확률은 전부 0 (2026-08-25 사용자)
export const RARITIES = ['common', 'uncommon', 'rare', 'heroic', 'legendary', 'transcendent'] as const;
export const MONSTER_RARITIES = RARITIES;
export const ARTIFACT_RARITIES = RARITIES;

/**
 * 등급 한글 라벨의 정본 — 라벨 표가 kit·effectText·demo 세 벌로 갈려 있어
 * 등급을 늘릴 때마다 세 곳을 따로 고쳐야 했다. DOM에 의존하지 않으므로 스크립트·코어도 쓸 수 있다.
 * Record라 등급이 늘면 TS가 누락을 잡는다. 순서를 뜻하지 않으니 정렬에 Object.keys를 쓰지 말 것.
 */
export const RARITY_LABEL: Record<(typeof RARITIES)[number], string> = {
  common: '일반', uncommon: '고급', rare: '희귀', heroic: '영웅', legendary: '전설', transcendent: '초월',
};

/**
 * 등급 서열 — RARITIES의 인덱스가 곧 서열이다. 정렬과 '이 등급 이상' 판정은 반드시 이걸 쓴다
 * (id 알파벳순은 뒤집히고, 리터럴 비교는 등급이 늘어도 조용히 그대로다).
 * 정본이 RARITIES 옆에 있어야 코어·UI·콘텐츠 로더가 층을 넘지 않고 같은 표를 쓴다.
 */
export const RARITY_ORDER = Object.fromEntries(
  RARITIES.map((rarity, index) => [rarity, index]),
) as Record<(typeof RARITIES)[number], number>;
export const SLOTS = ['weapon', 'armor', 'banner', 'charm'] as const;
export const TIERS = ['scout', 'standard', 'deep'] as const;
export const HOOKS = [
  'expeditionSetup',
  'computeParty',
  'beforeEncounter',
  'afterVictory',
  'afterDefeat',
  'captureRoll',
  'crossroad',
  'lootRoll',
  'journalEnd',
] as const;
export const ENCOUNTER_KINDS = ['monster', 'treasure', 'trap', 'gather'] as const;

export const ElementSchema = z.enum(ELEMENTS);
export const TribeSchema = z.enum(TRIBES);
export const MonsterRaritySchema = z.enum(MONSTER_RARITIES);
export const ArtifactRaritySchema = z.enum(ARTIFACT_RARITIES);
export const SlotSchema = z.enum(SLOTS);
export const TierSchema = z.enum(TIERS);
export const HookSchema = z.enum(HOOKS);
export const EncounterKindSchema = z.enum(ENCOUNTER_KINDS);

export type Element = z.infer<typeof ElementSchema>;
export type Tribe = z.infer<typeof TribeSchema>;
export type MonsterRarity = z.infer<typeof MonsterRaritySchema>;
export type ArtifactRarity = z.infer<typeof ArtifactRaritySchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type Hook = z.infer<typeof HookSchema>;
export type EncounterKind = z.infer<typeof EncounterKindSchema>;

// ── Effect 문법 (DATA.md §1.5) — 시너지·유물·세트·마일스톤 버프 공용 ─────────
export const ConditionSchema = z.object({
  region: z.array(z.string()).optional(), // 지역 id 목록 (OR)
  tier: TierSchema.optional(),
  element: ElementSchema.optional(), // computeParty: 유닛 속성 / captureRoll: 대상 몬스터 속성
  tribe: TribeSchema.optional(), // computeParty: 유닛 종족 / captureRoll: 대상 몬스터 종족
  encounterKind: EncounterKindSchema.optional(),
  encounterRarity: MonsterRaritySchema.optional(), // 대상 몬스터 등급 이상
  encounterIndex: z.number().int().min(0).optional(), // n번째 조우(0부터)
  hpBelow: z.number().min(0).max(1).optional(), // 파티 HP 비율 이하일 때
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('statMult'), stat: z.enum(['atk', 'hp', 'cp']), value: z.number() }),
  z.object({ kind: z.literal('damageReduce'), value: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('heal'), ratio: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('reviveOnce'), hpRatio: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('autoWin') }),
  z.object({ kind: z.literal('captureAdd'), value: z.number() }),
  z.object({ kind: z.literal('captureRetry'), perExpedition: z.number().int().min(1) }),
  z.object({ kind: z.literal('synergyAmp'), value: z.number().min(0) }),
  z.object({ kind: z.literal('rewardMult'), target: z.enum(['gold', 'materials', 'all']), value: z.number() }),
  z.object({ kind: z.literal('timeMult'), value: z.number().min(0.1).max(1) }),
  z.object({ kind: z.literal('encounterAdd'), count: z.number().int().min(1) }),
  z.object({ kind: z.literal('encounterMixMult'), target: EncounterKindSchema, value: z.number().min(0) }),
  z.object({ kind: z.literal('spawnWeightMult'), minRarity: MonsterRaritySchema, value: z.number().min(0) }),
  z.object({ kind: z.literal('salvageOnFail'), ratio: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('crossroadSuccessAdd'), value: z.number() }),
  z.object({ kind: z.literal('fleeRewardRatioSet'), value: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('trapAvoid'), chance: z.number().min(0).max(1) }),
  z.object({ kind: z.literal('healReceivedMult'), value: z.number().min(0) }),
]);
export type Action = z.infer<typeof ActionSchema>;

export const EffectSchema = z.object({
  hook: HookSchema,
  when: ConditionSchema.optional(),
  do: ActionSchema,
});
export type Effect = z.infer<typeof EffectSchema>;

// 계정 영구 보너스 계단 (GDD §4.6, 2026-08-25) — 점수 도달 시 영구 발동, 마일스톤 버프처럼 재계산
export const AccountBonusTierSchema = z.object({
  score: z.number().int().positive(),
  effects: z.array(EffectSchema).min(1),
});
export type AccountBonusTier = z.infer<typeof AccountBonusTierSchema>;

// ── 몬스터 ───────────────────────────────────────────────────────────────────
export const MonsterSchema = z.object({
  id: z.string(),
  name: z.string(),
  element: ElementSchema,
  tribe: TribeSchema,
  rarity: MonsterRaritySchema,
  baseHp: z.number().int().positive(),
  baseAtk: z.number().int().positive(),
  habitat: z.string(),
  asset: z.string(),
  flavor: z.string(),
  unique: z.array(EffectSchema).default([]), // 고유 능력 — 전설 전용, 파티에 있으면 발동 (2026-08-24)
  tags: z.array(z.string()).default([]), // 확장 슬롯 (v1 미사용)
});
export type Monster = z.infer<typeof MonsterSchema>;

// ── 지역 ─────────────────────────────────────────────────────────────────────
export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().min(1), // 지역 고유 아이콘 — 몬스터 출신 표기·지역 목록에 사용 (속성 이모지와 별개)
  order: z.number().int().positive(),
  growthCostMult: z.number().positive(), // 출신 몬스터의 레벨업·각성 골드 배수 (원정 단계 비례 — rewardScale과 같은 계단)
  element: ElementSchema,
  recommendedCp: z.number().positive(),
  rewardScale: z.number().positive(),
  unlock: z.object({
    codexCaptured: z.record(z.string(), z.number().int().positive()).optional(),
    materials: z.record(z.string(), z.number().int().positive()).optional(),
  }),
  materials: z.array(z.string()).length(2),
  legendary: z.array(z.string()).nonempty(), // 심층 한정 전설 (지역당 2종 — 조우 시 시드로 1종 선택)
  encounterMix: z.object({
    monster: z.number().positive(),
    treasure: z.number().positive(),
    trap: z.number().positive(),
    gather: z.number().positive(),
  }),
  spawns: z.array(z.object({ monster: z.string(), weight: z.number().positive() })).min(1),
});
export type Region = z.infer<typeof RegionSchema>;

export const MaterialSchema = z.object({ id: z.string(), name: z.string(), icon: z.string(), region: z.string(), desc: z.string().min(1) });
export type Material = z.infer<typeof MaterialSchema>;

// ── 시너지 ───────────────────────────────────────────────────────────────────
export const SynergyDefSchema = z.object({
  name: z.string(),
  at2: z.array(EffectSchema), // 2마리 발동 효과
  at3: z.array(EffectSchema), // 3마리 발동 효과 (at2를 대체하는 완전판)
});
export type SynergyDef = z.infer<typeof SynergyDefSchema>;
export const SynergiesSchema = z.record(TribeSchema, SynergyDefSchema);

// ── 이벤트 ───────────────────────────────────────────────────────────────────
export const RewardSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gold'), amount: z.number().positive() }), // region.rewardScale 곱해짐
  z.object({ kind: z.literal('material'), slot: z.union([z.literal(0), z.literal(1)]), count: z.number().int().positive() }),
  z.object({ kind: z.literal('cardRandom'), count: z.number().int().positive() }), // 보유 종 중 랜덤 카드 +n
  z.object({ kind: z.literal('artifactRoll'), rarityBonus: z.number().min(0).max(1).optional() }),
  z.object({ kind: z.literal('lure'), count: z.number().int().positive() }),
]);
export type Reward = z.infer<typeof RewardSchema>;

export const CrossroadEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  text: z.string(),
  safe: z.array(RewardSchema).min(1),
  risky: z.object({
    success: z.array(RewardSchema).min(1),
    fail: z.object({ kind: z.literal('damage'), ratio: z.number().min(0).max(1) }),
  }),
});
export type CrossroadEvent = z.infer<typeof CrossroadEventSchema>;

export const EventsSchema = z.object({
  crossroads: z.array(CrossroadEventSchema).min(1),
  traps: z.array(z.object({ id: z.string(), name: z.string(), text: z.string() })).min(1),
  treasures: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  gathers: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
});
export type EventsContent = z.infer<typeof EventsSchema>;

// ── 제작 ─────────────────────────────────────────────────────────────────────
/**
 * 제작 산출 — 미끼 또는 모래시계 (2026-08-25).
 * discriminatedUnion이라 kind를 추가하면 core의 switch가 컴파일 에러로 미구현을 알린다.
 * (기존 { lures: n } 고정에서 확장 — 지역 재료 8종 중 3종이 소모처가 없던 문제를 푼다)
 */
export const RecipeOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lures'), count: z.number().int().positive() }),
  z.object({ kind: z.literal('hourglass'), hourglassId: z.string(), count: z.number().int().positive() }),
]);
export type RecipeOutput = z.infer<typeof RecipeOutputSchema>;

export const RecipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.object({
    gold: z.number().int().min(0),
    materials: z.record(z.string(), z.number().int().positive()),
  }),
  output: RecipeOutputSchema,
});
export type Recipe = z.infer<typeof RecipeSchema>;

// ── 유물 ─────────────────────────────────────────────────────────────────────
export const MainStatSchema = z.enum(['atkMult', 'hpMult', 'captureAdd', 'synergyAmp', 'goldMult']);
export type MainStat = z.infer<typeof MainStatSchema>;
// (2026-08-23) 부옵션 시스템 폐지 — 유물이 종 단위(개수·공통 강화)로 통합되며 개체 차이 개념 제거

export const ArtifactDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  slot: SlotSchema,
  rarity: ArtifactRaritySchema,
  set: z.string().nullable(),
  main: z.object({ stat: MainStatSchema, base: z.number(), perEnhance: z.number() }),
  unique: z.array(EffectSchema),
  asset: z.string(),
  flavor: z.string(),
  tags: z.array(z.string()).default([]),
});
export type ArtifactDef = z.infer<typeof ArtifactDefSchema>;

export const SetDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  bonuses: z.object({ '2': z.array(EffectSchema), '4': z.array(EffectSchema) }),
});
export type SetDef = z.infer<typeof SetDefSchema>;

export const ItemsSchema = z.object({
  artifacts: z.array(ArtifactDefSchema).min(1),
  sets: z.array(SetDefSchema),
});

// ── 모래시계 (2026-08-23) — 진행 중 원정의 남은 시간을 줄이는 소모품 ──────────
export const HourglassSchema = z.object({
  id: z.string(),
  name: z.string(),
  minutes: z.number().int().positive(), // 단축량 (분)
  rarity: z.enum(RARITIES), // 몬스터·유물과 같은 5등급 — 테두리 색 구분
  asset: z.string(),
  flavor: z.string(),
});
export type HourglassDef = z.infer<typeof HourglassSchema>;

// ── 마일스톤 ─────────────────────────────────────────────────────────────────
/**
 * 업적 조건. 사다리는 **두 축**이다 (2026-08-25 사용자 결정).
 *
 * - 서식종 축 (regionCaptured·tribeCaptured·totalCaptured): 지역 출현 테이블에 실제로 등장하는
 *   216종만 센다. 초월은 합성 전용이라 어느 지역에도 서식하지 않으므로 여기서 빠진다 —
 *   넣어두면 화산 서식종 51종 + 초월 3종으로 "잿빛 화산 완전 정복"이 터진다.
 * - 초월 축 (rarityCaptured): 등급 단위로 센다. 서식종 축과 달리 초월을 포함한 전 등급이 대상.
 *
 * 집계 정본은 core/progression.ts capturedCounts 하나뿐이다. 두 축의 상한이 총 종 수를 덮는지는
 * tests/content.test.ts가 고정한다 — 종을 늘리면 사다리도 같이 늘려야 통과한다.
 */
export const MilestoneConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('regionCaptured'), region: z.string(), count: z.number().int().positive() }),
  z.object({ kind: z.literal('tribeCaptured'), tribe: TribeSchema, count: z.number().int().positive() }),
  z.object({ kind: z.literal('totalCaptured'), count: z.number().int().positive() }),
  z.object({ kind: z.literal('rarityCaptured'), rarity: MonsterRaritySchema, count: z.number().int().positive() }),
]);
export type MilestoneCondition = z.infer<typeof MilestoneConditionSchema>;

export const MilestoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  condition: MilestoneConditionSchema,
  reward: z.object({
    gold: z.number().int().min(0).optional(),
    dust: z.number().int().min(0).optional(),
    effects: z.array(EffectSchema).optional(), // 영구 버프 — 저장하지 않고 로드 시 재계산
  }),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

// ── 반복 과업 (2026-08-23, GDD §9.3) — 업적(마일스톤)과 달리 카운터 기반 무한 반복 ──
export const TaskCounterSchema = z.enum(['expedition', 'capture', 'craft', 'fusion']);
export type TaskCounter = z.infer<typeof TaskCounterSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  counter: TaskCounterSchema, // 세이브 stats의 어느 누적 카운터를 보는지
  every: z.number().int().positive(), // N회마다 1회 달성
  reward: z.object({
    gold: z.number().int().min(0).default(0), // 소모 재화만 — 영구 버프는 업적 전용 (중첩 방지)
    dust: z.number().int().min(0).default(0),
  }),
  score: z.number().int().positive(), // 달성 1회당 랭킹 점수
});
export type TaskDef = z.infer<typeof TaskSchema>;

// ── 상점 (2026-08-23, GDD §9.4) — 골드/다이아 2관, 상품별 구매 한도 ───────────
export const MONSTER_GACHA_TABLES = ['normal', 'premium', 'goldNormal'] as const;
export const ARTIFACT_GACHA_TABLES = ['standard', 'premium'] as const;

export const ShopGoodsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('bundle'),
    gold: z.number().int().min(0).default(0),
    dust: z.number().int().min(0).default(0),
    lures: z.number().int().min(0).default(0),
  }),
  // 해금한 모든 지역의 재료를 각 n개 (+골드) — 지역 선택형 materials·regionPack 대체 (2026-08-23)
  z.object({ kind: z.literal('materialsAll'), countEach: z.number().int().positive(), gold: z.number().int().min(0).default(0) }),
  z.object({ kind: z.literal('monsterGacha'), table: z.enum(MONSTER_GACHA_TABLES) }),
  z.object({ kind: z.literal('artifactGacha'), table: z.enum(ARTIFACT_GACHA_TABLES) }),
  // rush(즉시 귀환) 상품은 폐지 (2026-08-23) — 가속은 모래시계 아이템으로 일원화
  z.object({ kind: z.literal('hourglass'), hourglassId: z.string(), count: z.number().int().positive().default(1) }),
]);
export type ShopGoods = z.infer<typeof ShopGoodsSchema>;

export const ShopLimitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), count: z.number().int().positive() }),
  z.object({ kind: z.literal('once') }),
  z.object({ kind: z.literal('none') }), // 무제한 — 다이아 상점 (2026-08-23 사용자, oncePerRegion은 지역 선택 폐지로 제거)
]);
export type ShopLimit = z.infer<typeof ShopLimitSchema>;

export const ShopProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  desc: z.string(),
  shop: z.enum(['gold', 'diamond']),
  price: z.number().int().positive(),
  limit: ShopLimitSchema,
  goods: ShopGoodsSchema,
});
export type ShopProduct = z.infer<typeof ShopProductSchema>;

// ── 밸런스 (전역 계수 — 코드에 매직넘버 금지) ────────────────────────────────
export const BalanceSchema = z.object({
  element: z.object({ same: z.number(), advantage: z.number(), disadvantage: z.number() }),
  cp: z.object({ atkWeight: z.number(), hpWeight: z.number() }),
  level: z.object({
    statGrowth: z.number(),
    goldBase: z.number(),
    goldExp: z.number(),
    max: z.number().int(),
    rarityCostMult: z.record(MonsterRaritySchema, z.number()), // 등급별 성장 비용 배수 (레벨·성급 공용)
  }),
  star: z.object({ mult: z.number(), max: z.number().int(), goldCost: z.array(z.number().int()) }),
  fusion: z.object({
    materials: z.number().int().min(2), // 재료 카드 수 (같은 등급, 여분만)
    chance: z.record(MonsterRaritySchema, z.number().min(0).max(1)), // 재료 등급 → 성공 확률
  }),
  capture: z.object({
    base: z.record(MonsterRaritySchema, z.number()),
    lureMult: z.number(),
    adBuffMult: z.number(),
    multCap: z.number(),
    chanceCap: z.number(),
    firstCaptureGuarantee: z.boolean(), // 계정 첫 포획 시도 100% 성공 (GDD §13)
  }),
  tiers: z.record(
    TierSchema,
    z.object({
      minutes: z.number().int(),
      encounters: z.number().int(),
      crossroads: z.number().int(),
      yieldMult: z.number(),
      legendaryChance: z.number(),
      rareWeightMult: z.number(),
    }),
  ),
  combat: z.object({
    encounterPowerMult: z.number(),
    victoryDamageK: z.number(),
    defeatDamageK: z.number(),
    defeatRatioCap: z.number(),
    trapDamage: z.number(),
    fleeRewardRatio: z.number(),
  }),
  rewards: z.object({
    goldPerVictory: z.number(),
    goldPerTreasure: z.number(),
    gatherMaterialMin: z.number().int(),
    gatherMaterialMax: z.number().int(),
    rarityGoldMult: z.record(MonsterRaritySchema, z.number()),
  }),
  crossroad: z.object({
    timeoutHours: z.number(),
    riskyCheckRatio: z.number(),
    baseChanceFloor: z.number(),
    baseChanceCeil: z.number(),
  }),
  party: z.object({
    baseSlots: z.number().int(),
    slotUnlocks: z.array(z.object({ slots: z.number().int(), gold: z.number().int(), totalCaptured: z.number().int() })),
  }),
  teams: z.array(
    z.object({
      count: z.number().int(),
      regionUnlocked: z.string().optional(),
      totalCaptured: z.number().int().optional(),
    }),
  ),
  ads: z.object({ daily: z.record(z.string(), z.number().int()) }),
  lures: z.object({ maxLoad: z.number().int() }),
  artifacts: z.object({
    dropRarity: z.record(ArtifactRaritySchema, z.number()),
    sources: z.object({
      treasureChance: z.number(),
      deepClearBox: z.boolean(),
      legendaryEncounter: z.number(),
      crossroadCrit: z.number(),
    }),
    firstTreasurePity: z.boolean(),
    enhance: z.object({
      max: z.number().int(),
      dustCost: z.array(z.number().int()),
      rarityCostMult: z.record(ArtifactRaritySchema, z.number()), // 등급별 강화 가루 배수
    }),
    effectCaps: z.object({
      rewardMult: z.number(),
      timeMultMin: z.number(),
      damageReduceMax: z.number(),
      synergyAmpMax: z.number(),
      trapAvoidMax: z.number(),
    }),
  }),
  // 계정 영구 보너스 (GDD §4.6) — 조련(몬스터 레벨·각성)·공명(유물 강화) 계단
  accountBonus: z.object({
    starWeight: z.number().positive(), // 성급 1단 = 레벨 몇 개분으로 칠 것인가
    training: z.array(AccountBonusTierSchema).min(1),
    resonance: z.array(AccountBonusTierSchema).min(1),
  }),
  starter: z.object({ monsters: z.array(z.string()), gold: z.number().int(), lures: z.number().int() }),
  shop: z.object({
    // 뽑기 확률표 — 확률 정보 시트에 그대로 공개 (확률형 아이템 고지 의무)
    monsterGacha: z.record(z.enum(MONSTER_GACHA_TABLES), z.record(MonsterRaritySchema, z.number())),
    artifactGacha: z.record(z.enum(ARTIFACT_GACHA_TABLES), z.record(ArtifactRaritySchema, z.number())),
  }),
  // 월간 출석 (2026-08-23) — n번째 출석 순서대로 지급, 표를 다 받으면 도장만 찍힌다
  attendance: z.object({
    rewards: z.array(z.object({
      gold: z.number().int().positive().optional(),
      dust: z.number().int().positive().optional(),
      diamonds: z.number().int().positive().optional(),
      lures: z.number().int().positive().optional(),
    })).min(1),
  }),
});
export type Balance = z.infer<typeof BalanceSchema>;
export type AttendanceReward = Balance['attendance']['rewards'][number];

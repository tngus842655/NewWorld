/**
 * 콘텐츠 JSON의 zod 스키마 — 모든 게임 수치·규칙 데이터의 유일한 형태 정의.
 * 빌드·테스트 시 전수 검증되며, 실패하면 게임이 뜨지 않는다 (DATA.md §3).
 */
import { z } from 'zod';

// ── 기본 열거 ────────────────────────────────────────────────────────────────
export const ELEMENTS = ['fire', 'nature', 'frost', 'light', 'dark'] as const;
export const TRIBES = ['beast', 'spirit', 'undead', 'aquatic', 'flying', 'construct'] as const;
// 등급 5단계 — 몬스터·유물 공용 (2026-08-23 통일: 일반/고급/희귀/영웅/전설)
export const RARITIES = ['common', 'uncommon', 'rare', 'heroic', 'legendary'] as const;
export const MONSTER_RARITIES = RARITIES;
export const ARTIFACT_RARITIES = RARITIES;
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
  tags: z.array(z.string()).default([]), // 확장 슬롯 (v1 미사용)
});
export type Monster = z.infer<typeof MonsterSchema>;

// ── 지역 ─────────────────────────────────────────────────────────────────────
export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int().positive(),
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

export const MaterialSchema = z.object({ id: z.string(), name: z.string(), region: z.string() });
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
export const RecipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: z.object({
    gold: z.number().int().min(0),
    materials: z.record(z.string(), z.number().int().positive()),
  }),
  output: z.object({ lures: z.number().int().positive() }),
});
export type Recipe = z.infer<typeof RecipeSchema>;

// ── 유물 ─────────────────────────────────────────────────────────────────────
export const MainStatSchema = z.enum(['atkMult', 'hpMult', 'captureAdd', 'synergyAmp', 'goldMult']);
export type MainStat = z.infer<typeof MainStatSchema>;
export const SubstatSchema = z.enum(['atkMult', 'hpMult', 'captureAdd', 'goldMult', 'materialMult', 'damageReduce']);
export type Substat = z.infer<typeof SubstatSchema>;

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

// ── 마일스톤 ─────────────────────────────────────────────────────────────────
export const MilestoneConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('regionCaptured'), region: z.string(), count: z.number().int().positive() }),
  z.object({ kind: z.literal('tribeCaptured'), tribe: TribeSchema, count: z.number().int().positive() }),
  z.object({ kind: z.literal('totalCaptured'), count: z.number().int().positive() }),
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

// ── 밸런스 (전역 계수 — 코드에 매직넘버 금지) ────────────────────────────────
export const BalanceSchema = z.object({
  element: z.object({ same: z.number(), advantage: z.number(), disadvantage: z.number() }),
  cp: z.object({ atkWeight: z.number(), hpWeight: z.number() }),
  level: z.object({ statGrowth: z.number(), goldBase: z.number(), goldExp: z.number(), max: z.number().int() }),
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
    enhance: z.object({ max: z.number().int(), dustCost: z.array(z.number().int()) }),
    dustPerSalvage: z.record(ArtifactRaritySchema, z.number().int()),
    substatCount: z.record(ArtifactRaritySchema, z.number().int()),
    substatPool: z.array(z.object({ stat: SubstatSchema, min: z.number(), max: z.number(), weight: z.number() })),
    effectCaps: z.object({
      rewardMult: z.number(),
      timeMultMin: z.number(),
      damageReduceMax: z.number(),
      synergyAmpMax: z.number(),
      trapAvoidMax: z.number(),
    }),
  }),
  starter: z.object({ monsters: z.array(z.string()), gold: z.number().int(), lures: z.number().int() }),
});
export type Balance = z.infer<typeof BalanceSchema>;

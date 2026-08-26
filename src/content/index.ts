/**
 * 콘텐츠 로더 — JSON을 zod로 검증하고 파생 인덱스를 만든다.
 * 참조 무결성(존재하지 않는 id 참조)은 여기서 즉시 throw — 잘못된 콘텐츠는 실행 불가.
 */
import {
  ARTIFACT_RARITIES,
  RARITY_ORDER,
  BalanceSchema,
  EventsSchema,
  HourglassSchema,
  ItemsSchema,
  MaterialSchema,
  MilestoneSchema,
  MonsterSchema,
  RecipeSchema,
  RegionSchema,
  ShopProductSchema,
  SynergiesSchema,
  TaskSchema,
  type ArtifactDef,
  type ArtifactRarity,
  type Balance,
  type EventsContent,
  type HourglassDef,
  type Material,
  type Milestone,
  type Monster,
  type Recipe,
  type Region,
  type SetDef,
  type ShopProduct,
  type SynergyDef,
  type TaskDef,
  type Tribe,
} from './schema';

import balanceRaw from './data/balance.json';
import eventsRaw from './data/events.json';
import hourglassesRaw from './data/hourglasses.json';
import itemsRaw from './data/items.json';
import materialsRaw from './data/materials.json';
import milestonesRaw from './data/milestones.json';
import monstersRaw from './data/monsters.json';
import recipesRaw from './data/recipes.json';
import regionsRaw from './data/regions.json';
import shopRaw from './data/shop.json';
import synergiesRaw from './data/synergies.json';
import tasksRaw from './data/tasks.json';

export interface Content {
  monsters: ReadonlyMap<string, Monster>;
  monsterList: readonly Monster[];
  /**
   * 서식종 — 초월을 뺀, 지역 출현 테이블에 실제로 등장하는 종 (2026-08-25).
   * 도감 사다리·해금 조건의 모수는 monsterList가 아니라 이쪽이다
   * (초월은 합성 전용이라 habitat이 최종 지역이어도 그 지역에서 잡을 수 없다).
   */
  nativeList: readonly Monster[];
  /** 합성 전용 최종 등급 — 초월 축 업적의 모수 */
  transcendentList: readonly Monster[];
  regions: ReadonlyMap<string, Region>;
  regionList: readonly Region[]; // order 순 정렬
  materials: ReadonlyMap<string, Material>;
  synergies: ReadonlyMap<Tribe, SynergyDef>;
  events: EventsContent;
  recipes: ReadonlyMap<string, Recipe>;
  artifacts: ReadonlyMap<string, ArtifactDef>;
  artifactsByRarity: ReadonlyMap<ArtifactRarity, readonly ArtifactDef[]>;
  sets: ReadonlyMap<string, SetDef>;
  milestones: readonly Milestone[];
  tasks: readonly TaskDef[]; // 반복 과업 (GDD §9.3)
  shopProducts: readonly ShopProduct[]; // 상점 상품 (GDD §9.4)
  hourglasses: ReadonlyMap<string, HourglassDef>; // 원정 가속 소모품 (2026-08-23)
  hourglassList: readonly HourglassDef[]; // 단축량 오름차순
  balance: Balance;
}

function fail(msg: string): never {
  throw new Error(`[content] ${msg}`);
}

function toMap<T extends { id: string }>(list: T[], kind: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of list) {
    if (map.has(item.id)) fail(`${kind} id 중복: ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

export function loadContent(): Content {
  const monsterList = MonsterSchema.array().parse(monstersRaw);
  const regionList = RegionSchema.array().parse(regionsRaw).sort((a, b) => a.order - b.order);
  const materialList = MaterialSchema.array().parse(materialsRaw);
  const synergiesParsed = SynergiesSchema.parse(synergiesRaw);
  const events = EventsSchema.parse(eventsRaw);
  const recipeList = RecipeSchema.array().parse(recipesRaw);
  const items = ItemsSchema.parse(itemsRaw);
  const milestones = MilestoneSchema.array().parse(milestonesRaw);
  const tasks = TaskSchema.array().parse(tasksRaw);
  const shopProducts = ShopProductSchema.array().parse(shopRaw);
  const hourglassList = HourglassSchema.array().parse(hourglassesRaw).sort((a, b) => a.minutes - b.minutes);
  const balance = BalanceSchema.parse(balanceRaw);
  toMap(tasks as { id: string }[], 'task'); // id 중복 검증만
  toMap(shopProducts as { id: string }[], 'shopProduct');
  const hourglasses = toMap(hourglassList, 'hourglass');

  const monsters = toMap(monsterList, 'monster');
  const nativeList = monsterList.filter((m) => m.rarity !== 'transcendent');
  const transcendentList = monsterList.filter((m) => m.rarity === 'transcendent');
  const regions = toMap(regionList, 'region');
  const materials = toMap(materialList, 'material');
  const recipes = toMap(recipeList, 'recipe');
  const artifacts = toMap(items.artifacts, 'artifact');
  const sets = toMap(items.sets, 'set');

  const synergies = new Map<Tribe, SynergyDef>();
  for (const [tribe, def] of Object.entries(synergiesParsed)) {
    if (def) synergies.set(tribe as Tribe, def);
  }

  // ── 티어(바이옴) 구조 (2026-08-26 12지역 개편) ──
  // order 순으로 tier가 1부터 빈틈없이 이어지고, 같은 tier는 바이옴 계단(속성·재료·경제 배수)을 공유한다.
  // 코어가 "같은 티어 = 같은 재료 풀"(해금 예약·수급 대칭)을 전제하므로 데이터가 아니라 로더가 막는다.
  {
    let expected = 1;
    const entries = new Map<number, Region>();
    for (const region of regionList) {
      if (region.tier !== expected && region.tier !== expected + 1) {
        fail(`지역 tier가 order 순으로 이어지지 않음: ${region.id} (tier ${region.tier}, 기대 ${expected}~${expected + 1})`);
      }
      expected = region.tier;
      const entry = entries.get(region.tier);
      if (!entry) {
        entries.set(region.tier, region);
        continue;
      }
      if (entry.element !== region.element) fail(`같은 티어의 속성 불일치: ${entry.id} vs ${region.id}`);
      if (entry.materials.join() !== region.materials.join()) fail(`같은 티어의 재료 불일치: ${entry.id} vs ${region.id}`);
      if (entry.growthCostMult !== region.growthCostMult) fail(`같은 티어의 성장 배수 불일치: ${entry.id} vs ${region.id}`);
      if (entry.rewardScale !== region.rewardScale) fail(`같은 티어의 보상 배수 불일치: ${entry.id} vs ${region.id}`);
    }
    if (regionList[0] && regionList[0].tier !== 1) fail('첫 지역의 tier가 1이 아님');
  }

  // ── 참조 무결성 ──
  for (const region of regionList) {
    for (const spawn of region.spawns) {
      const m = monsters.get(spawn.monster) ?? fail(`${region.id} spawns가 없는 몬스터 참조: ${spawn.monster}`);
      if (m.habitat !== region.id) fail(`${spawn.monster}의 habitat(${m.habitat})와 출현 지역(${region.id}) 불일치`);
      // 전설은 legendary 필드로만, 초월은 어디에도 스폰되지 않는다 (합성 전용 — 2026-08-25 사용자)
      if (RARITY_ORDER[m.rarity] >= RARITY_ORDER.legendary) {
        fail(`${region.id} spawns에 ${m.rarity} 몬스터(${spawn.monster}) — 전설은 legendary 필드로만, 초월은 합성 전용`);
      }
    }
    for (const legendId of region.legendary) {
      const legend = monsters.get(legendId) ?? fail(`${region.id} legendary가 없는 몬스터 참조: ${legendId}`);
      if (legend.rarity !== 'legendary') fail(`${region.id} legendary(${legendId})의 등급이 legendary가 아님`);
      if (legend.habitat !== region.id) fail(`${legendId}의 habitat(${legend.habitat})와 legendary 지역(${region.id}) 불일치`);
    }
    for (const mat of region.materials) {
      if (!materials.has(mat)) fail(`${region.id} materials가 없는 재료 참조: ${mat}`);
    }
    for (const mat of Object.keys(region.unlock.materials ?? {})) {
      if (!materials.has(mat)) fail(`${region.id} unlock이 없는 재료 참조: ${mat}`);
    }
    for (const rid of Object.keys(region.unlock.codexCaptured ?? {})) {
      if (rid !== region.id && !regions.has(rid)) fail(`${region.id} unlock이 없는 지역 참조: ${rid}`);
    }
  }
  for (const monster of monsterList) {
    if (!regions.has(monster.habitat)) fail(`${monster.id} habitat이 없는 지역 참조: ${monster.habitat}`);
    // 고유 능력은 전설 이상 전용·전설 이상 필수 (유물 GDD §8.2와 대칭 — 2026-08-24, 2026-08-25 초월 포함)
    const rank = RARITY_ORDER[monster.rarity];
    if (rank >= RARITY_ORDER.legendary && monster.unique.length === 0) fail(`${monster.rarity} 몬스터 ${monster.id}에 고유 능력이 없음`);
    if (rank < RARITY_ORDER.legendary && monster.unique.length > 0) fail(`${monster.id}에 고유 능력 — 고유 능력은 전설 이상 전용`);
    for (const effect of monster.unique) {
      for (const rid of effect.when?.region ?? []) {
        if (!regions.has(rid)) fail(`몬스터 ${monster.id} 고유 능력이 없는 지역 참조: ${rid}`);
      }
    }
  }
  for (const material of materialList) {
    if (!regions.has(material.region)) fail(`${material.id}가 없는 지역 참조: ${material.region}`);
  }
  for (const recipe of recipeList) {
    for (const mat of Object.keys(recipe.cost.materials)) {
      if (!materials.has(mat)) fail(`레시피 ${recipe.id}가 없는 재료 참조: ${mat}`);
    }
  }
  for (const artifact of items.artifacts) {
    if (artifact.set !== null && !sets.has(artifact.set)) fail(`유물 ${artifact.id}가 없는 세트 참조: ${artifact.set}`);
    for (const effect of artifact.unique) {
      for (const rid of effect.when?.region ?? []) {
        if (!regions.has(rid)) fail(`유물 ${artifact.id} 효과가 없는 지역 참조: ${rid}`);
      }
    }
  }
  for (const set of items.sets) {
    const members = items.artifacts.filter((a) => a.set === set.id);
    if (members.length !== 4) fail(`세트 ${set.id}의 구성 유물이 4개가 아님 (${members.length}개)`);
    if (new Set(members.map((m) => m.slot)).size !== 4) fail(`세트 ${set.id}가 4슬롯을 전부 커버하지 않음`);
  }
  // 마일스톤은 참조가 유효할 뿐 아니라 **달성 가능**해야 한다 — 모수를 넘는 계단은 영영 안 터진다.
  // 초월 3종을 넣으며 화산 사다리(54)와 화산 소속(57)이 어긋난 적이 있다 (2026-08-25).
  for (const milestone of milestones) {
    const c = milestone.condition;
    if (c.kind === 'regionCaptured' && !regions.has(c.region)) {
      fail(`마일스톤 ${milestone.id}가 없는 지역 참조: ${c.region}`);
    }
    // 모수는 축마다 다르다 — 서식종 축은 nativeList, 초월 축(rarityCaptured)만 전 등급을 본다
    const cap =
      c.kind === 'regionCaptured'
        ? nativeList.filter((m) => m.habitat === c.region).length
        : c.kind === 'tribeCaptured'
          ? nativeList.filter((m) => m.tribe === c.tribe).length
          : c.kind === 'totalCaptured'
            ? nativeList.length
            : monsterList.filter((m) => m.rarity === c.rarity).length;
    if (c.count > cap) fail(`마일스톤 ${milestone.id}의 조건 ${c.count}종이 모수 ${cap}종을 넘음 — 달성 불가`);
  }
  for (const id of balance.starter.monsters) {
    if (!monsters.has(id)) fail(`starter가 없는 몬스터 참조: ${id}`);
  }
  for (const product of shopProducts) {
    if (product.goods.kind === 'hourglass' && !hourglasses.has(product.goods.hourglassId)) {
      fail(`상품 ${product.id}가 없는 모래시계 참조: ${product.goods.hourglassId}`);
    }
  }
  // 레시피도 같은 규칙 — 산출이 모래시계면 실재해야 하고, 비용 재료도 실재해야 한다 (2026-08-25)
  for (const recipe of recipeList) {
    if (recipe.output.kind === 'hourglass' && !hourglasses.has(recipe.output.hourglassId)) {
      fail(`레시피 ${recipe.id}가 없는 모래시계 참조: ${recipe.output.hourglassId}`);
    }
    for (const materialId of Object.keys(recipe.cost.materials)) {
      if (!materials.has(materialId)) fail(`레시피 ${recipe.id}가 없는 재료 참조: ${materialId}`);
    }
  }

  const artifactsByRarity = new Map<ArtifactRarity, ArtifactDef[]>();
  for (const rarity of ARTIFACT_RARITIES) artifactsByRarity.set(rarity, []);
  for (const artifact of items.artifacts) artifactsByRarity.get(artifact.rarity)!.push(artifact);

  return {
    monsters,
    monsterList,
    nativeList,
    transcendentList,
    regions,
    regionList,
    materials,
    synergies,
    events,
    recipes,
    artifacts,
    artifactsByRarity,
    sets,
    milestones,
    tasks,
    shopProducts,
    hourglasses,
    hourglassList,
    balance,
  };
}

/** 앱 전역에서 공유하는 단일 콘텐츠 인스턴스 (테스트는 loadContent()를 직접 호출해도 된다) */
export const content: Content = loadContent();

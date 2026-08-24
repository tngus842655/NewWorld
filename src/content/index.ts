/**
 * 콘텐츠 로더 — JSON을 zod로 검증하고 파생 인덱스를 만든다.
 * 참조 무결성(존재하지 않는 id 참조)은 여기서 즉시 throw — 잘못된 콘텐츠는 실행 불가.
 */
import {
  ARTIFACT_RARITIES,
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
  const regions = toMap(regionList, 'region');
  const materials = toMap(materialList, 'material');
  const recipes = toMap(recipeList, 'recipe');
  const artifacts = toMap(items.artifacts, 'artifact');
  const sets = toMap(items.sets, 'set');

  const synergies = new Map<Tribe, SynergyDef>();
  for (const [tribe, def] of Object.entries(synergiesParsed)) {
    if (def) synergies.set(tribe as Tribe, def);
  }

  // ── 참조 무결성 ──
  for (const region of regionList) {
    for (const spawn of region.spawns) {
      const m = monsters.get(spawn.monster) ?? fail(`${region.id} spawns가 없는 몬스터 참조: ${spawn.monster}`);
      if (m.habitat !== region.id) fail(`${spawn.monster}의 habitat(${m.habitat})와 출현 지역(${region.id}) 불일치`);
      if (m.rarity === 'legendary') fail(`${region.id} spawns에 전설 몬스터(${spawn.monster}) — 전설은 legendary 필드로만`);
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
    // 고유 능력은 전설 전용·전설 필수 (유물 GDD §8.2와 대칭 — 2026-08-24)
    if (monster.rarity === 'legendary' && monster.unique.length === 0) fail(`전설 몬스터 ${monster.id}에 고유 능력이 없음`);
    if (monster.rarity !== 'legendary' && monster.unique.length > 0) fail(`비전설 몬스터 ${monster.id}에 고유 능력 — 고유 능력은 전설 전용`);
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
  for (const milestone of milestones) {
    if (milestone.condition.kind === 'regionCaptured' && !regions.has(milestone.condition.region)) {
      fail(`마일스톤 ${milestone.id}가 없는 지역 참조: ${milestone.condition.region}`);
    }
  }
  for (const id of balance.starter.monsters) {
    if (!monsters.has(id)) fail(`starter가 없는 몬스터 참조: ${id}`);
  }
  for (const product of shopProducts) {
    if (product.goods.kind === 'hourglass' && !hourglasses.has(product.goods.hourglassId)) {
      fail(`상품 ${product.id}가 없는 모래시계 참조: ${product.goods.hourglassId}`);
    }
  }

  const artifactsByRarity = new Map<ArtifactRarity, ArtifactDef[]>();
  for (const rarity of ARTIFACT_RARITIES) artifactsByRarity.set(rarity, []);
  for (const artifact of items.artifacts) artifactsByRarity.get(artifact.rarity)!.push(artifact);

  return {
    monsters,
    monsterList,
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

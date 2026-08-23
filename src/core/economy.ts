/**
 * 경제 액션 — 레벨업·각성·합성·제작·강화·분해·해금. 전부 순수 함수, 실패는 GameError.
 */
import type { Content } from '../content';
import type { ArtifactRarity } from '../content/schema';
import { findArtifact, findMonster, grantArtifact } from './effects';
import { evaluateNewMilestones, rollArtifactOfRarity } from './expedition';
import { artifactEnhanceCost, monsterLevelUpCost, monsterStarUpCost } from './formulas';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, nextPartySlotUnlock, regionFlagKey } from './progression';
import { streamRng } from './rng';
import { settleTasks } from './tasks';
import { GameError, type CoreCtx, type SaveState } from './types';

function spendGold(save: SaveState, amount: number): void {
  if (save.wallet.gold < amount) throw new GameError('gold-short', `골드가 부족합니다 (필요: ${amount})`);
  save.wallet.gold -= amount;
}


/** 레벨업 — 종 단위 (카드가 몇 장이든 종당 레벨 하나, 골드 소모) */
export function levelUpMonster(content: Content, save: SaveState, monsterId: string): SaveState {
  const next = structuredClone(save);
  const monster = findMonster(next, monsterId);
  if (monster.level >= content.balance.level.max) throw new GameError('level-max', '이미 최대 레벨입니다');
  spendGold(next, monsterLevelUpCost(content, monsterId, monster.level)); // 지역·등급 차등 (2026-08-23)
  monster.level++;
  return next;
}

/** 각성 — 정수 폐기(2026-08-23), 골드 소모로 변경 */
export function awakenMonster(content: Content, save: SaveState, monsterId: string): SaveState {
  const next = structuredClone(save);
  const owned = findMonster(next, monsterId);
  if (owned.star >= content.balance.star.max) throw new GameError('star-max', '이미 최대 성급입니다');
  spendGold(next, monsterStarUpCost(content, monsterId, owned.star)); // 지역·등급 차등 (2026-08-23)
  owned.star++;
  if (owned.star >= 3) {
    const entry = next.codex[owned.monsterId];
    if (entry) entry.awakened = true;
  }
  return next;
}

// ── 카드 합성 (GDD §4.5) ─────────────────────────────────────────────────────

/** 재료: 종별 사용 장수 (합계 = balance.fusion.materials, 전부 같은 등급의 여분 카드) */
export interface FusionInput {
  materials: { monsterId: string; count: number }[];
}

export interface FusionResult {
  save: SaveState;
  success: boolean;
  materialRarity: string;
  resultMonsterId?: string; // 성공 시 획득 종
  isNew?: boolean; // 도감 신규 등록 여부
  returnedMonsterId?: string; // 실패 시 반환된 카드 1장의 종
  newMilestones: string[];
}

/**
 * 같은 등급 여분 카드 N장 → 다음 등급 랜덤 1종 도전.
 * 각 종의 마지막 1장은 재료 불가 (여분 = count - 1).
 * 실패 시 재료 중 1장은 돌려받는다 (실소모 1장 — 도전 문턱 완화).
 * 결과 풀은 해금 지역의 다음 등급 전 종 (미보유면 도감 신규 등록 + 마일스톤 평가).
 */
export function fuseMonsters(content: Content, save: SaveState, input: FusionInput, ctx: CoreCtx): FusionResult {
  const { fusion } = content.balance;
  const totalUsed = input.materials.reduce((sum, m) => sum + m.count, 0);
  if (totalUsed !== fusion.materials) {
    throw new GameError('fusion-materials', `재료 카드는 정확히 ${fusion.materials}장이어야 합니다`);
  }

  const RARITY_NEXT: Record<string, string | null> = {
    common: 'uncommon', uncommon: 'rare', rare: 'heroic', heroic: 'legendary', legendary: null,
  };
  let rarity: string | null = null;
  for (const material of input.materials) {
    if (material.count < 1) throw new GameError('fusion-materials', '재료 수량이 잘못되었습니다');
    const owned = findMonster(save, material.monsterId);
    const monster = content.monsters.get(material.monsterId);
    if (!monster) throw new GameError('monster-def-missing', `콘텐츠에 없는 몬스터: ${material.monsterId}`);
    if (owned.count - 1 < material.count) {
      throw new GameError('fusion-spare', `${monster.name}의 여분 카드가 부족합니다 (마지막 1장은 재료가 될 수 없습니다)`);
    }
    if (rarity === null) rarity = monster.rarity;
    else if (rarity !== monster.rarity) throw new GameError('fusion-rarity', '재료는 같은 등급이어야 합니다');
  }
  const nextRarity = RARITY_NEXT[rarity!];
  if (!nextRarity) throw new GameError('fusion-legendary', '전설 카드는 합성할 수 없습니다');
  const chance = fusion.chance[rarity as keyof typeof fusion.chance] ?? 0;

  const next = structuredClone(save);
  for (const material of input.materials) {
    findMonster(next, material.monsterId).count -= material.count;
  }

  next.stats.fusions += 1;
  const rng = streamRng(ctx.newSeed(), 'fusion');
  const success = rng() < chance;
  if (!success) {
    // 실패 — 재료 중 1장을 랜덤으로 돌려준다 (시드 결정론)
    const usedPool: string[] = input.materials.flatMap((m) => Array.from({ length: m.count }, () => m.monsterId));
    const returnedMonsterId = usedPool[Math.floor(rng() * usedPool.length)]!;
    findMonster(next, returnedMonsterId).count += 1;
    settleTasks(content, next);
    return { save: next, success: false, materialRarity: rarity!, returnedMonsterId, newMilestones: [] };
  }

  // 결과 풀: 해금 지역의 다음 등급 전 종 (전 지역 미해금 케이스 방어로 전체 폴백)
  let pool = content.monsterList.filter(
    (m) => m.rarity === nextRarity && isRegionUnlocked(content, next, m.habitat),
  );
  if (pool.length === 0) pool = content.monsterList.filter((m) => m.rarity === nextRarity);
  const result = pool[Math.floor(rng() * pool.length)]!;

  const owned = next.roster.find((m) => m.monsterId === result.id);
  const isNew = !owned;
  if (owned) {
    owned.count += 1;
  } else {
    next.roster.push({ monsterId: result.id, level: 1, star: 1, count: 1 });
    const entry = next.codex[result.id] ?? { seen: false, captured: false, awakened: false };
    entry.seen = true;
    if (!entry.captured) {
      entry.captured = true;
      entry.firstCapturedAt = ctx.now();
    }
    next.codex[result.id] = entry;
  }

  const newMilestones = evaluateNewMilestones(content, next);
  for (const id of newMilestones) {
    next.milestones.push(id);
    const milestone = content.milestones.find((m) => m.id === id)!;
    next.wallet.gold += milestone.reward.gold ?? 0;
    next.wallet.dust += milestone.reward.dust ?? 0;
  }
  settleTasks(content, next);

  return { save: next, success: true, materialRarity: rarity!, resultMonsterId: result.id, isNew, newMilestones };
}

// ── 유물 합성 (GDD §4.5 — 카드 합성과 완전 동일 규칙, v6 종 단위) ────────────

/** 재료: 종별 사용 개수 (합계 = balance.fusion.materials, 전부 같은 등급의 여분) */
export interface ArtifactFusionInput {
  materials: { itemId: string; count: number }[];
}

export interface ArtifactFusionResult {
  save: SaveState;
  success: boolean;
  materialRarity: string;
  resultItemId?: string; // 성공 시 획득 종
  isNew?: boolean; // 신규 종 여부
  returnedItemId?: string; // 실패 시 반환된 1개의 종
}

/**
 * 같은 등급 여분 유물 N개 → 다음 등급 유물 1종(랜덤) 도전. 확률은 카드 합성과 공유.
 * 각 종의 마지막 1개는 재료 불가 (여분 = count - 1) — 강화한 종이 합성으로 사라지는 사고 방지.
 * 실패 시 재료 중 1개는 돌려받는다.
 */
export function fuseArtifacts(content: Content, save: SaveState, input: ArtifactFusionInput, ctx: CoreCtx): ArtifactFusionResult {
  const { fusion } = content.balance;
  const totalUsed = input.materials.reduce((sum, m) => sum + m.count, 0);
  if (totalUsed !== fusion.materials) {
    throw new GameError('fusion-materials', `재료 유물은 정확히 ${fusion.materials}개여야 합니다`);
  }

  const RARITY_NEXT: Record<string, ArtifactRarity | null> = {
    common: 'uncommon', uncommon: 'rare', rare: 'heroic', heroic: 'legendary', legendary: null,
  };
  let rarity: string | null = null;
  for (const material of input.materials) {
    if (material.count < 1) throw new GameError('fusion-materials', '재료 수량이 잘못되었습니다');
    const owned = findArtifact(save, material.itemId);
    const def = content.artifacts.get(material.itemId);
    if (!def) throw new GameError('artifact-def-missing', `콘텐츠에 없는 유물: ${material.itemId}`);
    if (owned.count - 1 < material.count) {
      throw new GameError('fusion-spare', `${def.name}의 여분이 부족합니다 (마지막 1개는 재료가 될 수 없습니다)`);
    }
    if (rarity === null) rarity = def.rarity;
    else if (rarity !== def.rarity) throw new GameError('fusion-rarity', '재료는 같은 등급이어야 합니다');
  }
  const nextRarity = RARITY_NEXT[rarity!];
  if (!nextRarity) throw new GameError('fusion-legendary', '전설 유물은 합성할 수 없습니다');
  const chance = fusion.chance[rarity as keyof typeof fusion.chance] ?? 0;

  const next = structuredClone(save);
  for (const material of input.materials) {
    findArtifact(next, material.itemId).count -= material.count;
  }

  next.stats.fusions += 1;
  const rng = streamRng(ctx.newSeed(), 'fusion-artifact');
  const success = rng() < chance;
  if (!success) {
    // 실패 — 재료 중 1개를 랜덤으로 돌려준다 (시드 결정론)
    const usedPool: string[] = input.materials.flatMap((m) => Array.from({ length: m.count }, () => m.itemId));
    const returnedItemId = usedPool[Math.floor(rng() * usedPool.length)]!;
    findArtifact(next, returnedItemId).count += 1;
    settleTasks(content, next);
    return { save: next, success: false, materialRarity: rarity!, returnedItemId };
  }

  const drop = rollArtifactOfRarity(content, rng, nextRarity);
  const isNew = !next.artifacts.some((a) => a.itemId === drop.itemId);
  grantArtifact(next, drop.itemId);
  settleTasks(content, next);
  return { save: next, success: true, materialRarity: rarity!, resultItemId: drop.itemId, isNew };
}

export function craftRecipe(content: Content, save: SaveState, recipeId: string): SaveState {
  const recipe = content.recipes.get(recipeId);
  if (!recipe) throw new GameError('recipe-missing', `없는 레시피: ${recipeId}`);
  const next = structuredClone(save);
  spendGold(next, recipe.cost.gold);
  for (const [materialId, count] of Object.entries(recipe.cost.materials)) {
    const have = next.wallet.materials[materialId] ?? 0;
    if (have < count) {
      const name = content.materials.get(materialId)?.name ?? materialId;
      throw new GameError('material-short', `${name}이(가) 부족합니다 (필요: ${count})`);
    }
    next.wallet.materials[materialId] = have - count;
  }
  next.wallet.lures += recipe.output.lures;
  next.stats.crafts += 1;
  settleTasks(content, next); // 반복 과업 — 보상은 제자리 지급, 알림은 store가 tasks 변화로 감지
  return next;
}

/** 강화 — 종 단위 (개수가 몇이든 강화는 종당 하나, 몬스터 레벨과 동일하게 파견 중에도 허용) */
export function enhanceArtifact(content: Content, save: SaveState, itemId: string): SaveState {
  const next = structuredClone(save);
  const artifact = findArtifact(next, itemId);
  if (artifact.enhance >= content.balance.artifacts.enhance.max) throw new GameError('enhance-max', '이미 최대 강화입니다');
  const cost = artifactEnhanceCost(content, artifact.itemId, artifact.enhance); // 등급 차등 (2026-08-23)
  if (next.wallet.dust < cost) throw new GameError('dust-short', `가루가 부족합니다 (필요: ${cost})`);
  next.wallet.dust -= cost;
  artifact.enhance++;
  return next;
}

/** 분해 — 개수 1 차감. 마지막 개를 분해하면 종이 사라진다 (강화 투자는 환급 없음 — 2026-08-23 사용자 결정) */
export function salvageArtifact(content: Content, save: SaveState, itemId: string): SaveState {
  const next = structuredClone(save);
  const artifact = findArtifact(next, itemId);
  const def = content.artifacts.get(artifact.itemId);
  if (!def) throw new GameError('artifact-def-missing', `콘텐츠에 없는 유물: ${artifact.itemId}`);
  next.wallet.dust += content.balance.artifacts.dustPerSalvage[def.rarity];
  artifact.count -= 1;
  if (artifact.count <= 0) {
    next.artifacts = next.artifacts.filter((a) => a.itemId !== itemId);
    for (const team of next.teams) {
      team.artifactIds = team.artifactIds.filter((id) => id !== itemId); // 종 소멸 시 프리셋 정리
    }
  }
  return next;
}

export function buyPartySlot(content: Content, save: SaveState): SaveState {
  const unlock = nextPartySlotUnlock(content, save);
  if (!unlock) throw new GameError('slot-max', '파티 슬롯이 이미 최대입니다');
  const counts = capturedCounts(content, save);
  if (counts.total < unlock.totalCaptured) {
    throw new GameError('slot-locked', `도감 ${unlock.totalCaptured}종 포획이 필요합니다`);
  }
  const next = structuredClone(save);
  spendGold(next, unlock.gold);
  next.profile.partySlots = unlock.slots;
  return next;
}

export function unlockRegion(content: Content, save: SaveState, regionId: string): SaveState {
  const check = canUnlockRegion(content, save, regionId);
  if (!check.ok) throw new GameError('region-unlock', check.reason ?? '해금 조건을 채우지 못했습니다');
  const region = content.regions.get(regionId)!;
  const next = structuredClone(save);
  for (const [materialId, count] of Object.entries(region.unlock.materials ?? {})) {
    next.wallet.materials[materialId] = (next.wallet.materials[materialId] ?? 0) - count;
  }
  next.profile.flags[regionFlagKey(regionId)] = true;
  return next;
}

/** 몬스터 편성 잠금 검사 — UI에서 사용 */

/**
 * 경제 액션 — 레벨업·각성·합성·제작·강화·분해·해금. 전부 순수 함수, 실패는 GameError.
 */
import type { Content } from '../content';
import { findArtifact, findMonster } from './effects';
import { evaluateNewMilestones } from './expedition';
import { enhanceCost, levelUpCost, starUpCost } from './formulas';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, nextPartySlotUnlock, regionFlagKey } from './progression';
import { streamRng } from './rng';
import { GameError, type CoreCtx, type SaveState } from './types';

function spendGold(save: SaveState, amount: number): void {
  if (save.wallet.gold < amount) throw new GameError('gold-short', `골드가 부족합니다 (필요: ${amount})`);
  save.wallet.gold -= amount;
}

/** 원정 중인 팀이 데려간 몬스터/유물은 잠금 (GDD §8.1) */
function assertMonsterFree(save: SaveState, monsterId: string): void {
  if (save.expeditions.some((e) => !e.claimed && e.partyIds.includes(monsterId))) {
    throw new GameError('monster-busy', '원정 중인 몬스터입니다');
  }
}
function assertArtifactFree(save: SaveState, uid: string): void {
  if (save.expeditions.some((e) => !e.claimed && e.artifactUids.includes(uid))) {
    throw new GameError('artifact-busy', '원정 중인 팀이 장착한 유물입니다');
  }
}

/** 레벨업 — 종 단위 (카드가 몇 장이든 종당 레벨 하나, 골드 소모) */
export function levelUpMonster(content: Content, save: SaveState, monsterId: string): SaveState {
  const next = structuredClone(save);
  const monster = findMonster(next, monsterId);
  if (monster.level >= content.balance.level.max) throw new GameError('level-max', '이미 최대 레벨입니다');
  spendGold(next, levelUpCost(monster.level, content.balance));
  monster.level++;
  return next;
}

/** 각성 — 정수 폐기(2026-08-23), 골드 소모로 변경 */
export function awakenMonster(content: Content, save: SaveState, monsterId: string): SaveState {
  const next = structuredClone(save);
  const owned = findMonster(next, monsterId);
  if (owned.star >= content.balance.star.max) throw new GameError('star-max', '이미 최대 성급입니다');
  spendGold(next, starUpCost(owned.star, content.balance));
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
  newMilestones: string[];
}

/**
 * 같은 등급 여분 카드 N장 → 다음 등급 랜덤 1종 도전.
 * 각 종의 마지막 1장은 재료 불가 (여분 = count - 1). 실패 시 재료 소실.
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

  const rng = streamRng(ctx.newSeed(), 'fusion');
  const success = rng() < chance;
  if (!success) {
    return { save: next, success: false, materialRarity: rarity!, newMilestones: [] };
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

  return { save: next, success: true, materialRarity: rarity!, resultMonsterId: result.id, isNew, newMilestones };
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
  return next;
}

export function enhanceArtifact(content: Content, save: SaveState, uid: string): SaveState {
  const next = structuredClone(save);
  assertArtifactFree(next, uid);
  const artifact = findArtifact(next, uid);
  if (artifact.enhance >= content.balance.artifacts.enhance.max) throw new GameError('enhance-max', '이미 최대 강화입니다');
  const cost = enhanceCost(artifact.enhance, content.balance);
  if (next.wallet.dust < cost) throw new GameError('dust-short', `가루가 부족합니다 (필요: ${cost})`);
  next.wallet.dust -= cost;
  artifact.enhance++;
  return next;
}

export function salvageArtifact(content: Content, save: SaveState, uid: string): SaveState {
  const next = structuredClone(save);
  assertArtifactFree(next, uid);
  const artifact = findArtifact(next, uid);
  const def = content.artifacts.get(artifact.itemId);
  if (!def) throw new GameError('artifact-def-missing', `콘텐츠에 없는 유물: ${artifact.itemId}`);
  next.wallet.dust += content.balance.artifacts.dustPerSalvage[def.rarity];
  next.artifacts = next.artifacts.filter((a) => a.uid !== uid);
  for (const team of next.teams) {
    team.artifactUids = team.artifactUids.filter((id) => id !== uid);
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
export { assertMonsterFree, assertArtifactFree };

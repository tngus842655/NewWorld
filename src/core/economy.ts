/**
 * 경제 액션 — 레벨업·각성·제작·강화·분해·해금. 전부 순수 함수, 실패는 GameError.
 */
import type { Content } from '../content';
import { findArtifact, findMonster } from './effects';
import { enhanceCost, levelUpCost, starUpCost } from './formulas';
import { canUnlockRegion, capturedCounts, nextPartySlotUnlock, regionFlagKey } from './progression';
import { GameError, type SaveState } from './types';

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

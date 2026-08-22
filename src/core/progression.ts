/**
 * 진행·해금 판정 — 도감 집계, 지역/팀/슬롯 해금. 파생값은 저장하지 않고 여기서 계산한다.
 */
import type { Content } from '../content';
import type { SaveState } from './types';
import { GameError } from './types';

export interface CapturedCounts {
  total: number;
  byRegion: Map<string, number>;
  byTribe: Map<string, number>;
}

export function capturedCounts(content: Content, save: SaveState): CapturedCounts {
  const byRegion = new Map<string, number>();
  const byTribe = new Map<string, number>();
  let total = 0;
  for (const [monsterId, entry] of Object.entries(save.codex)) {
    if (!entry.captured) continue;
    const monster = content.monsters.get(monsterId);
    if (!monster) continue;
    total++;
    byRegion.set(monster.habitat, (byRegion.get(monster.habitat) ?? 0) + 1);
    byTribe.set(monster.tribe, (byTribe.get(monster.tribe) ?? 0) + 1);
  }
  return { total, byRegion, byTribe };
}

export function regionFlagKey(regionId: string): string {
  return `region:${regionId}`;
}

/** 첫 지역은 항상 열려 있고, 나머지는 unlockRegion으로 해금한 플래그를 본다 */
export function isRegionUnlocked(content: Content, save: SaveState, regionId: string): boolean {
  const region = content.regions.get(regionId);
  if (!region) return false;
  if (region.order === 1) return true;
  return save.profile.flags[regionFlagKey(regionId)] === true;
}

export interface UnlockCheck {
  ok: boolean;
  reason?: string;
}

/** 지역 해금 조건 검사 (해금 실행은 economy.unlockRegion — 재료를 소모한다) */
export function canUnlockRegion(content: Content, save: SaveState, regionId: string): UnlockCheck {
  const region = content.regions.get(regionId);
  if (!region) return { ok: false, reason: '없는 지역입니다' };
  if (isRegionUnlocked(content, save, regionId)) return { ok: false, reason: '이미 해금된 지역입니다' };
  const counts = capturedCounts(content, save);
  for (const [requiredRegion, count] of Object.entries(region.unlock.codexCaptured ?? {})) {
    if ((counts.byRegion.get(requiredRegion) ?? 0) < count) {
      const name = content.regions.get(requiredRegion)?.name ?? requiredRegion;
      return { ok: false, reason: `${name} 도감 ${count}종 포획이 필요합니다` };
    }
  }
  for (const [materialId, count] of Object.entries(region.unlock.materials ?? {})) {
    if ((save.wallet.materials[materialId] ?? 0) < count) {
      const name = content.materials.get(materialId)?.name ?? materialId;
      return { ok: false, reason: `${name} ${count}개가 필요합니다` };
    }
  }
  return { ok: true };
}

/** 동시 파견 가능한 팀 수 (기본 1 + balance.teams 조건 충족분) */
export function teamCount(content: Content, save: SaveState): number {
  const counts = capturedCounts(content, save);
  let teams = 1;
  for (const unlock of content.balance.teams) {
    let satisfied = true;
    if (unlock.regionUnlocked && !isRegionUnlocked(content, save, unlock.regionUnlocked)) satisfied = false;
    if (unlock.totalCaptured !== undefined && counts.total < unlock.totalCaptured) satisfied = false;
    if (satisfied) teams = Math.max(teams, unlock.count);
  }
  return teams;
}

/** 다음 파티 슬롯 해금 정보 (없으면 null) */
export function nextPartySlotUnlock(content: Content, save: SaveState): { slots: number; gold: number; totalCaptured: number } | null {
  const next = content.balance.party.slotUnlocks.find((u) => u.slots === save.profile.partySlots + 1);
  return next ?? null;
}

export function assertMonsterOwned(save: SaveState, uid: string): void {
  if (!save.roster.some((m) => m.uid === uid)) {
    throw new GameError('monster-not-found', `보유하지 않은 몬스터: ${uid}`);
  }
}

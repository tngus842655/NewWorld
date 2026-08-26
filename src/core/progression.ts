/**
 * 진행·해금 판정 — 도감 집계, 지역/팀/슬롯 해금. 파생값은 저장하지 않고 여기서 계산한다.
 */
import type { Content } from '../content';
import type { MonsterRarity, Region } from '../content/schema';
import type { SaveState } from './types';
import { GameError } from './types';

/**
 * 포획 집계의 정본. 사다리가 두 축이라 모수도 둘이다 (schema.ts MilestoneConditionSchema 참조).
 * 여기 하나만 두는 이유: 예전엔 expedition.evaluateNewMilestones가 같은 집계를 따로 돌려서,
 * 한쪽만 고치면 진행바와 실제 지급이 조용히 갈라졌다 (2026-08-25).
 */
export interface CapturedCounts {
  /** 서식종(초월 제외) 포획 종 수 — 도감 사다리·지역 해금·팀/슬롯 해금의 모수 */
  total: number;
  /** 지역별 서식종 포획 수 — 초월은 habitat이 최종 지역이어도 세지 않는다 */
  byRegion: Map<string, number>;
  /** 종족별 서식종 포획 수 */
  byTribe: Map<string, number>;
  /** 등급별 포획 수 — 여기만 초월을 포함한 전 등급을 센다 (초월 축 업적의 모수) */
  byRarity: Map<MonsterRarity, number>;
}

export function capturedCounts(content: Content, save: SaveState): CapturedCounts {
  const byRegion = new Map<string, number>();
  const byTribe = new Map<string, number>();
  const byRarity = new Map<MonsterRarity, number>();
  let total = 0;
  for (const [monsterId, entry] of Object.entries(save.codex)) {
    if (!entry.captured) continue;
    const monster = content.monsters.get(monsterId);
    if (!monster) continue;
    byRarity.set(monster.rarity, (byRarity.get(monster.rarity) ?? 0) + 1);
    // 초월은 합성 전용 — 어느 지역 출현 테이블에도 없다. 서식종 축에 넣으면 화산 서식종을
    // 51종만 채운 유저가 "잿빛 화산 완전 정복"(54)을 받는다 (2026-08-25 사용자 결정)
    if (monster.rarity === 'transcendent') continue;
    total++;
    byRegion.set(monster.habitat, (byRegion.get(monster.habitat) ?? 0) + 1);
    byTribe.set(monster.tribe, (byTribe.get(monster.tribe) ?? 0) + 1);
  }
  return { total, byRegion, byTribe, byRarity };
}

export function regionFlagKey(regionId: string): string {
  return `region:${regionId}`;
}

/** 가장 깊은(order 최대) 해금 지역 — 원정 기본 선택·도감 기본 권역의 시작점 (2026-08-27) */
export function deepestUnlockedRegion(content: Content, save: SaveState): Region {
  let last = content.regionList[0]!;
  for (const region of content.regionList) if (isRegionUnlocked(content, save, region.id)) last = region;
  return last;
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

export function assertMonsterOwned(save: SaveState, monsterId: string): void {
  if (!save.roster.some((m) => m.monsterId === monsterId)) {
    throw new GameError('monster-not-found', `보유하지 않은 몬스터: ${monsterId}`);
  }
}

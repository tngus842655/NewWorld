/**
 * 원정대(군) 프리셋 (2026-08-23, GDD §5.1 개편) — 1~4군, 지역 해금으로 확장.
 * 몬스터는 종 카드 수 기준으로 군 간 배타(카드 2장 = 두 군 편성 가능),
 * 유물은 uid 개체 단위로 한 군에만 연결된다.
 */
import type { Content } from '../content';
import { teamCount } from './progression';
import { GameError, type SaveState, type TeamLoadout } from './types';

export function teamName(index: number): string {
  return `원정대 ${index + 1}`; // 용어 확정 (2026-08-23 사용자) — ensureTeams가 로드 시 기존 세이브도 재명명
}

/** 해금된 군 수만큼 teams 배열을 보장 — 로드·지역 해금 직후 호출 */
export function ensureTeams(content: Content, save: SaveState): SaveState {
  const need = teamCount(content, save);
  if (save.teams.length >= need && save.teams.every((team, i) => team.name === teamName(i))) return save;
  const next = structuredClone(save);
  for (let i = 0; i < Math.max(need, next.teams.length); i++) {
    if (next.teams[i]) {
      next.teams[i]!.name = teamName(i);
    } else {
      next.teams.push({ id: `team-${i + 1}`, name: teamName(i), partyIds: [], artifactUids: [] });
    }
  }
  return next;
}

/** 군 프리셋들의 종별 카드 사용 수 (excludeTeamId 제외) */
export function speciesUsedByTeams(save: SaveState, excludeTeamId?: string): Map<string, number> {
  const used = new Map<string, number>();
  for (const team of save.teams) {
    if (team.id === excludeTeamId) continue;
    for (const monsterId of team.partyIds) {
      used.set(monsterId, (used.get(monsterId) ?? 0) + 1);
    }
  }
  return used;
}

/** 다른 군이 장착 중인 유물 uid 집합 (excludeTeamId 제외) */
export function artifactsUsedByTeams(save: SaveState, excludeTeamId?: string): Set<string> {
  const used = new Set<string>();
  for (const team of save.teams) {
    if (team.id === excludeTeamId) continue;
    for (const uid of team.artifactUids) used.add(uid);
  }
  return used;
}

/** 군 편성 저장 — 슬롯·중복·군 간 배타 검증 후 프리셋 갱신 */
export function setTeamLoadout(
  content: Content,
  save: SaveState,
  teamId: string,
  partyIds: string[],
  artifactUids: string[],
): SaveState {
  const team = save.teams.find((t) => t.id === teamId);
  if (!team) throw new GameError('team-missing', '없는 원정대입니다');

  if (partyIds.length > save.profile.partySlots) {
    throw new GameError('party-too-big', `파티 슬롯은 ${save.profile.partySlots}칸입니다`);
  }
  if (new Set(partyIds).size !== partyIds.length) {
    throw new GameError('party-dup', '같은 몬스터를 한 군에 두 번 편성할 수 없습니다');
  }
  const otherUse = speciesUsedByTeams(save, teamId);
  for (const monsterId of partyIds) {
    const owned = save.roster.find((m) => m.monsterId === monsterId);
    if (!owned) throw new GameError('monster-missing', '보유하지 않은 몬스터입니다');
    if ((otherUse.get(monsterId) ?? 0) + 1 > owned.count) {
      const monster = content.monsters.get(monsterId);
      throw new GameError('team-card-short', `${monster?.name ?? monsterId} 카드가 부족합니다 — 다른 군이 사용 중입니다`);
    }
  }

  if (artifactUids.length > 4) throw new GameError('artifact-too-many', '유물은 4개까지 연결할 수 있습니다');
  if (new Set(artifactUids).size !== artifactUids.length) {
    throw new GameError('artifact-dup', '같은 유물을 두 번 연결할 수 없습니다');
  }
  const otherArtifacts = artifactsUsedByTeams(save, teamId);
  const usedSlots = new Set<string>();
  for (const uid of artifactUids) {
    const owned = save.artifacts.find((a) => a.uid === uid);
    if (!owned) throw new GameError('artifact-missing', '보유하지 않은 유물입니다');
    if (otherArtifacts.has(uid)) throw new GameError('artifact-taken', '다른 군이 연결한 유물입니다');
    const def = content.artifacts.get(owned.itemId);
    if (!def) throw new GameError('artifact-def-missing', `콘텐츠에 없는 유물: ${owned.itemId}`);
    if (usedSlots.has(def.slot)) throw new GameError('artifact-slot-dup', '같은 슬롯의 유물을 두 개 연결할 수 없습니다');
    usedSlots.add(def.slot);
  }

  const next = structuredClone(save);
  const target = next.teams.find((t) => t.id === teamId)!;
  target.partyIds = [...partyIds];
  target.artifactUids = [...artifactUids];
  return next;
}

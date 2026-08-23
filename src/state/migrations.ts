/**
 * 세이브 마이그레이션 체인 (TECH.md §8) — v(n) → v(n+1) 순수 함수만 등록한다.
 * 스키마가 바뀌면 여기에 단계를 추가하고 tests/save.test.ts에 케이스를 더한다.
 */
import type { SaveState } from '../core/types';

export const CURRENT_SAVE_VERSION = 2;

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * v1 → v2 (2026-08-23): 로스터를 개체(uid)에서 종 단위로 통합, 정수 폐기.
 * - roster: 같은 monsterId 병합 — level/star는 최대값, count = 개체 수
 * - wallet.essence: 종별 정수를 카드로 환산해 count에 가산 (floor(essence / 8) — v1 레어 기준 평균)
 * - teams.partyUids / expeditions.partyUids: uid → monsterId (partyIds로 개명, 중복 제거)
 */
const migrateV1toV2: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  const oldRoster: { uid: string; monsterId: string; level: number; star: number }[] = data['roster'] ?? [];
  const uidToMonster = new Map<string, string>();
  const merged = new Map<string, { monsterId: string; level: number; star: number; count: number }>();
  for (const owned of oldRoster) {
    uidToMonster.set(owned.uid, owned.monsterId);
    const entry = merged.get(owned.monsterId);
    if (entry) {
      entry.level = Math.max(entry.level, owned.level);
      entry.star = Math.max(entry.star, owned.star);
      entry.count += 1;
    } else {
      merged.set(owned.monsterId, { monsterId: owned.monsterId, level: owned.level, star: owned.star, count: 1 });
    }
  }

  const essence: Record<string, number> = data['wallet']?.['essence'] ?? {};
  for (const [monsterId, amount] of Object.entries(essence)) {
    const entry = merged.get(monsterId);
    if (entry && amount > 0) entry.count += Math.floor(amount / 8); // 세이브에 등급이 없어 레어 기준 평균 환산
  }
  data['roster'] = [...merged.values()];
  if (data['wallet']) delete data['wallet']['essence'];

  const uidsToIds = (uids: unknown): string[] => {
    if (!Array.isArray(uids)) return [];
    const ids: string[] = [];
    for (const uid of uids) {
      const monsterId = uidToMonster.get(String(uid));
      if (monsterId && !ids.includes(monsterId)) ids.push(monsterId);
    }
    return ids;
  };
  for (const team of data['teams'] ?? []) {
    team.partyIds = uidsToIds(team.partyUids);
    delete team.partyUids;
  }
  for (const expedition of data['expeditions'] ?? []) {
    expedition.partyIds = uidsToIds(expedition.partyUids);
    delete expedition.partyUids;
  }
  return data;
};

const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1toV2,
};

export function migrateSave(raw: unknown): SaveState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  let data = raw as Record<string, unknown>;
  let version = typeof data['version'] === 'number' ? (data['version'] as number) : 0;
  if (version < 1 || version > CURRENT_SAVE_VERSION) return null;
  while (version < CURRENT_SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return null;
    data = step(data);
    version++;
    data['version'] = version;
  }
  return data as unknown as SaveState;
}

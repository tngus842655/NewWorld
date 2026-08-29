/**
 * 세이브 마이그레이션 체인 (TECH.md §8) — v(n) → v(n+1) 순수 함수만 등록한다.
 * 스키마가 바뀌면 여기에 단계를 추가하고 tests/save.test.ts에 케이스를 더한다.
 */
import { CURRENT_SAVE_VERSION, type SaveState } from '../core/types';

export { CURRENT_SAVE_VERSION };

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

/**
 * v2 → v3 (2026-08-23): 랭킹·반복 과업 기반 추가.
 * - stats: 누적 통계 0에서 시작 (과거 원정은 요약 20건뿐이라 소급하지 않는다 — 도감·유물 점수는 파생이라 무손실)
 * - tasks: 과업 수령 기록 빈 객체
 * - profile: 랭킹용 익명 신원(playerId/secret)·닉네임 — 세이브에 저장되어 내보내기로 기기 이동
 */
const migrateV2toV3: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  data['stats'] = {
    expeditions: { scout: 0, standard: 0, deep: 0 },
    wipes: { scout: 0, standard: 0, deep: 0 },
    captures: 0,
    crafts: 0,
    fusions: 0,
    bestPower: 0,
  };
  data['tasks'] = {};
  const playerId = crypto.randomUUID().replaceAll('-', '');
  data['profile'] = {
    ...data['profile'],
    playerId,
    playerSecret: crypto.randomUUID().replaceAll('-', ''),
    nickname: `개척자-${playerId.slice(0, 4)}`,
  };
  return data;
};

/** v3 → v4 (2026-08-23): 상점 — 다이아 지갑 0, 구매 기록 빈 상태 */
const migrateV3toV4: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  data['wallet'] = { ...data['wallet'], diamonds: data['wallet']?.['diamonds'] ?? 0 };
  data['shop'] = { day: '', bought: {}, once: [] };
  return data;
};

/**
 * v4 → v5 (2026-08-23): 군 프리셋 개편 — 팀 이름을 1군/2군…으로, 원정 teamId는 optional이라 그대로.
 * 해금 수만큼의 팀 생성은 로드·해금 시 ensureTeams가 보장한다 (content 의존이라 마이그레이션 밖).
 */
const migrateV4toV5: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  const teams: any[] = data['teams'] ?? [];
  teams.forEach((team, i) => {
    team.name = `원정대 ${i + 1}`;
  });
  data['teams'] = teams;
  return data;
};

/**
 * v5 → v6 (2026-08-23): 유물을 개체(uid)에서 종 단위로 통합 (몬스터 v2와 동일한 개편).
 * - artifacts: 같은 itemId 병합 — enhance는 최대값(관대한 쪽), count = 개체 수, 부옵션 폐기
 * - teams.artifactUids / expeditions.artifactUids → artifactIds (uid → itemId, 중복 제거)
 */
const migrateV5toV6: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  const oldArtifacts: { uid: string; itemId: string; enhance: number }[] = data['artifacts'] ?? [];
  const uidToItem = new Map<string, string>();
  const merged = new Map<string, { itemId: string; enhance: number; count: number }>();
  for (const owned of oldArtifacts) {
    uidToItem.set(owned.uid, owned.itemId);
    const entry = merged.get(owned.itemId);
    if (entry) {
      entry.enhance = Math.max(entry.enhance, owned.enhance);
      entry.count += 1;
    } else {
      merged.set(owned.itemId, { itemId: owned.itemId, enhance: owned.enhance, count: 1 });
    }
  }
  data['artifacts'] = [...merged.values()];

  const uidsToIds = (uids: unknown): string[] => {
    if (!Array.isArray(uids)) return [];
    const ids: string[] = [];
    for (const uid of uids) {
      const itemId = uidToItem.get(String(uid));
      if (itemId && !ids.includes(itemId)) ids.push(itemId);
    }
    return ids;
  };
  for (const team of data['teams'] ?? []) {
    team.artifactIds = uidsToIds(team.artifactUids);
    delete team.artifactUids;
  }
  for (const expedition of data['expeditions'] ?? []) {
    expedition.artifactIds = uidsToIds(expedition.artifactUids);
    delete expedition.artifactUids;
  }
  return data;
};

/** v6 → v7 (2026-08-23): 유물 도감(획득 이력) — 현재 보유 종을 획득 이력으로 시드 */
const migrateV6toV7: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  const artifactCodex: Record<string, { obtained: boolean }> = {};
  for (const owned of data['artifacts'] ?? []) {
    if (owned?.itemId) artifactCodex[owned.itemId] = { obtained: true };
  }
  data['artifactCodex'] = artifactCodex;
  return data;
};

/** v7 → v8 (2026-08-23): 월간 출석 — 빈 상태로 시작 (첫 출석 시 이번 달로 초기화) */
const migrateV7toV8: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, unknown>;
  data['attendance'] = { month: '', days: [] };
  return data;
};

/** v8 → v9 (2026-08-23): 원정 가속 모래시계 — 빈 인벤토리로 시작 */
const migrateV8toV9: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  data['wallet'] = { ...data['wallet'], hourglasses: {} };
  return data;
};

/** v9 → v10 (2026-08-29): 탐사(extended, 4h) 통계 키 + 전설의 흔적 저장소 */
const migrateV9toV10: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  data['stats'] = {
    ...data['stats'],
    expeditions: { extended: 0, ...data['stats']?.['expeditions'] },
    wipes: { extended: 0, ...data['stats']?.['wipes'] },
  };
  data['legendTraces'] = [];
  return data;
};

/** v10 → v11 (2026-08-29): 광고 보상 버프 저장소 (GDD §9.2 — 야생의 향기 만료 시각) */
const migrateV10toV11: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  data['buffs'] = { scentUntil: 0 };
  return data;
};

/**
 * v11 → v12 (2026-08-29): 다이아 단가 개편 (1💎=10원, GDD §9.1-2 노트) —
 * 가격·출석 보상이 ×5 되므로 보유 다이아도 ×5 해 구매력을 보존한다.
 */
const migrateV11toV12: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  data['wallet'] = { ...data['wallet'], diamonds: (data['wallet']?.['diamonds'] ?? 0) * 5 };
  return data;
};

/**
 * v12 → v13 (2026-08-30): 야간 알림 토글 (검토 목록 ③) — 미사용 settings.push를
 * nightAlarms(켬 = 21~08시에도 귀환 알림)로 대체. 기본 끔 = 야간 무음.
 */
const migrateV12toV13: Migration = (raw) => {
  const data = structuredClone(raw) as Record<string, any>;
  const settings = { ...data['settings'] };
  delete settings['push'];
  data['settings'] = { ...settings, nightAlarms: false };
  return data;
};

const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
  6: migrateV6toV7,
  7: migrateV7toV8,
  8: migrateV8toV9,
  9: migrateV9toV10,
  10: migrateV10toV11,
  11: migrateV11toV12,
  12: migrateV12toV13,
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

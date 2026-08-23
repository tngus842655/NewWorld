import { describe, expect, it } from 'vitest';
import { migrateSave } from '../src/state/migrations';

/** v1 세이브 최소 샘플 — 개체(uid) 로스터 + 정수 지갑 (2026-08-23 이전 구조) */
function v1Save() {
  return {
    version: 1,
    profile: { createdAt: 0, tutorialDone: true, partySlots: 3, flags: {} },
    wallet: {
      gold: 500,
      dust: 10,
      lures: 1,
      materials: { 'salt-bloom': 2 },
      essence: { 'dune-pup': 17, 'bubble-crab': 5 },
    },
    roster: [
      { uid: 'u1', monsterId: 'dune-pup', level: 5, star: 2 },
      { uid: 'u2', monsterId: 'dune-pup', level: 3, star: 1 },
      { uid: 'u3', monsterId: 'dune-pup', level: 1, star: 1 },
      { uid: 'u4', monsterId: 'bubble-crab', level: 2, star: 1 },
    ],
    artifacts: [],
    teams: [{ id: 't1', name: '1번', partyUids: ['u1', 'u2', 'u4'], artifactUids: [] }],
    codex: {
      'dune-pup': { seen: true, captured: true, awakened: false },
      'bubble-crab': { seen: true, captured: true, awakened: false },
    },
    milestones: [],
    expeditions: [
      {
        id: 'e1', regionId: 'misty-coast', tier: 'scout', partyUids: ['u1', 'u4'], artifactUids: [],
        seed: 's', startedAt: 0, endsAt: 1, luresLoaded: 0, choices: [], claimed: false,
      },
    ],
    journalArchive: [],
    counters: { day: '', adUsed: {} },
    settings: { sound: true, push: false },
    lastSavedAt: 0,
  };
}

describe('세이브 마이그레이션 v1 → v2 (종 단위 통합·정수 폐기)', () => {
  it('같은 종을 병합한다 — level/star는 최대값, count는 개체 수 + 정수 환산', () => {
    const migrated = migrateSave(v1Save())!;
    expect(migrated.version).toBe(4); // v1 → … → v4 체인 끝까지

    const pup = migrated.roster.find((m) => m.monsterId === 'dune-pup')!;
    expect(pup.level).toBe(5);
    expect(pup.star).toBe(2);
    expect(pup.count).toBe(3 + Math.floor(17 / 8)); // 개체 3 + 정수 17 환산

    const crab = migrated.roster.find((m) => m.monsterId === 'bubble-crab')!;
    expect(crab.count).toBe(1 + 0); // 정수 5는 환산 미달

    expect((migrated.wallet as Record<string, unknown>)['essence']).toBeUndefined();
  });

  it('팀·진행 중 원정의 uid 참조를 monsterId로 바꾼다 (중복 제거)', () => {
    const migrated = migrateSave(v1Save())!;
    expect(migrated.teams[0]!.partyIds).toEqual(['dune-pup', 'bubble-crab']); // u1·u2 → dune-pup 하나로
    expect(migrated.expeditions[0]!.partyIds).toEqual(['dune-pup', 'bubble-crab']);
    expect((migrated.teams[0] as unknown as Record<string, unknown>)['partyUids']).toBeUndefined();
  });

  it('최신 세이브는 그대로 통과, 미지 버전은 null', () => {
    const migrated = migrateSave(v1Save())!;
    expect(migrateSave(structuredClone(migrated))).toEqual(migrated);
    expect(migrateSave({ version: 99 })).toBeNull();
    expect(migrateSave({ version: 0 })).toBeNull();
  });
});

describe('세이브 마이그레이션 v2 → v3 (누적 통계·과업·랭킹 신원)', () => {
  it('stats·tasks 기본값과 익명 신원을 만든다', () => {
    const migrated = migrateSave(v1Save())!;
    expect(migrated.stats).toEqual({
      expeditions: { scout: 0, standard: 0, deep: 0 },
      wipes: { scout: 0, standard: 0, deep: 0 },
      captures: 0,
      crafts: 0,
      fusions: 0,
      bestPower: 0,
    });
    expect(migrated.tasks).toEqual({});
    expect(migrated.profile.playerId).toMatch(/^[0-9a-f]{32}$/);
    expect(migrated.profile.playerSecret).toMatch(/^[0-9a-f]{32}$/);
    expect(migrated.profile.nickname).toBe(`개척자-${migrated.profile.playerId.slice(0, 4)}`);
    // 기존 진행은 손대지 않는다
    expect(migrated.wallet.gold).toBe(500);
    expect(migrated.roster).toHaveLength(2);
  });
});

describe('세이브 마이그레이션 v3 → v4 (상점)', () => {
  it('다이아 지갑 0·상점 구매 기록 빈 상태로 시작', () => {
    const migrated = migrateSave(v1Save())!;
    expect(migrated.wallet.diamonds).toBe(0);
    expect(migrated.shop).toEqual({ day: '', bought: {}, once: [] });
  });
});

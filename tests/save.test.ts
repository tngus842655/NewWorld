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
    expect(migrated.version).toBe(2);

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

  it('v2 세이브는 그대로 통과, 미지 버전은 null', () => {
    const migrated = migrateSave(v1Save())!;
    expect(migrateSave(structuredClone(migrated))).toEqual(migrated);
    expect(migrateSave({ version: 99 })).toBeNull();
    expect(migrateSave({ version: 0 })).toBeNull();
  });
});

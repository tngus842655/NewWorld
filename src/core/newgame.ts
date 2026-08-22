/**
 * 새 게임 초기 상태 — starter 구성은 balance.json에서.
 */
import type { Content } from '../content';
import type { CoreCtx, SaveState } from './types';

export function createInitialSave(content: Content, ctx: CoreCtx): SaveState {
  const now = ctx.now();
  const starters = content.balance.starter.monsters.map((monsterId) => ({
    uid: ctx.newUid(),
    monsterId,
    level: 1,
    star: 1,
  }));

  const codex: SaveState['codex'] = {};
  for (const starter of starters) {
    codex[starter.monsterId] = { seen: true, captured: true, awakened: false, firstCapturedAt: now };
  }

  return {
    version: 1,
    profile: {
      createdAt: now,
      tutorialDone: false,
      partySlots: content.balance.party.baseSlots,
      flags: {},
    },
    wallet: {
      gold: content.balance.starter.gold,
      dust: 0,
      lures: content.balance.starter.lures,
      materials: {},
      essence: {},
    },
    roster: starters,
    artifacts: [],
    teams: [
      {
        id: 'team-1',
        name: '1번 원정대',
        partyUids: starters.map((s) => s.uid),
        artifactUids: [],
      },
    ],
    codex,
    milestones: [],
    expeditions: [],
    journalArchive: [],
    counters: { day: '', adUsed: {} },
    settings: { sound: true, push: false },
    lastSavedAt: now,
  };
}

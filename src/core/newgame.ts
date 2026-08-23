/**
 * 새 게임 초기 상태 — starter 구성은 balance.json에서.
 */
import type { Content } from '../content';
import type { CoreCtx, LifetimeStats, SaveState } from './types';

export function emptyStats(): LifetimeStats {
  return {
    expeditions: { scout: 0, standard: 0, deep: 0 },
    wipes: { scout: 0, standard: 0, deep: 0 },
    captures: 0,
    crafts: 0,
    fusions: 0,
    bestPower: 0,
  };
}

export function createInitialSave(content: Content, ctx: CoreCtx): SaveState {
  const now = ctx.now();
  const starters = content.balance.starter.monsters.map((monsterId) => ({
    monsterId,
    level: 1,
    star: 1,
    count: 1,
  }));

  const codex: SaveState['codex'] = {};
  for (const starter of starters) {
    codex[starter.monsterId] = { seen: true, captured: true, awakened: false, firstCapturedAt: now };
  }

  const playerId = ctx.newUid() + ctx.newUid(); // 랭킹용 익명 신원 (추후 구글 로그인 연동 전까지)
  return {
    version: 6,
    profile: {
      createdAt: now,
      tutorialDone: false,
      partySlots: content.balance.party.baseSlots,
      flags: {},
      playerId,
      playerSecret: ctx.newUid() + ctx.newUid() + ctx.newUid(),
      nickname: `개척자-${playerId.slice(0, 4)}`,
    },
    wallet: {
      gold: content.balance.starter.gold,
      dust: 0,
      diamonds: 0,
      lures: content.balance.starter.lures,
      materials: {},
    },
    roster: starters,
    artifacts: [],
    teams: [
      {
        id: 'team-1',
        name: '1군',
        partyIds: starters.map((s) => s.monsterId),
        artifactIds: [],
      },
    ],
    codex,
    milestones: [],
    stats: emptyStats(),
    tasks: {},
    shop: { day: '', bought: {}, once: [] },
    expeditions: [],
    journalArchive: [],
    counters: { day: '', adUsed: {} },
    settings: { sound: true, push: false },
    lastSavedAt: now,
  };
}

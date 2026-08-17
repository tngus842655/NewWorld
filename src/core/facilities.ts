import type { ActionResult } from './actions';
import type { BuildingDef, GameState, Resources } from './types';
import { equipTotals } from './equipment';
import { grantXp, statTotal } from './heroes';

/**
 * 투기장 · 연맹 지부.
 *
 * 둘 다 원래는 **다른 플레이어**가 있어야 성립하는 시설이다. 지금은 서버도
 * 상대도 없으므로, 싱글에서 성립하는 형태로 대신 채웠다:
 *
 *   투기장   — NPC 지휘관과 1:1 랭크전. 이기면 순위가 오르고 보상을 받는다.
 *              병력은 걸지 않아 지휘관만으로 성장할 창구가 된다.
 *   연맹 지부 — 연맹 보급. 일정 시간마다 자원을 받아 간다.
 *
 * 진짜 연맹·PvP가 들어오면 이 파일이 그 자리로 교체된다. 수치는 전부 estimate.
 */

export const ARENA_ID = 'arena';
export const GUILD_HALL_ID = 'guild-hall';

/** 도전 사이의 대기 시간 */
export const ARENA_COOLDOWN_SECONDS = 3600;
/** 연맹 보급을 받을 수 있는 주기 */
export const GUILD_CLAIM_SECONDS = 21600;

/** 투기장 순위 상한 — 건물 레벨당 5위까지 */
export function arenaMaxRank(level: number): number {
  return level * 5;
}

/** 지휘관 한 명의 대전 전력 — 속성 합 + 장비 */
export function duelPower(hero: GameState['heroes'][number]): number {
  const t = equipTotals(hero);
  return statTotal(hero.stats) * 3 + hero.level * 5 + t.patk + t.matk + t.pdef + t.mdef;
}

/** 그 순위의 상대가 가진 전력 (estimate) */
export function opponentPower(rank: number): number {
  return Math.round(60 * Math.pow(1.12, rank));
}

/** 순위를 올렸을 때 받는 보상 */
export function arenaReward(rank: number, level: number): { gold: number; xp: number } {
  return {
    gold: Math.round(300 * rank * (1 + level * 0.2)),
    xp: Math.round(40 * rank),
  };
}

/**
 * 투기장 1:1 도전. 이기면 순위가 한 칸 오르고 보상을 받는다.
 * 병력은 걸지 않으므로 져도 잃는 것은 시간뿐이다.
 */
export function challengeArena(
  state: GameState,
  heroId: string,
  now: number,
): ActionResult & { won?: boolean } {
  const level = state.buildings.find((b) => b.defId === ARENA_ID)?.level ?? 0;
  if (level < 1) return { ok: false, reason: '투기장을 먼저 지어야 합니다.' };

  const hero = state.heroes.find((h) => h.id === heroId);
  if (!hero) return { ok: false, reason: '지휘관을 먼저 영입해야 합니다.' };

  state.arena ??= { rank: 0, nextAt: 0 };
  if (now < state.arena.nextAt) {
    const wait = Math.ceil((state.arena.nextAt - now) / 1000);
    return { ok: false, reason: `다음 도전까지 ${wait}초 남았습니다.` };
  }

  const max = arenaMaxRank(level);
  if (state.arena.rank >= max) {
    return { ok: false, reason: `투기장 Lv.${level}의 순위 상한(${max}위)에 도달했습니다.` };
  }

  const nextRank = state.arena.rank + 1;
  const mine = duelPower(hero);
  const theirs = opponentPower(nextRank);
  // 전력 비율로 승률을 잡되 양쪽 다 뒤집힐 여지를 남긴다
  const winChance = Math.min(0.95, Math.max(0.05, mine / (mine + theirs)));
  const won = Math.random() < winChance;

  state.arena.nextAt = now + ARENA_COOLDOWN_SECONDS * 1000;
  if (!won) return { ok: true, won: false };

  state.arena.rank = nextRank;
  const reward = arenaReward(nextRank, level);
  state.resources.gold += reward.gold;
  grantXp(hero, reward.xp);
  return { ok: true, won: true };
}

/** 이번 주기에 받을 연맹 보급량 */
export function guildStipend(level: number): Partial<Resources> {
  const k = level * 1500;
  return { wood: k, stone: k, food: k, crystal: Math.round(k * 0.25), gold: Math.round(k * 0.6) };
}

/** 연맹 보급 수령. 주기마다 한 번씩 받아 간다. */
export function claimGuildStipend(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  now: number,
): ActionResult {
  void buildingDefs;
  const level = state.buildings.find((b) => b.defId === GUILD_HALL_ID)?.level ?? 0;
  if (level < 1) return { ok: false, reason: '연맹 지부를 먼저 지어야 합니다.' };

  state.guild ??= { claimedAt: 0 };
  const readyAt = state.guild.claimedAt + GUILD_CLAIM_SECONDS * 1000;
  if (now < readyAt) {
    return { ok: false, reason: `다음 보급까지 ${Math.ceil((readyAt - now) / 1000)}초 남았습니다.` };
  }

  for (const [k, v] of Object.entries(guildStipend(level)) as [keyof Resources, number][]) {
    state.resources[k] += v;
  }
  state.guild.claimedAt = now;
  return { ok: true };
}

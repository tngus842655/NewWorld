/**
 * 테스트 헬퍼 — 결정론 ctx와 세이브 빌더.
 */
import { loadContent, type Content } from '../src/content';
import { createInitialSave } from '../src/core/newgame';
import { regionFlagKey } from '../src/core/progression';
import type { CoreCtx, SaveState } from '../src/core/types';

export const content: Content = loadContent();

export const T0 = 1_760_000_000_000; // 고정 기준 시각

export interface TestClock {
  ctx: CoreCtx;
  advance: (ms: number) => void;
  set: (t: number) => void;
}

export function makeCtx(start = T0): TestClock {
  let now = start;
  let seedNo = 0;
  let uidNo = 0;
  return {
    ctx: {
      now: () => now,
      newSeed: () => `seed-${++seedNo}`,
      newUid: () => `uid-${++uidNo}`,
    },
    advance: (ms) => {
      now += ms;
    },
    set: (t) => {
      now = t;
    },
  };
}

export interface PartySpec {
  id: string;
  level?: number;
  star?: number;
}

export interface SaveOpts {
  artifacts?: string[]; // itemId 목록 — uid는 itemId와 동일하게 부여
  partySlots?: number;
  unlockAll?: boolean;
  gold?: number;
  lures?: number;
  dust?: number;
}

/** 지정 파티로 구성된 테스트 세이브. 파티 몬스터는 도감에 포획 상태로 들어간다. (종 단위 — 2026-08-23) */
export function saveWithParty(clock: TestClock, party: PartySpec[], opts: SaveOpts = {}): { save: SaveState; partyIds: string[]; artifactUids: string[] } {
  const save = createInitialSave(content, clock.ctx);
  save.roster = [];
  save.codex = {};
  save.teams = [];

  const partyIds: string[] = [];
  for (const spec of party) {
    if (!content.monsters.has(spec.id)) throw new Error(`테스트 파티에 없는 몬스터: ${spec.id}`);
    save.roster.push({ monsterId: spec.id, level: spec.level ?? 1, star: spec.star ?? 1, count: 1 });
    save.codex[spec.id] = { seen: true, captured: true, awakened: false, firstCapturedAt: T0 };
    partyIds.push(spec.id);
  }

  const artifactUids: string[] = [];
  for (const itemId of opts.artifacts ?? []) {
    if (!content.artifacts.has(itemId)) throw new Error(`테스트에 없는 유물: ${itemId}`);
    save.artifacts.push({ uid: itemId, itemId, enhance: 0, substats: [] });
    artifactUids.push(itemId);
  }

  save.profile.partySlots = opts.partySlots ?? Math.max(3, party.length);
  if (opts.unlockAll) {
    for (const region of content.regionList) save.profile.flags[regionFlagKey(region.id)] = true;
  }
  save.wallet.gold = opts.gold ?? save.wallet.gold;
  save.wallet.lures = opts.lures ?? save.wallet.lures;
  save.wallet.dust = opts.dust ?? save.wallet.dust;
  return { save, partyIds, artifactUids };
}

import type { ActiveExpedition, CrossroadChoice } from '../src/core/types';
import type { Tier } from '../src/content/schema';

/** 시드를 직접 지정한 파견 객체 (resolveExpedition 테스트용) */
export function makeExpedition(
  regionId: string,
  tier: Tier,
  partyIds: string[],
  artifactUids: string[],
  seed: string,
  opts: { choices?: (CrossroadChoice | null)[]; luresLoaded?: number } = {},
): ActiveExpedition {
  const tierDef = content.balance.tiers[tier];
  return {
    id: `exp:${seed}`,
    regionId,
    tier,
    partyIds,
    artifactUids,
    seed,
    startedAt: T0,
    endsAt: T0 + tierDef.minutes * 60_000,
    luresLoaded: opts.luresLoaded ?? 0,
    choices: opts.choices ?? Array.from({ length: tierDef.crossroads }, () => null),
    claimed: false,
  };
}

/** 조건을 만족하는 시드를 결정론적으로 탐색 (테스트 전용) */
export function findSeed(predicate: (seed: string) => boolean, max = 800): string {
  for (let i = 0; i < max; i++) {
    const seed = `s${i}`;
    if (predicate(seed)) return seed;
  }
  throw new Error(`findSeed: ${max}회 안에 조건을 만족하는 시드를 찾지 못함`);
}

/**
 * 전설의 흔적 + 탐사(4h) 티어 (GDD §5.1, 2026-08-29)
 * 흔적: 정찰 완주 적립 → deep 파견 시 소모 → 전설 조우율 가산 (파견 시점 확정).
 */
import { describe, expect, it } from 'vitest';
import {
  claimExpedition,
  createExpedition,
  legendTraceBonus,
  resolveExpedition,
  validLegendTraces,
} from '../src/core/expedition';
import { migrateSave } from '../src/state/migrations';
import { T0, content, findSeed, makeCtx, makeExpedition, saveWithParty } from './helpers';

const cfg = content.balance.legendTraces;
const HOUR = 3_600_000;

describe('전설의 흔적 — 적립 (정찰 완주)', () => {
  it('완주한 정찰이 흔적을 남기고 정산이 귀환 시각으로 적립한다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 10 }]);
    const seed = findSeed((s) => {
      const journal = resolveExpedition(content, save, makeExpedition('misty-coast', 'scout', partyIds, [], s));
      return journal.legendTrace === true && !journal.wiped;
    });
    const expedition = makeExpedition('misty-coast', 'scout', partyIds, [], seed);
    save.expeditions.push(expedition);
    clock.set(expedition.endsAt);
    const result = claimExpedition(content, save, expedition.id, clock.ctx);
    expect(result.journal.legendTrace).toBe(true);
    expect(result.save.legendTraces).toEqual([expedition.endsAt]);
  });

  it('흔적이 안 나온 정찰은 아무것도 적립하지 않는다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 10 }]);
    const seed = findSeed((s) => {
      const journal = resolveExpedition(content, save, makeExpedition('misty-coast', 'scout', partyIds, [], s));
      return journal.legendTrace === undefined && !journal.wiped;
    });
    const expedition = makeExpedition('misty-coast', 'scout', partyIds, [], seed);
    save.expeditions.push(expedition);
    clock.set(expedition.endsAt);
    expect(claimExpedition(content, save, expedition.id, clock.ctx).save.legendTraces).toEqual([]);
  });

  it('조사·탐사에서도 흔적이 나온다 (2026-08-29 사용자 — 전설 없는 파견 전부)', () => {
    const clock = makeCtx();
    // 조우 8~12회를 완주해야 하므로 강한 파티 (흔적은 완주 조건 — 전멸이면 안 나온다)
    const { save, partyIds } = saveWithParty(clock, [
      { id: 'dune-pup', level: 30, star: 3 },
      { id: 'bubble-crab', level: 30, star: 3 },
    ]);
    for (const tier of ['standard', 'extended'] as const) {
      const seed = findSeed((s) => {
        const journal = resolveExpedition(content, save, makeExpedition('misty-coast', tier, partyIds, [], s));
        return journal.legendTrace === true && !journal.wiped;
      });
      expect(seed).toBeTruthy();
    }
  });

  it('전설을 직접 만나는 원정(deep)에서는 흔적이 나오지 않는다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 10 }]);
    expect(content.balance.legendTraces.dropChance.deep).toBe(0);
    for (let i = 0; i < 60; i++) {
      const journal = resolveExpedition(content, save, makeExpedition('misty-coast', 'deep', partyIds, [], `t${i}`));
      expect(journal.legendTrace).toBeUndefined();
    }
  });
});

describe('전설의 흔적 — 소모 (deep 파견)', () => {
  it('deep 파견이 유효 흔적을 전량 소모하고 가산을 확정한다 (만료분 제외)', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 10 }]);
    save.legendTraces = [T0 - 1 * HOUR, T0 - 2 * HOUR, T0 - (cfg.ttlHours + 1) * HOUR]; // 유효 2 + 만료 1
    expect(validLegendTraces(content, save, T0)).toBe(2);
    expect(legendTraceBonus(content, save, T0)).toBeCloseTo(2 * cfg.bonusPerTrace);

    const { save: next, expedition } = createExpedition(
      content, save, { regionId: 'misty-coast', tier: 'deep', partyIds: [...partyIds], artifactIds: [] }, clock.ctx,
    );
    expect(expedition.legendBonus).toBeCloseTo(2 * cfg.bonusPerTrace);
    expect(next.legendTraces).toEqual([]);
  });

  it('가산은 maxStacks에서 멈춘다 — 초과분은 버려진다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup', level: 10 }]);
    save.legendTraces = Array.from({ length: cfg.maxStacks + 3 }, (_, i) => T0 - (i + 1) * HOUR);
    expect(legendTraceBonus(content, save, T0)).toBeCloseTo(cfg.maxStacks * cfg.bonusPerTrace);
  });

  it('deep이 아닌 파견은 흔적을 소모하지 않는다 (만료 청소만)', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 10 }]);
    const fresh = T0 - 1 * HOUR;
    save.legendTraces = [fresh, T0 - (cfg.ttlHours + 1) * HOUR];
    const { save: next, expedition } = createExpedition(
      content, save, { regionId: 'misty-coast', tier: 'scout', partyIds: [...partyIds], artifactIds: [] }, clock.ctx,
    );
    expect(expedition.legendBonus).toBeUndefined();
    expect(next.legendTraces).toEqual([fresh]);
  });

  it('가산이 전설 조우 확률에 실제로 더해진다 — 같은 시드에서 가산 유무로 전설 조우가 갈린다', () => {
    const clock = makeCtx();
    // 전설 슬롯은 계획 중앙 — 전멸로 못 미치면 검증이 안 되므로 강한 파티로
    const { save, partyIds } = saveWithParty(clock, [
      { id: 'dune-pup', level: 30, star: 3 },
      { id: 'bubble-crab', level: 30, star: 3 },
    ]);
    const sawLegend = (seed: string, legendBonus?: number) => {
      const base = makeExpedition('misty-coast', 'deep', partyIds, [], seed);
      const journal = resolveExpedition(content, save, { ...base, ...(legendBonus ? { legendBonus } : {}) });
      return journal.totals.seenMonsterIds.some((id) => content.monsters.get(id)?.rarity === 'legendary');
    };
    // 확정 가산(+100%)이면 전설을 만나고, 같은 시드에서 가산이 없으면 못 만난다
    const seed = findSeed((s) => sawLegend(s, 1) && !sawLegend(s));
    expect(sawLegend(seed, 1)).toBe(true);
    expect(sawLegend(seed)).toBe(false);
  });
});

describe('탐사(extended, 4h) 티어', () => {
  it('파견 소요 4시간, 정산이 extended 통계 키에 쌓인다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 10 }]);
    const { save: next, expedition } = createExpedition(
      content, save, { regionId: 'misty-coast', tier: 'extended', partyIds: [...partyIds], artifactIds: [] }, clock.ctx,
    );
    expect(expedition.endsAt - expedition.startedAt).toBe(240 * 60_000);
    clock.set(expedition.endsAt);
    const result = claimExpedition(content, next, expedition.id, clock.ctx);
    expect(result.save.stats.expeditions.extended).toBe(1);
  });
});

describe('세이브 마이그레이션 v9 → v10', () => {
  it('기존 통계를 보존하며 extended 키와 흔적 저장소를 추가한다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const raw = structuredClone(save) as unknown as Record<string, any>;
    raw['version'] = 9;
    delete raw['legendTraces'];
    raw['stats']['expeditions'] = { scout: 7, standard: 1, deep: 2 };
    raw['stats']['wipes'] = { scout: 1, standard: 0, deep: 0 };

    const migrated = migrateSave(raw)!;
    expect(migrated.version).toBe(12); // v10 뒤에 v12(다이아 ×5)까지 이어진다
    expect(migrated.stats.expeditions).toEqual({ scout: 7, standard: 1, extended: 0, deep: 2 });
    expect(migrated.stats.wipes).toEqual({ scout: 1, standard: 0, extended: 0, deep: 0 });
    expect(migrated.legendTraces).toEqual([]);
  });
});

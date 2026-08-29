/**
 * 광고 보상 (GDD §9.2) — 코어 순수 로직만 검증한다.
 * 광고 시청·플러그인(platform/ads.ts)은 네이티브 전용이라 실기기에서 확인.
 */
import { describe, expect, it } from 'vitest';
import { adInstantReturn, adUsesLeft, applyScentBuff, doubleJournalRewards, markAdUse } from '../src/core/ads';
import { claimExpedition, createExpedition, resolveExpedition } from '../src/core/expedition';
import { buyShopProduct, grantShopAdExtra, hasAdFree } from '../src/core/shop';
import { GameError } from '../src/core/types';
import { T0, content, findSeed, makeCtx, makeExpedition, saveWithParty } from './helpers';

const HOUR = 3_600_000;

describe('일일 한도 (counters.adUsed — 로컬 자정 리셋)', () => {
  it('한도만큼 쓰고 나면 GameError, 날짜가 바뀌면 리셋', () => {
    const clock = makeCtx();
    let { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const limit = content.balance.ads.daily['scentBuff']!;
    for (let i = 0; i < limit; i++) {
      expect(adUsesLeft(content, save, 'scentBuff', T0)).toBe(limit - i);
      save = markAdUse(content, save, 'scentBuff', T0);
    }
    expect(adUsesLeft(content, save, 'scentBuff', T0)).toBe(0);
    expect(() => markAdUse(content, save, 'scentBuff', T0)).toThrow(GameError);

    const nextDay = T0 + 24 * HOUR;
    expect(adUsesLeft(content, save, 'scentBuff', nextDay)).toBe(limit);
    expect(() => markAdUse(content, save, 'scentBuff', nextDay)).not.toThrow();
  });

  it('슬롯별 카운터는 독립이다', () => {
    const clock = makeCtx();
    let { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    save = markAdUse(content, save, 'instantReturn', T0);
    expect(adUsesLeft(content, save, 'instantReturn', T0)).toBe(content.balance.ads.daily['instantReturn']! - 1);
    expect(adUsesLeft(content, save, 'scentBuff', T0)).toBe(content.balance.ads.daily['scentBuff']!);
  });
});

describe('야생의 향기 — 버프 중 출발 스냅샷', () => {
  it('버프가 살아있을 때 출발한 원정에만 scent가 찍힌다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const buffed = applyScentBuff(content, save, T0);
    expect(buffed.buffs.scentUntil).toBe(T0 + content.balance.ads.scentMinutes * 60_000);

    const during = createExpedition(content, buffed, { regionId: 'misty-coast', tier: 'scout', partyIds: [...partyIds], artifactIds: [] }, clock.ctx);
    expect(during.expedition.scent).toBe(true);

    clock.set(T0 + content.balance.ads.scentMinutes * 60_000 + 1); // 버프 만료 후
    const after = createExpedition(content, buffed, { regionId: 'misty-coast', tier: 'scout', partyIds: [...partyIds], artifactIds: [] }, clock.ctx);
    expect(after.expedition.scent).toBeUndefined();
  });

  it('scent 스냅샷이 포획 결과를 실제로 바꾼다 (같은 시드에서 유무로 갈리는 시드 존재) + 재정산 결정론', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 20 }]);
    const journalOf = (seed: string, scent: boolean) => resolveExpedition(content, save, {
      ...makeExpedition('misty-coast', 'scout', partyIds, [], seed),
      ...(scent ? { scent: true } : {}),
    });
    const seed = findSeed((s) => JSON.stringify(journalOf(s, true)) !== JSON.stringify(journalOf(s, false)));
    expect(seed).toBeTruthy();
    // 같은 스냅샷이면 언제 다시 정산해도 같은 일지 (미리보기=정산)
    expect(journalOf(seed, true)).toEqual(journalOf(seed, true));
  });
});

describe('광고 즉시 귀환', () => {
  it('남은 시간을 전부 당기고 카운터를 올린다 — 이미 돌아온 원정은 거절', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const { save: dispatched, expedition } = createExpedition(
      content, save, { regionId: 'misty-coast', tier: 'deep', partyIds: [...partyIds], artifactIds: [] }, clock.ctx,
    );
    const returned = adInstantReturn(content, dispatched, expedition.id, T0 + HOUR);
    expect(returned.expeditions.find((e) => e.id === expedition.id)!.endsAt).toBe(T0 + HOUR);
    expect(returned.counters.adUsed['instantReturn']).toBe(1);
    expect(() => adInstantReturn(content, returned, expedition.id, T0 + HOUR + 1)).toThrow(GameError);
  });
});

describe('일지 정산 2배 (원정당 1회 — 골드·재료만)', () => {
  it('받은 재화만큼 한 번 더 지급하고, 두 번째는 거절한다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup', level: 20 }], { gold: 0 });
    const seed = findSeed((s) => {
      const journal = resolveExpedition(content, save, makeExpedition('misty-coast', 'scout', partyIds, [], s));
      return journal.totals.gold > 0;
    });
    const expedition = makeExpedition('misty-coast', 'scout', partyIds, [], seed);
    save.expeditions.push(expedition);
    clock.set(expedition.endsAt);
    const claimed = claimExpedition(content, save, expedition.id, clock.ctx);
    const archived = claimed.save.journalArchive[0]!;
    const goldAfterClaim = claimed.save.wallet.gold;

    const doubled = doubleJournalRewards(claimed.save, expedition.id);
    expect(doubled.gold).toBe(archived.journal!.totals.gold);
    expect(doubled.save.wallet.gold).toBe(goldAfterClaim + archived.journal!.totals.gold);
    for (const [materialId, count] of Object.entries(archived.journal!.totals.materials)) {
      expect(doubled.save.wallet.materials[materialId]).toBe(
        (claimed.save.wallet.materials[materialId] ?? 0) + count,
      );
    }
    expect(doubled.save.journalArchive[0]!.doubled).toBe(true);
    expect(() => doubleJournalRewards(doubled.save, expedition.id)).toThrow(GameError);
  });
});

describe('상점 광고 연동 (GDD §9.2, 2026-08-29)', () => {
  it('골드관 일일 한도 소진 후 광고 연장으로 +1 구매 — 연장도 상품당 하루 1회', () => {
    const clock = makeCtx();
    let { save: s } = saveWithParty(clock, [{ id: 'dune-pup' }], { gold: 100_000 });
    const productId = 'gold-lure'; // 일일 3회
    for (let i = 0; i < 3; i++) s = buyShopProduct(content, s, { productId }, clock.ctx).save;
    expect(() => buyShopProduct(content, s, { productId }, clock.ctx)).toThrow(GameError); // 한도 소진

    s = grantShopAdExtra(content, s, productId, clock.ctx.now()); // 광고 연장 +1
    s = buyShopProduct(content, s, { productId }, clock.ctx).save; // 4번째 성공
    expect(s.wallet.lures).toBeGreaterThanOrEqual(4);
    expect(() => buyShopProduct(content, s, { productId }, clock.ctx)).toThrow(GameError); // 연장분도 소진
    expect(() => grantShopAdExtra(content, s, productId, clock.ctx.now())).toThrow(GameError); // 오늘 연장 끝

    clock.advance(24 * 3_600_000); // 자정 리셋 — 한도·연장 모두 복구
    expect(() => grantShopAdExtra(content, s, productId, clock.ctx.now())).not.toThrow();
  });

  it('광고 연장은 골드관 일일 한도 상품 전용 — 다이아·once 상품은 거절', () => {
    const clock = makeCtx();
    const { save: s } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    expect(() => grantShopAdExtra(content, s, 'dia-gold-s', clock.ctx.now())).toThrow(GameError);
    expect(() => grantShopAdExtra(content, s, 'dia-starter', clock.ctx.now())).toThrow(GameError);
  });

  it('광고 제거 — 실결제(IAP) 전용: 상점 상품이 아니고, 소유는 profile.flags.adFree', () => {
    const clock = makeCtx();
    const { save: s } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    // 출석 다이아로 못 사게 상점에서 제거됨 (2026-08-29 사용자) — 판매처는 platform/iap.ts뿐
    expect(content.shopProducts.some((p) => p.id === 'dia-ad-free')).toBe(false);
    expect(hasAdFree(s)).toBe(false);
    s.profile.flags['adFree'] = true; // IAP 구매·복원이 세우는 플래그 (store.grantAdFree)
    expect(hasAdFree(s)).toBe(true);
  });
});

describe('세이브 마이그레이션 v10 → v11', () => {
  it('buffs 저장소가 추가된다', async () => {
    const { migrateSave } = await import('../src/state/migrations');
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const raw = structuredClone(save) as unknown as Record<string, unknown>;
    raw['version'] = 10;
    delete raw['buffs'];
    const migrated = migrateSave(raw)!;
    expect(migrated.version).toBe(13);
    expect(migrated.buffs).toEqual({ scentUntil: 0 });
  });
});

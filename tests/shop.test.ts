import { describe, expect, it } from 'vitest';
import { buyShopProduct, purchasesToday, todayKey } from '../src/core/shop';
import type { CoreCtx, SaveState } from '../src/core/types';
import { T0, content, makeCtx, makeExpedition, saveWithParty } from './helpers';

const fixedCtx = (now = T0, seed = 's'): CoreCtx => ({ now: () => now, newSeed: () => seed, newUid: () => 'shop-uid' });

function richSave(opts: { gold?: number; diamonds?: number } = {}): SaveState {
  const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }], { gold: opts.gold ?? 50_000 });
  save.wallet.diamonds = opts.diamonds ?? 1000;
  return save;
}

describe('상점 (GDD §9.4)', () => {
  it('골드 상품 — 재화 차감·지급, 부족하면 실패', () => {
    const save = richSave({ gold: 400 });
    const result = buyShopProduct(content, save, { productId: 'gold-lure' }, fixedCtx());
    expect(result.save.wallet.gold).toBe(400 - 350);
    expect(result.save.wallet.lures).toBe(save.wallet.lures + 1);
    expect(result.granted.lures).toBe(1);

    const poor = richSave({ gold: 100 });
    expect(() => buyShopProduct(content, poor, { productId: 'gold-lure' }, fixedCtx())).toThrow(/골드가 부족/);
  });

  it('일일 한도 — 소진 시 실패, 다음날 리셋', () => {
    let save = richSave();
    const limit = content.shopProducts.find((p) => p.id === 'gold-lure')!.limit as { kind: 'daily'; count: number };
    for (let i = 0; i < limit.count; i++) {
      save = buyShopProduct(content, save, { productId: 'gold-lure' }, fixedCtx()).save;
    }
    expect(purchasesToday(save, 'gold-lure', T0)).toBe(limit.count);
    expect(() => buyShopProduct(content, save, { productId: 'gold-lure' }, fixedCtx())).toThrow(/한도/);

    // 다음날 — 리셋되어 다시 구매 가능
    const tomorrow = T0 + 24 * 3600_000;
    expect(todayKey(tomorrow)).not.toBe(todayKey(T0));
    const next = buyShopProduct(content, save, { productId: 'gold-lure' }, fixedCtx(tomorrow));
    expect(purchasesToday(next.save, 'gold-lure', tomorrow)).toBe(1);
  });

  it('1회 한정 — 시작 패키지는 재구매 불가', () => {
    const save = richSave();
    const result = buyShopProduct(content, save, { productId: 'dia-starter' }, fixedCtx());
    expect(result.save.wallet.diamonds).toBe(1000 - 120);
    expect(result.save.wallet.gold).toBe(save.wallet.gold + 8000);
    expect(result.save.wallet.dust).toBe(save.wallet.dust + 300);
    expect(() => buyShopProduct(content, result.save, { productId: 'dia-starter' }, fixedCtx())).toThrow(/이미 구매/);
  });

  it('지역당 1회 — 개척 패키지는 지역별 기록, 미해금 지역 불가', () => {
    const save = richSave();
    const result = buyShopProduct(content, save, { productId: 'dia-region-pack', regionId: 'misty-coast' }, fixedCtx());
    const region = content.regions.get('misty-coast')!;
    for (const materialId of region.materials) {
      expect(result.save.wallet.materials[materialId]).toBe(10);
    }
    expect(result.save.wallet.gold).toBe(save.wallet.gold + 2000);
    expect(() =>
      buyShopProduct(content, result.save, { productId: 'dia-region-pack', regionId: 'misty-coast' }, fixedCtx()),
    ).toThrow(/이미 구매/);
    expect(() =>
      buyShopProduct(content, save, { productId: 'dia-region-pack', regionId: 'ashen-volcano' }, fixedCtx()),
    ).toThrow(/해금한 지역만/);
  });

  it('재료 꾸러미 — 선택 지역 재료 2종 각 n개', () => {
    const save = richSave();
    const goods = content.shopProducts.find((p) => p.id === 'gold-materials')!.goods as { kind: 'materials'; countEach: number };
    const result = buyShopProduct(content, save, { productId: 'gold-materials', regionId: 'misty-coast' }, fixedCtx());
    expect(result.granted.materials).toHaveLength(2);
    for (const { materialId, count } of result.granted.materials!) {
      expect(count).toBe(goods.countEach);
      expect(result.save.wallet.materials[materialId]).toBe(goods.countEach);
    }
  });

  it('몬스터 뽑기 — 해금 지역·확률표 등급의 카드 지급, 신규면 도감 등록', () => {
    const save = richSave();
    const table = content.balance.shop.monsterGacha.goldNormal!;
    const result = buyShopProduct(content, save, { productId: 'gold-monster-gacha' }, fixedCtx());
    const monster = content.monsters.get(result.granted.monsterId!)!;
    expect(table[monster.rarity] ?? 0).toBeGreaterThan(0);
    expect(monster.habitat).toBe('misty-coast'); // 해금 지역(첫 지역)만
    const owned = result.save.roster.find((m) => m.monsterId === monster.id)!;
    expect(owned.count).toBeGreaterThanOrEqual(1);
    if (result.granted.isNewMonster) expect(result.save.codex[monster.id]!.captured).toBe(true);
  });

  it('고급 유물 발굴 — 희귀 이상 확정', () => {
    const save = richSave();
    const result = buyShopProduct(content, save, { productId: 'dia-artifact-gacha-premium' }, fixedCtx());
    const def = content.artifacts.get(result.granted.artifactItemId!)!;
    expect(['rare', 'heroic', 'legendary']).toContain(def.rarity);
    expect(result.save.artifacts).toHaveLength(1);
    expect(result.save.artifacts[0]!.enhance).toBe(0);
  });

  it('신속 완료 — 남은 시간이 가장 긴 원정을 즉시 귀환, 없으면 실패', () => {
    const save = richSave();
    const now = T0 + 1000;
    save.expeditions.push(makeExpedition('misty-coast', 'scout', ['dune-pup'], [], 'rush-a'));
    const long = makeExpedition('misty-coast', 'deep', [], [], 'rush-b');
    save.expeditions.push(long);
    const result = buyShopProduct(content, save, { productId: 'dia-rush' }, fixedCtx(now));
    expect(result.granted.rushedExpeditionId).toBe(long.id); // deep이 더 오래 남음
    expect(result.save.expeditions.find((e) => e.id === long.id)!.endsAt).toBe(now);

    const idle = richSave();
    expect(() => buyShopProduct(content, idle, { productId: 'dia-rush' }, fixedCtx(now))).toThrow(/진행 중 원정이 없/);
  });
});

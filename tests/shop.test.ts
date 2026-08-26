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

  it('모래시계 — 다이아 차감·인벤토리 적립', () => {
    const save = richSave();
    const result = buyShopProduct(content, save, { productId: 'dia-hourglass-60' }, fixedCtx());
    expect(result.save.wallet.diamonds).toBe(1000 - 6);
    expect(result.save.wallet.hourglasses['hourglass-60']).toBe(1);
    expect(result.granted.hourglass).toEqual({ hourglassId: 'hourglass-60', count: 1 });

    const again = buyShopProduct(content, result.save, { productId: 'dia-hourglass-60' }, fixedCtx());
    expect(again.save.wallet.hourglasses['hourglass-60']).toBe(2);
  });

  it('1회 한정 — 시작 패키지는 재구매 불가', () => {
    const save = richSave();
    const result = buyShopProduct(content, save, { productId: 'dia-starter' }, fixedCtx());
    expect(result.save.wallet.diamonds).toBe(1000 - 120);
    expect(result.save.wallet.gold).toBe(save.wallet.gold + 8000);
    expect(result.save.wallet.dust).toBe(save.wallet.dust + 300);
    expect(() => buyShopProduct(content, result.save, { productId: 'dia-starter' }, fixedCtx())).toThrow(/이미 구매/);
  });

  it('지역 개척 패키지 — 해금 지역 전체 재료 각 10개 + 골드, 무제한 재구매 (2026-08-23)', () => {
    const save = richSave();
    const result = buyShopProduct(content, save, { productId: 'dia-region-pack' }, fixedCtx());
    const region = content.regions.get('misty-coast')!;
    for (const materialId of region.materials) {
      expect(result.save.wallet.materials[materialId]).toBe(10);
    }
    expect(result.save.wallet.gold).toBe(save.wallet.gold + 2000);

    // 무제한(none) — 재구매 가능하고 구매 기록도 남지 않는다
    const again = buyShopProduct(content, result.save, { productId: 'dia-region-pack' }, fixedCtx());
    for (const materialId of region.materials) {
      expect(again.save.wallet.materials[materialId]).toBe(20);
    }
    expect(again.save.shop.once).toHaveLength(0);
    expect(again.save.shop.bought['dia-region-pack']).toBeUndefined();
  });

  it('재료 꾸러미 — 해금한 모든 지역의 재료를 각 n개 (지역 선택 없음)', () => {
    const goods = content.shopProducts.find((p) => p.id === 'gold-materials')!.goods as { kind: 'materialsAll'; countEach: number };

    // 첫 지역만 해금 — 그 지역 재료 2종만
    const save = richSave();
    const one = buyShopProduct(content, save, { productId: 'gold-materials' }, fixedCtx());
    expect(one.granted.materials!.map((m) => m.materialId).sort())
      .toEqual([...content.regions.get('misty-coast')!.materials].sort());

    // 전 지역 해금 — 모든 재료가 각 n개씩 (같은 티어 소지역은 재료를 공유하므로 지역 수가 아니라 재료 종 수)
    const { save: unlockedSave } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }], { gold: 50_000, unlockAll: true });
    const all = buyShopProduct(content, unlockedSave, { productId: 'gold-materials' }, fixedCtx());
    expect(all.granted.materials).toHaveLength(content.materials.size);
    for (const { materialId, count } of all.granted.materials!) {
      expect(count).toBe(goods.countEach);
      expect(all.save.wallet.materials[materialId]).toBe(goods.countEach);
    }
  });

  it('골드 몬스터 뽑기 — 전설까지 등장하되 항상 해금 지역 출신 (2026-08-23)', () => {
    const table = content.balance.shop.monsterGacha.goldNormal!;
    expect(table.legendary ?? 0).toBeGreaterThan(0);
    let legendaryId: string | null = null;
    for (let i = 0; i < 2000 && legendaryId === null; i++) {
      const result = buyShopProduct(content, richSave(), { productId: 'gold-monster-gacha' }, fixedCtx(T0, `g${i}`));
      const monster = content.monsters.get(result.granted.monsterId!)!;
      expect(monster.habitat).toBe('misty-coast'); // 해금 지역(첫 지역) 한정
      if (monster.rarity === 'legendary') legendaryId = monster.id;
    }
    expect(legendaryId).not.toBeNull(); // 낮은 확률이어도 실제로 뽑힌다 (시드 결정론이라 항상 같은 결과)
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

});

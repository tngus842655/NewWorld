/**
 * 제작 — 미끼·모래시계 산출 (2026-08-25).
 *
 * 배경: 지역 재료 8종 중 3종(조가비·잿불핵·흑요석조각)이 소모처가 0이었다.
 * 미끼는 파견당 3개 상한(lures.maxLoad)이라 레시피를 늘려도 누적을 못 푼다 →
 * 소비 천장이 없는 모래시계를 재료로도 만들 수 있게 했다.
 */
import { describe, expect, it } from 'vitest';
import { craftRecipe } from '../src/core/economy';
import { content, makeCtx, saveWithParty } from './helpers';

const withWallet = (gold: number, materials: Record<string, number>) => {
  const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }], { unlockAll: true });
  save.wallet.gold = gold;
  save.wallet.materials = { ...materials };
  return save;
};

describe('제작 산출', () => {
  it('미끼 레시피는 지갑의 미끼를 늘린다 (기존 동작 유지)', () => {
    const recipe = content.recipes.get('basic-lure')!;
    expect(recipe.output.kind).toBe('lures');
    const save = withWallet(10_000, { 'salt-bloom': 5 });
    const before = save.wallet.lures;
    const next = craftRecipe(content, save, 'basic-lure');
    expect(next.wallet.lures).toBe(before + 1);
    expect(next.wallet.materials['salt-bloom']).toBe(3);
    expect(next.wallet.gold).toBe(10_000 - recipe.cost.gold);
  });

  it('모래시계 레시피는 해당 모래시계를 개수만큼 지급한다', () => {
    const recipe = content.recipes.get('craft-hourglass-15')!;
    expect(recipe.output.kind).toBe('hourglass');
    if (recipe.output.kind !== 'hourglass') throw new Error('unreachable');
    const save = withWallet(10_000, { 'salt-bloom': 5, 'tide-shell': 5 });
    const next = craftRecipe(content, save, 'craft-hourglass-15');
    expect(next.wallet.hourglasses[recipe.output.hourglassId]).toBe(recipe.output.count);
    expect(next.wallet.lures).toBe(save.wallet.lures); // 미끼는 그대로
  });

  it('재료·골드가 모자라면 거절하고 지갑을 건드리지 않는다', () => {
    const poorGold = withWallet(0, { 'salt-bloom': 5, 'tide-shell': 5 });
    expect(() => craftRecipe(content, poorGold, 'craft-hourglass-15')).toThrow(/골드/);
    const poorMat = withWallet(10_000, { 'salt-bloom': 1 });
    expect(() => craftRecipe(content, poorMat, 'craft-hourglass-15')).toThrow(/부족/);
    expect(poorMat.wallet.gold, '거절 시 원본 세이브가 변하면 안 된다').toBe(10_000);
  });

  it('모든 재료에 소모처가 있다 — 쌓이기만 하는 재료가 없어야 한다', () => {
    const sinks = new Set<string>();
    for (const recipe of content.recipes.values()) {
      for (const id of Object.keys(recipe.cost.materials)) sinks.add(id);
    }
    for (const region of content.regionList) {
      for (const id of Object.keys(region.unlock.materials ?? {})) sinks.add(id);
    }
    const orphans = [...content.materials.values()].filter((m) => !sinks.has(m.id)).map((m) => m.name);
    expect(orphans, '소모처 없는 재료').toEqual([]);
  });
});

describe('모래시계 제작 밸런스', () => {
  /**
   * 이 게임의 시간축을 지키는 실제 제동은 골드 가격이 아니라 **상점의 일일 한도**다
   * (골드는 시뮬 하드코어 D5에 33만이 쌓인다 — 모래시계 전 상품이 4,400골드).
   * 재료 레시피에는 일일 한도가 없으므로, 대신 **재료비 자체**가 제동이어야 한다.
   */
  it('어떤 레시피도 자기 원정 시간을 되돌려주지 못한다 (무한 스킵 루프 차단)', () => {
    const { balance } = content;
    const deep = balance.tiers.deep;
    // 심층 1회가 그 지역 재료를 몇 개 주는가: 채집 조우 수 × 평균 산출 × yieldMult
    const avgGather = (balance.rewards.gatherMaterialMin + balance.rewards.gatherMaterialMax) / 2;
    const deepMinutes = deep.minutes;

    for (const recipe of content.recipes.values()) {
      if (recipe.output.kind !== 'hourglass') continue;
      const def = content.hourglasses.get(recipe.output.hourglassId)!;
      const totalMinutes = def.minutes * recipe.output.count;
      const materialCost = Object.values(recipe.cost.materials).reduce((sum, n) => sum + n, 0);

      // 가장 후한 지역(채집 비중 최대)을 기준으로 재료 수급 속도를 잡는다
      const bestGatherShare = Math.max(...content.regionList.map((r) => {
        const mix = r.encounterMix;
        return mix.gather / (mix.monster + mix.treasure + mix.trap + mix.gather);
      }));
      const materialsPerDeepRun = deep.encounters * bestGatherShare * avgGather * deep.yieldMult;
      const runsNeeded = materialCost / materialsPerDeepRun;
      const minutesSpent = runsNeeded * deepMinutes;

      expect(totalMinutes, `${recipe.name}: ${minutesSpent.toFixed(0)}분 들여 ${totalMinutes}분을 번다`)
        .toBeLessThan(minutesSpent);
    }
  });

  it('등급 간 효율이 뒤집히지 않는다 — 어느 하나가 압도적으로 좋으면 나머지는 죽은 레시피가 된다', () => {
    const ratios = [...content.recipes.values()]
      .filter((r) => r.output.kind === 'hourglass')
      .map((r) => {
        const out = r.output as Extract<typeof r.output, { kind: 'hourglass' }>;
        const minutes = content.hourglasses.get(out.hourglassId)!.minutes * out.count;
        const mats = Object.values(r.cost.materials).reduce((s, n) => s + n, 0);
        return { name: r.name, ratio: minutes / mats };
      });
    expect(ratios.length).toBeGreaterThan(0);
    const min = Math.min(...ratios.map((r) => r.ratio));
    const max = Math.max(...ratios.map((r) => r.ratio));
    // 최고/최저 효율 차이가 2배를 넘으면 하위 레시피를 아무도 만들지 않는다
    expect(max / min, `분/재료 ${ratios.map((r) => `${r.name} ${r.ratio.toFixed(1)}`).join(' · ')}`)
      .toBeLessThanOrEqual(2);
  });

  it('재료 레시피는 상점 골드가보다 비싸다 — 싸면 상점 상품이 죽는다', () => {
    for (const recipe of content.recipes.values()) {
      if (recipe.output.kind !== 'hourglass') continue;
      const out = recipe.output;
      const shop = content.shopProducts.find(
        (p) => p.shop === 'gold' && p.goods.kind === 'hourglass' && p.goods.hourglassId === out.hourglassId,
      );
      if (!shop) continue;
      expect(recipe.cost.gold, `${recipe.name}의 골드가`).toBeGreaterThan(shop.price * out.count);
    }
  });
});

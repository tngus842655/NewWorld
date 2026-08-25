/**
 * 제작 — 미끼·모래시계 산출 (2026-08-25).
 *
 * 배경 1: 지역 재료 8종 중 3종(조가비·잿불핵·흑요석조각)이 소모처가 0이었다.
 * 미끼는 파견당 3개 상한(lures.maxLoad)이라 레시피를 늘려도 누적을 못 푼다 →
 * 소비 천장이 없는 모래시계를 재료로도 만들 수 있게 했다.
 *
 * 배경 2 (수급·소비 균형): 소모처가 생긴 뒤에도 **슬롯1 재료만 쌓였다**.
 * 갈림길 재료 보상이 슬롯 고정이라(안전→슬롯0, 위험→슬롯1) 강한 유저는 슬롯1만 받는데,
 * 레시피·해금은 반대로 슬롯0을 더 요구했다 — 심층 1회 기준 수급 1.13 : 3.52 대 소비 4 : 3.
 * 시뮬 14일에 흑요석조각 소비율 23%, 하루 67개씩 사장(scripts/material-audit.ts).
 * 해결은 양쪽을 대칭으로 맞추는 것 — 아래 세 테스트가 그 대칭을 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { craftRecipe } from '../src/core/economy';
import { content, makeCtx, saveWithParty } from './helpers';

/** 재료 id → 그 재료가 나는 지역의 슬롯 번호(0 또는 1) */
const slotOf = (materialId: string): number => {
  const region = content.regions.get(content.materials.get(materialId)!.region)!;
  return region.materials.indexOf(materialId);
};

/** 재료 묶음을 "지역 → [슬롯0 개수, 슬롯1 개수]"로 접는다 */
const bySlot = (materials: Record<string, number>): Map<string, [number, number]> => {
  const out = new Map<string, [number, number]>();
  for (const [id, count] of Object.entries(materials)) {
    const regionId = content.materials.get(id)!.region;
    const pair: [number, number] = out.get(regionId) ?? [0, 0];
    if (slotOf(id) === 0) pair[0] += count;
    else pair[1] += count;
    out.set(regionId, pair);
  }
  return out;
};

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
    const save = withWallet(10_000, { 'salt-bloom': 5, 'tide-shell': 5 });
    const before = save.wallet.lures;
    const next = craftRecipe(content, save, 'basic-lure');
    expect(next.wallet.lures).toBe(before + 1);
    expect(next.wallet.materials['salt-bloom']).toBe(4);
    expect(next.wallet.materials['tide-shell']).toBe(4);
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
    const avgGather = (balance.rewards.gatherMaterialMin + balance.rewards.gatherMaterialMax) / 2;

    // 갈림길 1회가 주는 기대 재료 — 재료를 노리는 유저는 재료가 걸린 쪽을 고른다
    const crossroadBest = Math.max(
      ...content.events.crossroads.map((event) => {
        const sum = (list: readonly { kind: string; count?: number }[]) =>
          list.reduce((total, reward) => total + (reward.kind === 'material' ? (reward.count ?? 0) : 0), 0);
        return Math.max(sum(event.safe), sum(event.risky.success));
      }),
    ) / content.events.crossroads.length;

    // 채집 비중이 가장 후한 지역 기준
    const bestGatherShare = Math.max(...content.regionList.map((r) => {
      const mix = r.encounterMix;
      return mix.gather / (mix.monster + mix.treasure + mix.trap + mix.gather);
    }));

    /**
     * 정찰·보통·심층을 모두 본다. 짧은 티어일수록 분당 조우 밀도가 높아 재료 효율이 좋다
     * (정찰 15분/3조우 vs 심층 480분/18조우) — 심층만 재면 정찰 반복 루프를 놓친다.
     */
    for (const [tierName, tier] of Object.entries(balance.tiers)) {
      const perRun = tier.encounters * bestGatherShare * avgGather * tier.yieldMult + tier.crossroads * crossroadBest;
      for (const recipe of content.recipes.values()) {
        if (recipe.output.kind !== 'hourglass') continue;
        const def = content.hourglasses.get(recipe.output.hourglassId)!;
        const totalMinutes = def.minutes * recipe.output.count;
        const materialCost = Object.values(recipe.cost.materials).reduce((sum, n) => sum + n, 0);
        const minutesSpent = (materialCost / perRun) * tier.minutes;

        // 본전(1.0)만 넘으면 오차 하나에 루프가 열린다 — 최소 1.4배는 손해여야 한다
        expect(minutesSpent / totalMinutes, `${recipe.name} @${tierName}: ${minutesSpent.toFixed(0)}분 들여 ${totalMinutes}분을 번다`)
          .toBeGreaterThan(1.4);
      }
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

  it('갈림길 재료 보상이 슬롯으로 갈리지 않는다 — 갈리면 한쪽만 쌓인다', () => {
    // 안전=슬롯0, 위험=슬롯1로 갈려 있으면 갈림길 성향이 고정된 유저는 평생 한 종만 받는다
    for (const event of content.events.crossroads) {
      for (const [branch, rewards] of [['안전', event.safe], ['위험', event.risky.success]] as const) {
        const slots: [number, number] = [0, 0];
        for (const reward of rewards) {
          if (reward.kind !== 'material') continue;
          if (reward.slot === 0) slots[0] += reward.count;
          else slots[1] += reward.count;
        }
        if (slots[0] === 0 && slots[1] === 0) continue;
        expect(slots[0], `${event.name} ${branch} 보상의 슬롯0/슬롯1`).toBe(slots[1]);
      }
    }
  });

  it('모든 소모처가 지역 재료 2종을 같은 수로 쓴다 — 수급이 균등하니 소비도 균등해야 한다', () => {
    // 채집 조우는 지역 재료 2종을 균등 랜덤으로 준다(expedition.ts). 갈림길도 위 테스트로 균등.
    // 그러면 소비가 한쪽으로 기울어진 만큼 반대쪽이 그대로 사장된다.
    const sinks: { name: string; materials: Record<string, number> }[] = [
      ...[...content.recipes.values()].map((r) => ({ name: r.name, materials: r.cost.materials })),
      ...content.regionList
        .filter((r) => r.unlock.materials)
        .map((r) => ({ name: `${r.name} 해금`, materials: r.unlock.materials! })),
    ];
    for (const sink of sinks) {
      for (const [regionId, [slot0, slot1]] of bySlot(sink.materials)) {
        const region = content.regions.get(regionId)!;
        expect(slot0, `${sink.name}의 ${region.name} 재료 ${region.materials.join('/')} 소비량`).toBe(slot1);
      }
    }
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

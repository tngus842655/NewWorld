import { describe, expect, it } from 'vitest';
import { captureChance, shouldUseLure } from '../src/core/capture';
import {
  awakenMonster,
  buyPartySlot,
  craftRecipe,
  enhanceArtifact,
  fuseArtifacts,
  fuseMonsters,
  levelUpMonster,
  transcendGateRegion,
  unlockRegion,
} from '../src/core/economy';
import { artifactEnhanceCost, levelUpCost, monsterCostMult, monsterLevelUpCost, monsterStarUpCost, starUpCost } from '../src/core/formulas';
import { canUnlockRegion, teamCount } from '../src/core/progression';
import { regionFlagKey } from '../src/core/progression';
import { streamRng } from '../src/core/rng';
import { GameError, type CoreCtx } from '../src/core/types';
import { T0, content, findSeed, makeCtx, makeExpedition, saveWithParty } from './helpers';

const wolf = content.monsters.get('thorn-wolf')!; // 커먼
const turtle = content.monsters.get('pearl-turtle')!; // 레어
const dragon = content.monsters.get('ember-dragon-king')!; // 전설

describe('포획 판정', () => {
  it('기본률 = 등급별, 미끼 ×2, 최종 상한 clamp', () => {
    const base = content.balance.capture.base;
    expect(captureChance(content, { monster: wolf, captureAddSum: 0, useLure: false, buffMult: 1 })).toBeCloseTo(base.common);
    expect(captureChance(content, { monster: turtle, captureAddSum: 0, useLure: true, buffMult: 1 })).toBeCloseTo(base.rare * content.balance.capture.lureMult);
    expect(captureChance(content, { monster: dragon, captureAddSum: 0, useLure: false, buffMult: 1 })).toBeCloseTo(base.legendary);
    // 배수 상한: 미끼×버프가 multCap을 넘는 만큼은 무시
    const capped = captureChance(content, { monster: dragon, captureAddSum: 0, useLure: true, buffMult: 3 });
    expect(capped).toBeCloseTo(base.legendary * content.balance.capture.multCap);
    // 확률 상한
    const high = captureChance(content, { monster: wolf, captureAddSum: 0.2, useLure: true, buffMult: 2 });
    expect(high).toBe(content.balance.capture.chanceCap);
  });

  it('미끼는 아직 도감에 없는 희귀 이상에만 자동 사용', () => {
    expect(shouldUseLure(wolf, 3, false), '일반은 미끼를 쓰지 않는다').toBe(false);
    expect(shouldUseLure(turtle, 3, false), '미포획 희귀에는 쓴다').toBe(true);
    expect(shouldUseLure(turtle, 0, false), '남은 미끼가 없으면 못 쓴다').toBe(false);
    // 2026-08-25: 이미 잡은 종에 쓰면 카드 1장이 전부다. 미끼의 값어치는 도감을 늘리는 데 있다
    expect(shouldUseLure(turtle, 3, true), '이미 포획한 종에는 쓰지 않는다').toBe(false);
    expect(shouldUseLure(dragon, 3, true), '전설이어도 보유 중이면 아낀다').toBe(false);
  });
});

describe('경제 액션', () => {
  it('레벨업 — 골드 차감, 부족하면 GameError', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }], { gold: 10_000 });
    const next = levelUpMonster(content, save, partyIds[0]!);
    expect(next.roster[0]!.level).toBe(2);
    expect(next.wallet.gold).toBe(10_000 - levelUpCost(1, content.balance));
    expect(save.roster[0]!.level).toBe(1); // 원본 불변

    const poor = { ...save, wallet: { ...save.wallet, gold: 0 } };
    expect(() => levelUpMonster(content, poor, partyIds[0]!)).toThrow(GameError);
  });

  it('각성 — 골드 차감(정수 폐기), ★3에서 도감 awakened', () => {
    const clock = makeCtx();
    const goldCost = content.balance.star.goldCost;
    const startGold = goldCost[0]! + goldCost[1]! + 100;
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }], { gold: startGold });
    let next = awakenMonster(content, save, partyIds[0]!); // ★2
    next = awakenMonster(content, next, partyIds[0]!); // ★3
    expect(next.roster[0]!.star).toBe(3);
    expect(next.wallet.gold).toBe(100);
    expect(next.codex['dune-pup']!.awakened).toBe(true);
    expect(() => awakenMonster(content, next, partyIds[0]!)).toThrow(/골드/); // ★4 비용 부족
  });

  it('성장 비용 지역·등급 차등 (2026-08-23) — 깊은 지역·높은 등급일수록 비싸다', () => {
    // dune-pup: 해안(×1) 일반(×1) → 배수 1 (초반 곡선 불변)
    expect(monsterCostMult(content, 'dune-pup')).toBe(1);
    expect(monsterLevelUpCost(content, 'dune-pup', 1)).toBe(levelUpCost(1, content.balance));

    // 화산 전설: 지역 ×12 × 등급 ×3 = ×36
    const volcanoLegend = content.monsterList.find((m) => m.habitat === 'ashen-volcano' && m.rarity === 'legendary')!;
    const mult = content.regions.get('ashen-volcano')!.growthCostMult * content.balance.level.rarityCostMult.legendary!;
    expect(monsterCostMult(content, volcanoLegend.id)).toBe(mult);
    expect(monsterLevelUpCost(content, volcanoLegend.id, 5)).toBe(Math.round(levelUpCost(5, content.balance) * mult));
    expect(monsterStarUpCost(content, volcanoLegend.id, 1)).toBe(Math.round(starUpCost(1, content.balance) * mult));

    // 유물: 전설 강화 = 기본 × 3.5
    const legendArtifact = content.artifactsByRarity.get('legendary')![0]!;
    expect(artifactEnhanceCost(content, legendArtifact.id, 0)).toBe(
      Math.round(content.balance.artifacts.enhance.dustCost[0]! * content.balance.artifacts.enhance.rarityCostMult.legendary!));
  });

  it('미끼 제작 — 재료·골드 차감', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { gold: 1000, lures: 0 });
    save.wallet.materials['salt-bloom'] = 5;
    save.wallet.materials['tide-shell'] = 5;
    const next = craftRecipe(content, save, 'basic-lure');
    expect(next.wallet.lures).toBe(1);
    expect(next.wallet.materials['salt-bloom']).toBe(4);
    expect(next.wallet.materials['tide-shell']).toBe(4);
    expect(next.wallet.gold).toBe(850);
    expect(() => craftRecipe(content, { ...next, wallet: { ...next.wallet, materials: {} } }, 'basic-lure')).toThrow(/부족/);
  });

  it('유물 강화 — 종 단위 (v6): 강화는 종 공통, 등급 차등 비용', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: ['rusty-saber'], dust: 100 });
    save.artifacts[0]!.count = 2; // 2개 보유
    const enhanced = enhanceArtifact(content, save, 'rusty-saber');
    expect(enhanced.artifacts[0]!.enhance).toBe(1); // 개수와 무관하게 종당 강화 하나
    // 등급 차등 (2026-08-23): 고급 유물은 기본 10 × 1.3 = 13
    const enhance0Cost = artifactEnhanceCost(content, 'rusty-saber', 0);
    expect(enhanced.wallet.dust).toBe(100 - enhance0Cost);
  });

  it('파티 슬롯 구매 — 도감 조건 + 골드', () => {
    const clock = makeCtx();
    const unlock = content.balance.party.slotUnlocks[0]!; // 콘텐츠 파생 — 게이트 재조정에 테스트가 따라간다
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { gold: unlock.gold * 2, partySlots: 3 });
    expect(() => buyPartySlot(content, save)).toThrow(/도감/);
    // 도감 조건만큼 채우기
    for (const monster of content.monsterList.slice(0, unlock.totalCaptured)) {
      save.codex[monster.id] = { seen: true, captured: true, awakened: false };
    }
    const next = buyPartySlot(content, save);
    expect(next.profile.partySlots).toBe(4);
  });

});

describe('카드 합성 (GDD §4.5)', () => {
  const fixedCtx = (seed: string): CoreCtx => ({ now: () => T0, newSeed: () => seed, newUid: () => 'u' });
  const fuseInput = (monsterId: string, count: number) => ({ materials: [{ monsterId, count }] });

  it('마지막 1장은 재료 불가 (여분만 사용)', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]); // count 1 → 여분 0
    expect(() => fuseMonsters(content, save, fuseInput('dune-pup', 2), fixedCtx('s'))).toThrow(/여분/);
  });

  it('재료는 같은 등급 2장, 초월은 종점', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }, { id: 'pearl-turtle' }]);
    save.roster.forEach((m) => { m.count = 3; });
    expect(() =>
      fuseMonsters(content, save, { materials: [{ monsterId: 'dune-pup', count: 1 }, { monsterId: 'pearl-turtle', count: 1 }] }, fixedCtx('s')),
    ).toThrow(/같은 등급/);
    expect(() => fuseMonsters(content, save, fuseInput('dune-pup', 1), fixedCtx('s'))).toThrow(/2장/);

    // 초월(최상위)은 더 합성할 수 없다 — 사다리의 새 종점 (2026-08-25)
    const top = saveWithParty(makeCtx(), [{ id: 'emberwing-sovereign' }]);
    top.save.roster[0]!.count = 3;
    expect(() => fuseMonsters(content, top.save, fuseInput('emberwing-sovereign', 2), fixedCtx('s')))
      .toThrow(/더 합성할 수 없습니다/);
  });

  it('초월 합성은 분화구 심장부 해금이 관문 — 재료 서식 제한은 없다 (2026-08-31 사용자, 구 규칙: 최종 지역 서식만)', () => {
    const gate = transcendGateRegion(content);
    // 해안 전설 여분 2장 — 관문 미해금이면 거절 (재료가 아니라 관문 때문)
    const coast = saveWithParty(makeCtx(), [{ id: 'leviathan-calf' }]);
    coast.save.roster[0]!.count = 3;
    expect(() => fuseMonsters(content, coast.save, fuseInput('leviathan-calf', 2), fixedCtx('s')))
      .toThrow(/해금 후에/);

    // 관문 해금 → 같은 해안 전설로 도전 가능 (확률 판정까지 도달한다)
    coast.save.profile.flags[regionFlagKey(gate.id)] = true;
    expect(() => fuseMonsters(content, coast.save, fuseInput('leviathan-calf', 2), fixedCtx('s'))).not.toThrow();

    // 관문 미해금이면 최종 지역 전설(구 규칙의 재료)도 거절 — 규칙이 "재료"에서 "관문"으로 옮겨갔다
    const last = content.regionList[content.regionList.length - 1]!;
    const lastLegend = content.monsterList.find((m) => m.rarity === 'legendary' && m.habitat === last.id)!;
    const locked = saveWithParty(makeCtx(), [{ id: lastLegend.id }]);
    locked.save.roster[0]!.count = 3;
    expect(() => fuseMonsters(content, locked.save, fuseInput(lastLegend.id, 2), fixedCtx('s'))).toThrow(/해금 후에/);
  });

  it('초월 합성 성공 시 초월 종만 나온다 — 조우·뽑기로는 절대 얻을 수 없는 등급', () => {
    const last = content.regionList[content.regionList.length - 1]!;
    const volcanoLegend = content.monsterList.find((m) => m.rarity === 'legendary' && m.habitat === last.id)!;
    const { save } = saveWithParty(makeCtx(), [{ id: volcanoLegend.id }]);
    save.roster[0]!.count = 3;
    for (const region of content.regionList) save.profile.flags[regionFlagKey(region.id)] = true;
    const okSeed = findSeed((seed) => streamRng(seed, 'fusion')() < content.balance.fusion.chance.legendary!);
    const result = fuseMonsters(content, save, fuseInput(volcanoLegend.id, 2), fixedCtx(okSeed));
    expect(result.success).toBe(true);
    expect(content.monsters.get(result.resultMonsterId!)!.rarity).toBe('transcendent');
  });

  it('성공 — 해금 지역의 다음 등급 랜덤 획득, 도감 등록, 재료 차감', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    save.roster[0]!.count = 3; // 여분 2
    const okSeed = findSeed((s) => streamRng(s, 'fusion')() < content.balance.fusion.chance.common!);
    const result = fuseMonsters(content, save, fuseInput('dune-pup', 2), fixedCtx(okSeed));
    expect(result.success).toBe(true);
    const got = content.monsters.get(result.resultMonsterId!)!;
    expect(got.rarity).toBe('uncommon');
    expect(got.habitat).toBe('misty-coast'); // 해금 지역(첫 지역)에서만
    expect(result.save.roster.find((m) => m.monsterId === 'dune-pup')!.count).toBe(1);
    expect(result.isNew).toBe(true);
    expect(result.save.codex[got.id]!.captured).toBe(true);
    expect(result.save.roster.find((m) => m.monsterId === got.id)!.count).toBe(1);
  });

  it('실패 — 재료 2장 중 1장 반환 (실소모 1장), 로스터·도감 불변', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    save.roster[0]!.count = 3;
    const failSeed = findSeed((s) => streamRng(s, 'fusion')() >= content.balance.fusion.chance.common!);
    const result = fuseMonsters(content, save, fuseInput('dune-pup', 2), fixedCtx(failSeed));
    expect(result.success).toBe(false);
    expect(result.returnedMonsterId).toBe('dune-pup');
    expect(result.save.roster).toHaveLength(1);
    expect(result.save.roster[0]!.count).toBe(2); // 3 - 2(재료) + 1(반환)
  });
});

describe('유물 합성 (GDD §4.5 — 카드 합성과 동일 규칙)', () => {
  const fixedCtx = (seed: string): CoreCtx => ({ now: () => T0, newSeed: () => seed, newUid: () => 'fused-art' });
  const commonId = content.artifactsByRarity.get('common')![0]!.id;
  const uncommonId = content.artifactsByRarity.get('uncommon')![0]!.id;
  const legendaryId = content.artifactsByRarity.get('legendary')![0]!.id;

  const withArtifacts = (items: { itemId: string; enhance?: number; count?: number }[]) => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    save.artifacts = items.map((item) => ({ itemId: item.itemId, enhance: item.enhance ?? 0, count: item.count ?? 1 }));
    return save;
  };

  it('재료 검증 (v6 종 단위) — 개수·여분·등급 혼합·초월 종점', () => {
    const save = withArtifacts([
      { itemId: commonId, count: 3 },
      { itemId: uncommonId, count: 3 },
      { itemId: legendaryId, count: 3 },
    ]);
    expect(() => fuseArtifacts(content, save, { materials: [{ itemId: commonId, count: 1 }] }, fixedCtx('s'))).toThrow(/2개/);
    expect(() => fuseArtifacts(content, save, {
      materials: [{ itemId: commonId, count: 1 }, { itemId: uncommonId, count: 1 }],
    }, fixedCtx('s'))).toThrow(/같은 등급/);
    // 전설은 이제 초월로 올라가는 재료다 — 단 최종 지역을 해금해야 도전할 수 있다 (2026-08-25 사용자)
    expect(() => fuseArtifacts(content, save, { materials: [{ itemId: legendaryId, count: 2 }] }, fixedCtx('s')))
      .toThrow(/해금해야/);
    const unlocked = withArtifacts([{ itemId: legendaryId, count: 3 }]);
    for (const region of content.regionList) unlocked.profile.flags[regionFlagKey(region.id)] = true;
    expect(() => fuseArtifacts(content, unlocked, { materials: [{ itemId: legendaryId, count: 2 }] }, fixedCtx('s'))).not.toThrow();
    // 초월은 사다리의 종점
    const topId = [...content.artifacts.values()].find((a) => a.rarity === 'transcendent')!.id;
    const top = withArtifacts([{ itemId: topId, count: 3 }]);
    for (const region of content.regionList) top.profile.flags[regionFlagKey(region.id)] = true;
    expect(() => fuseArtifacts(content, top, { materials: [{ itemId: topId, count: 2 }] }, fixedCtx('s')))
      .toThrow(/더 합성할 수 없습니다/);

    // 마지막 1개 보호 — count 2면 여분 1뿐이라 2개 재료 불가
    const scarce = withArtifacts([{ itemId: commonId, count: 2 }]);
    expect(() => fuseArtifacts(content, scarce, { materials: [{ itemId: commonId, count: 2 }] }, fixedCtx('s'))).toThrow(/여분/);
  });

  it('성공 — 다음 등급 종 획득 (강화 0), 여분 2개 차감', () => {
    const save = withArtifacts([{ itemId: commonId, enhance: 2, count: 3 }]);
    const okSeed = findSeed((s) => streamRng(s, 'fusion-artifact')() < content.balance.fusion.chance.common!);
    const result = fuseArtifacts(content, save, { materials: [{ itemId: commonId, count: 2 }] }, fixedCtx(okSeed));
    expect(result.success).toBe(true);
    const material = result.save.artifacts.find((a) => a.itemId === commonId)!;
    expect(material).toMatchObject({ enhance: 2, count: 1 }); // 마지막 1개 + 강화 유지
    const got = result.save.artifacts.find((a) => a.itemId === result.resultItemId)!;
    expect(content.artifacts.get(got.itemId)!.rarity).toBe('uncommon');
    expect(got).toMatchObject({ enhance: 0, count: 1 });
    expect(result.isNew).toBe(true);
  });

  it('실패 — 재료 2개 중 1개 반환 (실소모 1개)', () => {
    const save = withArtifacts([{ itemId: commonId, enhance: 1, count: 3 }]);
    const failSeed = findSeed((s) => streamRng(s, 'fusion-artifact')() >= content.balance.fusion.chance.common!);
    const result = fuseArtifacts(content, save, { materials: [{ itemId: commonId, count: 2 }] }, fixedCtx(failSeed));
    expect(result.success).toBe(false);
    expect(result.returnedItemId).toBe(commonId);
    expect(result.save.artifacts[0]).toMatchObject({ itemId: commonId, enhance: 1, count: 2 }); // 3 - 2 + 1
  });
});

describe('지역 해금', () => {
  it('지역 해금 — 체인 전체를 순서대로: 조건 검사와 재료 소모 (조건 수는 콘텐츠에서 파생)', () => {
    const clock = makeCtx();
    let { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    expect(canUnlockRegion(content, save, 'pearl-shallows').ok).toBe(false);

    for (const region of content.regionList.filter((r) => r.order > 1)) {
      const [prevId, need] = Object.entries(region.unlock.codexCaptured!)[0]!;
      const catchable = content.monsterList.filter(
        (m) => m.habitat === prevId && m.rarity !== 'legendary' && m.rarity !== 'transcendent');
      for (const monster of catchable.slice(0, need)) {
        save.codex[monster.id] = { seen: true, captured: true, awakened: false };
      }
      const mats = region.unlock.materials ?? {};
      if (Object.keys(mats).length > 0) {
        // 티어 진입 관문 — 도감을 채워도 재료 없이는 열리지 않는다
        expect(canUnlockRegion(content, save, region.id).ok, `${region.id} 재료 없이 해금`).toBe(false);
        for (const [materialId, count] of Object.entries(mats)) save.wallet.materials[materialId] = count;
      }
      expect(canUnlockRegion(content, save, region.id).ok, region.id).toBe(true);
      save = unlockRegion(content, save, region.id);
      expect(canUnlockRegion(content, save, region.id).ok).toBe(false); // 이미 해금
      for (const materialId of Object.keys(mats)) {
        expect(save.wallet.materials[materialId], `${region.id} 해금의 ${materialId} 소모`).toBe(0);
      }
    }
    expect(teamCount(content, save)).toBe(4); // 군 시스템: 숲 2군 → 늪 3군 → 화산 4군
  });
});

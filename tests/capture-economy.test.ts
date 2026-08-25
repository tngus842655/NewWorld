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
  salvageArtifact,
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

  it('미끼는 레어 이상에만 자동 사용', () => {
    expect(shouldUseLure(wolf, 3)).toBe(false);
    expect(shouldUseLure(turtle, 3)).toBe(true);
    expect(shouldUseLure(turtle, 0)).toBe(false);
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
    const next = craftRecipe(content, save, 'basic-lure');
    expect(next.wallet.lures).toBe(1);
    expect(next.wallet.materials['salt-bloom']).toBe(3);
    expect(next.wallet.gold).toBe(850);
    expect(() => craftRecipe(content, { ...next, wallet: { ...next.wallet, materials: {} } }, 'basic-lure')).toThrow(/부족/);
  });

  it('유물 강화·분해 — 종 단위 (v6): 강화는 종 공통, 분해는 개수 차감·환급 없음', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: ['rusty-saber'], dust: 100 });
    save.artifacts[0]!.count = 2; // 2개 보유
    const enhanced = enhanceArtifact(content, save, 'rusty-saber');
    expect(enhanced.artifacts[0]!.enhance).toBe(1); // 개수와 무관하게 종당 강화 하나
    // 등급 차등 (2026-08-23): 고급 유물은 기본 10 × 1.3 = 13
    const enhance0Cost = artifactEnhanceCost(content, 'rusty-saber', 0);
    expect(enhanced.wallet.dust).toBe(100 - enhance0Cost);

    const saberRarity = content.artifacts.get('rusty-saber')!.rarity;
    const salvageGain = content.balance.artifacts.dustPerSalvage[saberRarity]!;
    // 개수 2 → 1: 종·강화 유지, 분해 가루만 (강화 환급 없음 — 2026-08-23 사용자 결정)
    const one = salvageArtifact(content, enhanced, 'rusty-saber');
    expect(one.artifacts[0]).toMatchObject({ itemId: 'rusty-saber', enhance: 1, count: 1 });
    expect(one.wallet.dust).toBe(enhanced.wallet.dust + salvageGain);

    // 마지막 1개 분해 → 종 소멸 + 팀 프리셋 정리, 역시 환급 없음
    one.teams = [{ id: 't', name: 't', partyIds: [], artifactIds: ['rusty-saber'] }];
    const gone = salvageArtifact(content, one, 'rusty-saber');
    expect(gone.artifacts).toHaveLength(0);
    expect(gone.teams[0]!.artifactIds).toHaveLength(0);
    expect(gone.wallet.dust).toBe(one.wallet.dust + salvageGain);
  });

  it('파티 슬롯 구매 — 도감 조건 + 골드', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { gold: 50_000, partySlots: 3 });
    expect(() => buyPartySlot(content, save)).toThrow(/도감/);
    // 도감 10종 채우기
    for (const monster of content.monsterList.slice(0, 10)) {
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

  it('초월 합성은 최종 지역 서식 전설만 재료로 받는다 (2026-08-25 사용자)', () => {
    const last = content.regionList[content.regionList.length - 1]!;
    // 해안 전설 — 최종 지역이 아니므로 거절
    const coast = saveWithParty(makeCtx(), [{ id: 'leviathan-calf' }]);
    coast.save.roster[0]!.count = 3;
    expect(() => fuseMonsters(content, coast.save, fuseInput('leviathan-calf', 2), fixedCtx('s')))
      .toThrow(/서식 카드만/);

    // 최종 지역 전설 — 도전 가능 (확률 판정까지 도달한다)
    const volcanoLegend = content.monsterList.find((m) => m.rarity === 'legendary' && m.habitat === last.id)!;
    const volcano = saveWithParty(makeCtx(), [{ id: volcanoLegend.id }]);
    volcano.save.roster[0]!.count = 3;
    expect(() => fuseMonsters(content, volcano.save, fuseInput(volcanoLegend.id, 2), fixedCtx('s'))).not.toThrow();
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
  it('지역 해금 — 조건 검사와 재료 소모', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    expect(canUnlockRegion(content, save, 'whispering-woods').ok).toBe(false);
    const woodsNeed = content.regions.get('whispering-woods')!.unlock.codexCaptured!['misty-coast']!;
    for (const monster of content.monsterList.filter((m) => m.habitat === 'misty-coast').slice(0, woodsNeed)) {
      save.codex[monster.id] = { seen: true, captured: true, awakened: false };
    }
    expect(canUnlockRegion(content, save, 'whispering-woods').ok).toBe(true);
    const next = unlockRegion(content, save, 'whispering-woods');
    expect(canUnlockRegion(content, next, 'whispering-woods').ok).toBe(false); // 이미 해금

    // 늪은 재료도 필요 — 도감 조건 수는 콘텐츠에서 파생 (밸런스 변경에 흔들리지 않게)
    const marshNeed = content.regions.get('sunken-marsh')!.unlock.codexCaptured!['whispering-woods']!;
    for (const monster of content.monsterList.filter((m) => m.habitat === 'whispering-woods').slice(0, marshNeed)) {
      next.codex[monster.id] = { seen: true, captured: true, awakened: false };
    }
    expect(canUnlockRegion(content, next, 'sunken-marsh').reason).toMatch(/이슬가지/);
    const cost = content.regions.get('sunken-marsh')!.unlock.materials!;
    next.wallet.materials['dew-branch'] = cost['dew-branch']!;
    next.wallet.materials['spirit-moss'] = cost['spirit-moss']!;
    const marsh = unlockRegion(content, next, 'sunken-marsh');
    expect(marsh.wallet.materials['dew-branch']).toBe(0);
    expect(teamCount(content, marsh)).toBe(3); // 군 시스템 (2026-08-23): 숲 2군 → 늪 3군
  });
});

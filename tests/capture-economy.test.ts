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
import { artifactEnhanceCost, investedEnhanceDust, levelUpCost, monsterCostMult, monsterLevelUpCost, monsterStarUpCost, starUpCost } from '../src/core/formulas';
import { canUnlockRegion, teamCount } from '../src/core/progression';
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

  it('유물 강화·분해 — 가루 흐름과 팀 참조 정리', () => {
    const clock = makeCtx();
    const { save, artifactUids } = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: ['rusty-saber'], dust: 100 });
    const uid = artifactUids[0]!;
    const enhanced = enhanceArtifact(content, save, uid);
    expect(enhanced.artifacts[0]!.enhance).toBe(1);
    // 등급 차등 (2026-08-23): 고급 유물은 기본 10 × 1.3 = 13
    const enhance0Cost = artifactEnhanceCost(content, 'rusty-saber', 0);
    expect(enhanced.wallet.dust).toBe(100 - enhance0Cost);

    enhanced.teams = [{ id: 't', name: 't', partyIds: [], artifactUids: [uid] }];
    const salvaged = salvageArtifact(content, enhanced, uid);
    expect(salvaged.artifacts).toHaveLength(0);
    expect(salvaged.teams[0]!.artifactUids).toHaveLength(0);
    const saberRarity = content.artifacts.get('rusty-saber')!.rarity;
    // 재화 보존 원칙: 분해 가루 + 강화에 쓴 가루(+1분 = 10) 전액 환급 → 시작 100으로 복원
    expect(salvaged.wallet.dust).toBe(100 + content.balance.artifacts.dustPerSalvage[saberRarity]!);
  });

  it('원정 중인 유물은 강화·분해 불가', () => {
    const clock = makeCtx();
    const { save, partyIds, artifactUids } = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: ['rusty-saber'], dust: 100 });
    save.expeditions.push(makeExpedition('misty-coast', 'scout', partyIds, artifactUids, 'lock-test'));
    expect(() => enhanceArtifact(content, save, artifactUids[0]!)).toThrow(/원정 중/);
    expect(() => salvageArtifact(content, save, artifactUids[0]!)).toThrow(/원정 중/);
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

  it('재료는 같은 등급 2장, 전설은 불가', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }, { id: 'pearl-turtle' }]);
    save.roster.forEach((m) => { m.count = 3; });
    expect(() =>
      fuseMonsters(content, save, { materials: [{ monsterId: 'dune-pup', count: 1 }, { monsterId: 'pearl-turtle', count: 1 }] }, fixedCtx('s')),
    ).toThrow(/같은 등급/);
    expect(() => fuseMonsters(content, save, fuseInput('dune-pup', 1), fixedCtx('s'))).toThrow(/2장/);

    const legend = saveWithParty(makeCtx(), [{ id: 'leviathan-calf' }]);
    legend.save.roster[0]!.count = 3;
    expect(() => fuseMonsters(content, legend.save, fuseInput('leviathan-calf', 2), fixedCtx('s'))).toThrow(/전설/);
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

  const withArtifacts = (items: { uid: string; itemId: string; enhance?: number }[]) => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    save.artifacts = items.map((item) => ({ uid: item.uid, itemId: item.itemId, enhance: item.enhance ?? 0, substats: [] }));
    return save;
  };

  it('재료 검증 — 개수·중복·등급 혼합·전설 불가', () => {
    const save = withArtifacts([
      { uid: 'a', itemId: commonId }, { uid: 'b', itemId: commonId },
      { uid: 'u', itemId: uncommonId },
      { uid: 'l1', itemId: legendaryId }, { uid: 'l2', itemId: legendaryId },
    ]);
    expect(() => fuseArtifacts(content, save, { materialUids: ['a'] }, fixedCtx('s'))).toThrow(/2개/);
    expect(() => fuseArtifacts(content, save, { materialUids: ['a', 'a'] }, fixedCtx('s'))).toThrow(/중복/);
    expect(() => fuseArtifacts(content, save, { materialUids: ['a', 'u'] }, fixedCtx('s'))).toThrow(/같은 등급/);
    expect(() => fuseArtifacts(content, save, { materialUids: ['l1', 'l2'] }, fixedCtx('s'))).toThrow(/전설/);
  });

  it('파견 중 장착한 유물은 재료 불가', () => {
    const save = withArtifacts([{ uid: 'a', itemId: commonId }, { uid: 'b', itemId: commonId }]);
    save.expeditions.push(makeExpedition('misty-coast', 'scout', ['dune-pup'], ['a'], 'seed'));
    expect(() => fuseArtifacts(content, save, { materialUids: ['a', 'b'] }, fixedCtx('s'))).toThrow(/원정 중/);
  });

  it('성공 — 다음 등급 유물 획득 (강화 0·부옵션 규칙 적용), 재료 2개 소멸 + 강화 가루 전액 환급', () => {
    const save = withArtifacts([{ uid: 'a', itemId: commonId, enhance: 2 }, { uid: 'b', itemId: commonId }]);
    const dustBefore = save.wallet.dust;
    const okSeed = findSeed((s) => streamRng(s, 'fusion-artifact')() < content.balance.fusion.chance.common!);
    const result = fuseArtifacts(content, save, { materialUids: ['a', 'b'] }, fixedCtx(okSeed));
    expect(result.success).toBe(true);
    expect(result.save.artifacts).toHaveLength(1);
    const got = result.save.artifacts[0]!;
    expect(got.uid).toBe('fused-art');
    expect(got.enhance).toBe(0);
    const def = content.artifacts.get(got.itemId)!;
    expect(def.rarity).toBe('uncommon');
    expect(got.substats).toHaveLength(content.balance.artifacts.substatCount.uncommon!);
    // 재화 보존 원칙: 소멸한 재료의 강화 투자(+2 = 0→1, 1→2 비용) 전액 환급
    expect(result.refundedDust).toBe(investedEnhanceDust(content, commonId, 2));
    expect(result.save.wallet.dust).toBe(dustBefore + result.refundedDust);
  });

  it('실패 — 재료 중 1개는 강화 그대로 보존, 소멸분의 강화 가루만 환급', () => {
    const save = withArtifacts([{ uid: 'a', itemId: commonId, enhance: 3 }, { uid: 'b', itemId: commonId, enhance: 1 }]);
    const dustBefore = save.wallet.dust;
    const failSeed = findSeed((s) => streamRng(s, 'fusion-artifact')() >= content.balance.fusion.chance.common!);
    const result = fuseArtifacts(content, save, { materialUids: ['a', 'b'] }, fixedCtx(failSeed));
    expect(result.success).toBe(false);
    expect(result.save.artifacts).toHaveLength(1);
    const kept = result.save.artifacts[0]!;
    expect(kept.uid).toBe(result.returnedUid);
    expect(['a', 'b']).toContain(kept.uid);
    expect(kept.enhance).toBe(kept.uid === 'a' ? 3 : 1); // 보존분은 강화 유지
    const destroyedEnhance = kept.uid === 'a' ? 1 : 3;
    expect(result.refundedDust).toBe(investedEnhanceDust(content, commonId, destroyedEnhance));
    expect(result.save.wallet.dust).toBe(dustBefore + result.refundedDust);
  });
});

describe('지역 해금', () => {
  it('지역 해금 — 조건 검사와 재료 소모', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    expect(canUnlockRegion(content, save, 'whispering-woods').ok).toBe(false);
    for (const monster of content.monsterList.filter((m) => m.habitat === 'misty-coast').slice(0, 6)) {
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

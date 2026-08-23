import { describe, expect, it } from 'vitest';
import { captureChance, shouldUseLure } from '../src/core/capture';
import {
  awakenMonster,
  buyPartySlot,
  craftRecipe,
  enhanceArtifact,
  fuseMonsters,
  levelUpMonster,
  salvageArtifact,
  unlockRegion,
} from '../src/core/economy';
import { levelUpCost } from '../src/core/formulas';
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
    expect(enhanced.wallet.dust).toBe(90);

    enhanced.teams = [{ id: 't', name: 't', partyIds: [], artifactUids: [uid] }];
    const salvaged = salvageArtifact(content, enhanced, uid);
    expect(salvaged.artifacts).toHaveLength(0);
    expect(salvaged.teams[0]!.artifactUids).toHaveLength(0);
    const saberRarity = content.artifacts.get('rusty-saber')!.rarity;
    expect(salvaged.wallet.dust).toBe(90 + content.balance.artifacts.dustPerSalvage[saberRarity]!);
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
    expect(teamCount(content, marsh)).toBe(2); // 늪 해금 → 2팀
  });
});

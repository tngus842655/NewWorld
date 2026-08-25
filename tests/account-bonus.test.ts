import { describe, expect, it } from 'vitest';
import { accountBonusState, resonanceScore, trainingScore } from '../src/core/accountBonus';
import { computePartyPower } from '../src/core/combat';
import { collectTeamEffects, query, sumOf } from '../src/core/effects';
import { content, makeCtx, saveWithParty } from './helpers';

describe('계정 영구 보너스 — 조련·공명 (GDD §4.6)', () => {
  it('점수 — 조련 Σ(레벨-1)+w×Σ(성급-1), 공명 Σ강화', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [
      { id: 'dune-pup', level: 5, star: 2 },
      { id: 'bubble-crab', level: 3 },
    ], { artifacts: ['rusty-saber'] });
    save.artifacts[0]!.enhance = 3;
    const w = content.balance.accountBonus.starWeight;
    expect(trainingScore(content, save)).toBe(4 + w + 2); // (5-1) + w×(2-1) + (3-1)
    expect(resonanceScore(save)).toBe(3);
  });

  it('계단 사다리 — 점수 오름차순, 계단마다 효과 1개 이상', () => {
    for (const axis of ['training', 'resonance'] as const) {
      const tiers = content.balance.accountBonus[axis];
      expect(tiers.length).toBeGreaterThan(0);
      for (let i = 1; i < tiers.length; i++) expect(tiers[i]!.score).toBeGreaterThan(tiers[i - 1]!.score);
      for (const tier of tiers) expect(tier.effects.length).toBeGreaterThan(0);
    }
  });

  it('상태 — 문턱 도달 시 active·next가 움직인다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const tiers = content.balance.accountBonus.training;
    const fresh = accountBonusState(content, save);
    expect(fresh.training.active).toBe(0);
    expect(fresh.training.next).toBe(tiers[0]);

    save.roster[0]!.level = 1 + tiers[0]!.score; // 정확히 첫 문턱
    const crossed = accountBonusState(content, save);
    expect(crossed.training.active).toBe(1);
    expect(crossed.training.next).toBe(tiers[1] ?? null);
  });

  it('발동 — collectTeamEffects에 account: 출처로 주입', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const none = collectTeamEffects(content, save, ['dune-pup'], []);
    expect(none.effects.filter((e) => e.source.startsWith('account:'))).toHaveLength(0);

    const first = content.balance.accountBonus.training[0]!;
    save.roster[0]!.level = 1 + first.score;
    const active = collectTeamEffects(content, save, ['dune-pup'], []);
    expect(active.effects.filter((e) => e.source === 'account:training:1')).toHaveLength(first.effects.length);
  });

  it('킥 — 다른 몬스터를 키워도 파티 유효 전투력이 오른다 (계정 전역)', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }, { id: 'bubble-crab' }]);
    const region = content.regionList[0]!;
    const powerOf = (): number => {
      const fx = collectTeamEffects(content, save, ['dune-pup'], []);
      return computePartyPower(content, fx.effects, [save.roster[0]!], region, 'scout').total;
    };
    const before = powerOf();
    // 파티 밖 bubble-crab의 레벨로 조련 점수만 올린다 — 첫 계단은 공격 배수라 dune-pup 단독 전투력이 올라야 한다
    save.roster[1]!.level = 1 + content.balance.accountBonus.training[0]!.score;
    expect(powerOf()).toBeGreaterThan(before);
  });

  it('킥 — 유물 강화 총량이 포획률 합산에 반영', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: ['rusty-saber'] });
    const first = content.balance.accountBonus.resonance[0]!;
    save.artifacts[0]!.enhance = first.score;
    const fx = collectTeamEffects(content, save, ['dune-pup'], []);
    const adds = sumOf(query(fx.effects, 'captureRoll', { regionId: 'misty-shore', tier: 'scout' }), 'captureAdd');
    expect(adds).toBeGreaterThan(0);
  });

  it('킥 — 고계단 조련은 원정 조우 수를 늘린다 (expeditionSetup)', () => {
    const clock = makeCtx();
    // 첫 encounterAdd 계단 문턱을 데이터에서 찾아, 만렙 종(69점)을 필요한 만큼 깔아준다 — 밸런스 재조정에 안 깨지게
    const encTier = content.balance.accountBonus.training.find((t) => t.effects.some((e) => e.do.kind === 'encounterAdd'))!;
    const specs = content.monsterList.slice(0, Math.ceil(encTier.score / 69)).map((m) => ({ id: m.id, level: 30, star: 5 }));
    const { save } = saveWithParty(clock, specs);
    expect(trainingScore(content, save)).toBeGreaterThanOrEqual(encTier.score);
    const fx = collectTeamEffects(content, save, [specs[0]!.id], []);
    const setup = query(fx.effects, 'expeditionSetup', { regionId: 'misty-shore', tier: 'deep' });
    const added = setup.reduce((sum, a) => sum + (a.kind === 'encounterAdd' ? a.count : 0), 0);
    expect(added).toBeGreaterThanOrEqual(1);
  });
});

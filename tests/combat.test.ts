import { describe, expect, it } from 'vitest';
import { computePartyPower, enemyPower, resolveClash } from '../src/core/combat';
import { collectTeamEffects } from '../src/core/effects';
import { elementMult, levelUpCost, monsterBaseCp, statAt } from '../src/core/formulas';
import { content, makeCtx, saveWithParty } from './helpers';

const region = content.regions.get('misty-coast')!;
const volcano = content.regions.get('ashen-volcano')!;

describe('공식', () => {
  it('레벨·성급 스탯 곡선', () => {
    expect(statAt(100, 1, 1, content.balance)).toBe(100);
    expect(statAt(100, 30, 1, content.balance)).toBeCloseTo(100 * (1 + 0.08 * 29));
    expect(statAt(100, 1, 3, content.balance)).toBeCloseTo(100 * 1.25 * 1.25);
  });

  it('속성 상성 — 동일 1.3 / 유리 1.3 / 불리 0.77 / 무관 1.0, 빛↔어둠 상호 유리', () => {
    expect(elementMult('nature', 'nature', content.balance)).toBe(1.3);
    expect(elementMult('frost', 'fire', content.balance)).toBe(1.3); // 냉기가 화염을 이김
    expect(elementMult('nature', 'fire', content.balance)).toBe(0.77); // 화염이 자연을 이김
    expect(elementMult('light', 'frost', content.balance)).toBe(1);
    expect(elementMult('light', 'dark', content.balance)).toBe(1.3);
    expect(elementMult('dark', 'light', content.balance)).toBe(1.3);
  });

  it('레벨업 비용은 단조 증가', () => {
    let prev = 0;
    for (let level = 1; level < 30; level++) {
      const cost = levelUpCost(level, content.balance);
      expect(cost).toBeGreaterThan(prev);
      prev = cost;
    }
  });
});

describe('파티 전투력', () => {
  it('지역 우세 속성 유닛이 배수를 받는다', () => {
    const clock = makeCtx();
    const { save, partyUids } = saveWithParty(clock, [{ id: 'dune-pup' }]); // 자연
    const fx = collectTeamEffects(content, save, partyUids, []);
    const coastPower = computePartyPower(content, fx.effects, save.roster, region, 'standard').total;
    const volcanoPower = computePartyPower(content, fx.effects, save.roster, volcano, 'standard').total;
    // 해안(자연 지역)에선 1.3, 화산(화염 지역)에선 0.77
    expect(coastPower / volcanoPower).toBeCloseTo(1.3 / 0.77);
  });

  it('조건부 statMult는 해당 유닛에게만 적용된다 (재의 우상 — 화염 유닛 ATK)', () => {
    const clock = makeCtx();
    const withIdol = saveWithParty(clock, [{ id: 'cinder-imp' }, { id: 'bog-slime' }], { artifacts: ['ashen-idol'] });
    const fx = collectTeamEffects(content, withIdol.save, withIdol.partyUids, withIdol.artifactUids);
    const power = computePartyPower(content, fx.effects, withIdol.save.roster, volcano, 'standard');
    const imp = power.units.find((u) => u.monsterId === 'cinder-imp')!;
    const slime = power.units.find((u) => u.monsterId === 'bog-slime')!;

    const noIdol = saveWithParty(makeCtx(), [{ id: 'cinder-imp' }, { id: 'bog-slime' }]);
    const fx0 = collectTeamEffects(content, noIdol.save, noIdol.partyUids, []);
    const power0 = computePartyPower(content, fx0.effects, noIdol.save.roster, volcano, 'standard');
    const imp0 = power0.units.find((u) => u.monsterId === 'cinder-imp')!;
    const slime0 = power0.units.find((u) => u.monsterId === 'bog-slime')!;

    expect(imp.cp).toBeGreaterThan(imp0.cp); // 화염 유닛은 강해짐 (주옵션+고유)
    // 냉기 유닛은 고유(화염 한정) 효과를 못 받는다 — 주옵션 atkMult만 적용
    const slimeMainOnly = slime.cp / slime0.cp;
    const impBoost = imp.cp / imp0.cp;
    expect(impBoost).toBeGreaterThan(slimeMainOnly);
  });
});

describe('조우 판정', () => {
  it('P ≥ E면 승리, 피해는 비례·경감 적용', () => {
    const win = resolveClash(content, 1000, 500, 0, 0);
    expect(win.win).toBe(true);
    expect(win.damage).toBeCloseTo((500 / 1000) * content.balance.combat.victoryDamageK);

    const reduced = resolveClash(content, 1000, 500, 0.5, 0);
    expect(reduced.damage).toBeCloseTo(win.damage * 0.5);
  });

  it('P < E면 패주, 피해 비율은 상한 캡', () => {
    const lose = resolveClash(content, 100, 1000, 0, 0);
    expect(lose.win).toBe(false);
    expect(lose.damage).toBeCloseTo(content.balance.combat.defeatRatioCap * content.balance.combat.defeatDamageK);
  });

  it('패배 시 추가 경감(언데드 시너지)이 얹힌다', () => {
    const plain = resolveClash(content, 500, 600, 0, 0);
    const undead = resolveClash(content, 500, 600, 0, 0.2);
    expect(undead.damage).toBeCloseTo(plain.damage * 0.8);
  });

  it('전설 몬스터의 조우 난이도는 권장 CP를 상회한다', () => {
    for (const r of content.regionList) {
      const legend = content.monsters.get(r.legendary)!;
      expect(enemyPower(content, legend)).toBeGreaterThan(r.recommendedCp);
      expect(monsterBaseCp(legend, content.balance)).toBeGreaterThan(0);
    }
  });
});

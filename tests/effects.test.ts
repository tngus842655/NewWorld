import { describe, expect, it } from 'vitest';
import { collectTeamEffects, matchCondition, query, sumOf, sumStatMult, type EffectCtx } from '../src/core/effects';
import { content, makeCtx, saveWithParty } from './helpers';

const base: EffectCtx = { regionId: 'misty-coast', tier: 'standard' };

describe('조건 매칭', () => {
  it('빈 조건은 항상 참', () => {
    expect(matchCondition(undefined, base)).toBe(true);
  });
  it('region 배열은 포함 여부로 판정', () => {
    expect(matchCondition({ region: ['misty-coast'] }, base)).toBe(true);
    expect(matchCondition({ region: ['ashen-volcano'] }, base)).toBe(false);
  });
  it('encounterRarity는 이상(≥) 판정', () => {
    const ctx = { ...base, encounterRarity: 'heroic' as const };
    expect(matchCondition({ encounterRarity: 'rare' }, ctx)).toBe(true);
    expect(matchCondition({ encounterRarity: 'legendary' }, ctx)).toBe(false);
    expect(matchCondition({ encounterRarity: 'rare' }, base)).toBe(false); // ctx에 정보 없으면 불일치
  });
  it('hpBelow는 이하 판정', () => {
    expect(matchCondition({ hpBelow: 0.3 }, { ...base, hpRatio: 0.2 })).toBe(true);
    expect(matchCondition({ hpBelow: 0.3 }, { ...base, hpRatio: 0.5 })).toBe(false);
  });
  it('tier·element·tribe·encounterIndex 일치 판정', () => {
    expect(matchCondition({ tier: 'deep' }, base)).toBe(false);
    expect(matchCondition({ element: 'fire' }, { ...base, element: 'fire' })).toBe(true);
    expect(matchCondition({ tribe: 'beast' }, { ...base, tribe: 'flying' })).toBe(false);
    expect(matchCondition({ encounterIndex: 0 }, { ...base, encounterIndex: 1 })).toBe(false);
  });
});

describe('팀 효과 수집', () => {
  it('종족 2마리·3마리 시너지 발동 (야수 ATK +10% / +25%)', () => {
    const clock = makeCtx();
    const two = saveWithParty(clock, [{ id: 'dune-pup' }, { id: 'fog-lynx' }, { id: 'bubble-crab' }]);
    const fx2 = collectTeamEffects(content, two.save, two.partyIds, []);
    expect(sumStatMult(query(fx2.effects, 'computeParty', base), 'atk')).toBeCloseTo(0.1);

    const three = saveWithParty(clock, [{ id: 'dune-pup' }, { id: 'fog-lynx' }, { id: 'thorn-wolf' }]);
    const fx3 = collectTeamEffects(content, three.save, three.partyIds, []);
    expect(sumStatMult(query(fx3.effects, 'computeParty', base), 'atk')).toBeCloseTo(0.25);
  });

  it('synergyAmp가 시너지 수치를 증폭한다 (개척단의 군기 + 주옵션)', () => {
    const clock = makeCtx();
    const { save, partyIds, artifactUids } = saveWithParty(
      clock,
      [{ id: 'dune-pup' }, { id: 'fog-lynx' }, { id: 'thorn-wolf' }],
      { artifacts: ['pioneers-warbanner'] },
    );
    const fx = collectTeamEffects(content, save, partyIds, artifactUids);
    // 군기: 주옵션 amp 0.2 + 고유 amp 0.3 = 0.5 → 야수3 0.25 × 1.5 = 0.375
    expect(fx.synergyAmp).toBeCloseTo(0.5);
    const atk = query(fx.effects, 'computeParty', base).filter((a) => a.kind === 'statMult');
    const synergyAtk = atk.find((a) => a.kind === 'statMult' && Math.abs(a.value - 0.375) < 1e-9);
    expect(synergyAtk).toBeDefined();
  });

  it('유물 주옵션·고유 능력이 효과로 정규화된다 (v6: 부옵션 폐지)', () => {
    const clock = makeCtx();
    const { save, partyIds, artifactUids } = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: ['moss-charm'] });
    save.artifacts[0]!.enhance = 2;
    const fx = collectTeamEffects(content, save, partyIds, artifactUids);

    // 주옵션 captureAdd 0.05 + perEnhance 0.01×2 = 0.07 — 계정 보너스(공명) 몫은 제외하고 유물만 검증
    const artifactOnly = fx.effects.filter((e) => !e.source.startsWith('account:'));
    const capCtx: EffectCtx = { ...base, element: 'nature' };
    expect(sumOf(query(artifactOnly, 'captureRoll', capCtx), 'captureAdd')).toBeCloseTo(0.07 + 0.04); // 고유(자연 조건) 포함
    // 자연이 아니면 고유 효과 제외
    expect(sumOf(query(artifactOnly, 'captureRoll', { ...base, element: 'fire' }), 'captureAdd')).toBeCloseTo(0.07);
  });

  it('세트 2·4개 보너스가 단계적으로 붙는다 (잊힌 개척단)', () => {
    const clock = makeCtx();
    const setItems = ['tidal-blade', 'entwood-shell', 'gullwing-pennant', 'moss-charm'];
    const two = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: setItems.slice(0, 2) });
    const fxTwo = collectTeamEffects(content, two.save, two.partyIds, two.artifactUids);
    expect(fxTwo.effects.some((e) => e.source === 'set:forgotten-pioneers:2')).toBe(true);
    expect(fxTwo.effects.some((e) => e.source === 'set:forgotten-pioneers:4')).toBe(false);

    const four = saveWithParty(clock, [{ id: 'dune-pup' }], { artifacts: setItems });
    const fxFour = collectTeamEffects(content, four.save, four.partyIds, four.artifactUids);
    expect(fxFour.effects.some((e) => e.source === 'set:forgotten-pioneers:4')).toBe(true);
    expect(sumOf(query(fxFour.effects, 'crossroad', base), 'crossroadSuccessAdd')).toBeCloseTo(0.15);
  });

  it('전설 몬스터의 고유 능력이 파티 효과로 수집된다 (2026-08-24)', () => {
    const clock = makeCtx();
    // 산호거상: computeParty damageReduce 0.05 (조건 없음)
    const { save, partyIds } = saveWithParty(clock, [{ id: 'coral-colossus' }, { id: 'dune-pup' }]);
    const fx = collectTeamEffects(content, save, partyIds, []);
    expect(fx.effects.some((e) => e.source === 'monster:coral-colossus')).toBe(true);

    // 비전설만 있는 파티엔 monster: 출처 효과가 없다
    const plain = saveWithParty(clock, [{ id: 'dune-pup' }, { id: 'fog-lynx' }]);
    const fxPlain = collectTeamEffects(content, plain.save, plain.partyIds, []);
    expect(fxPlain.effects.some((e) => e.source.startsWith('monster:'))).toBe(false);
  });

  it('달성한 마일스톤 버프만 포함된다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const none = collectTeamEffects(content, save, partyIds, []);
    expect(none.effects.some((e) => e.source.startsWith('milestone:'))).toBe(false);

    save.milestones = ['coast-9'];
    const withMs = collectTeamEffects(content, save, partyIds, []);
    expect(withMs.effects.some((e) => e.source === 'milestone:coast-9')).toBe(true);
  });
});

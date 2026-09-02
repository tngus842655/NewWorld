/**
 * 파견 난이도 (GDD §5.1 난이도 선택, 2026-09-02 사용자 확정) + 갈림길 대성공 유물 기회(crossroadCrit) 구현.
 *
 * 존재 이유: 난이도는 tiers와 직교로 곱해지는 배수라 한 곳이라도 빠지면(전설 적 전투력, 갈림길 분모, 채집 재료…)
 * "고난이도가 공짜 보상"이 된다. 여기서 경로별로 배수가 실제로 걸리는지, 그리고 보통은 기존 결과와 바이트 동일한지 고정한다.
 */
import { describe, expect, it } from 'vitest';
import type { Content } from '../src/content';
import { DIFFICULTIES, TIERS, type Difficulty } from '../src/content/schema';
import { computePartyPower } from '../src/core/combat';
import { collectTeamEffects } from '../src/core/effects';
import { claimExpedition, createExpedition, difficultyAllowed, resolveExpedition } from '../src/core/expedition';
import { GameError, type CoreCtx, type Journal } from '../src/core/types';
import { T0, content, makeCtx, makeExpedition, saveWithParty, type PartySpec } from './helpers';

const STARTERS: PartySpec[] = [
  { id: 'dune-pup', level: 5 },
  { id: 'bubble-crab', level: 5 },
  { id: 'gull-imp', level: 5 },
];
const MARSH_VETERANS: PartySpec[] = [
  { id: 'frost-hydra', level: 30, star: 3 },
  { id: 'bone-colossus', level: 30, star: 2 },
  { id: 'drowned-knight', level: 30, star: 2 },
  { id: 'marsh-siren', level: 30, star: 2 },
  { id: 'mire-toad', level: 30, star: 2 },
];

/** 난이도만 다른 같은 원정을 정산한다 — 시드·파티·선택 고정 */
function resolveWith(
  c: Content,
  party: PartySpec[],
  regionId: string,
  tier: 'scout' | 'standard' | 'deep',
  seed: string,
  difficulty: Difficulty | undefined,
  choices?: ('safe' | 'risky' | null)[],
): Journal {
  const clock = makeCtx();
  const { save, partyIds } = saveWithParty(clock, party, { partySlots: Math.max(3, party.length), unlockAll: true });
  const expedition = makeExpedition(regionId, tier, partyIds, [], seed, { choices });
  if (difficulty && difficulty !== 'normal') expedition.difficulty = difficulty;
  save.expeditions.push(expedition);
  return resolveExpedition(c, save, expedition);
}

/** 적 배수만 남긴 콘텐츠 사본 — 희귀 가중·전설 가산이 스폰 선택을 바꾸면 조우열이 달라져 배수 검증이 흐려진다 */
function contentWith(overrides: Partial<Record<Difficulty, Partial<Content['balance']['difficulties']['hard']>>>): Content {
  const difficulties = { ...content.balance.difficulties };
  for (const [key, patch] of Object.entries(overrides) as [Difficulty, Partial<Content['balance']['difficulties']['hard']>][]) {
    difficulties[key] = { ...difficulties[key], ...patch };
  }
  return { ...content, balance: { ...content.balance, difficulties } };
}

const encounters = (j: Journal) => j.entries.filter((e) => e.type === 'encounter');

describe('파견 난이도 — 데이터 불변식', () => {
  it('보통은 항등이고 어려움→극한으로 적·보상·가중·전설이 단조 증가한다', () => {
    const d = content.balance.difficulties;
    expect(d.normal).toEqual({ enemyMult: 1, goldMult: 1, rareWeightAdd: 0, legendaryAdd: 0 });
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const prev = d[DIFFICULTIES[i - 1]!];
      const cur = d[DIFFICULTIES[i]!];
      expect(cur.enemyMult, `${DIFFICULTIES[i]} 적 배수`).toBeGreaterThan(prev.enemyMult);
      expect(cur.goldMult, `${DIFFICULTIES[i]} 골드 배수`).toBeGreaterThan(prev.goldMult);
      expect(cur.rareWeightAdd).toBeGreaterThanOrEqual(prev.rareWeightAdd);
      expect(cur.legendaryAdd).toBeGreaterThanOrEqual(prev.legendaryAdd);
    }
    // 보상 배수가 적 배수를 넘으면 "어려운 쪽이 시간당 무조건 이득"이 되어 보통이 죽는다 (GDD §5.1)
    for (const key of DIFFICULTIES) expect(d[key].goldMult).toBeLessThanOrEqual(d[key].enemyMult);
  });

  it('난이도 선택은 탐사·원정만 (2026-09-02 사용자 결정 ②)', () => {
    expect(content.balance.difficultyTiers).toEqual(['extended', 'deep']);
    for (const tier of TIERS) {
      expect(difficultyAllowed(content, tier, undefined)).toBe(true);
      expect(difficultyAllowed(content, tier, 'normal')).toBe(true);
      expect(difficultyAllowed(content, tier, 'hard')).toBe(content.balance.difficultyTiers.includes(tier));
    }
  });
});

describe('파견 생성', () => {
  const ctx = (): CoreCtx => ({ now: () => T0, newSeed: () => 'diff-seed', newUid: () => 'diff-uid' });

  it('정찰·조사에 난이도를 붙이면 거절, 탐사·원정은 저장된다 (보통은 필드 없음)', () => {
    const { save, partyIds } = saveWithParty(makeCtx(), STARTERS, { unlockAll: true });
    const base = { regionId: 'misty-coast', partyIds, artifactIds: [] as string[] };
    for (const tier of ['scout', 'standard'] as const) {
      let thrown: unknown;
      try {
        createExpedition(content, save, { ...base, tier, difficulty: 'hard' }, ctx());
      } catch (error) {
        thrown = error;
      }
      expect(thrown, tier).toBeInstanceOf(GameError);
      expect((thrown as GameError).code).toBe('difficulty-tier');
    }
    const hard = createExpedition(content, save, { ...base, tier: 'deep', difficulty: 'extreme' }, ctx());
    expect(hard.expedition.difficulty).toBe('extreme');
    const normal = createExpedition(content, save, { ...base, tier: 'extended', difficulty: 'normal' }, ctx());
    expect(normal.expedition.difficulty, '보통은 세이브에 남기지 않는다 (구 세이브와 동일 형태)').toBeUndefined();
  });
});

describe('정산 — 배수가 실제로 걸리는 경로', () => {
  // 희귀 가중·전설 가산을 0으로 두고 적 배수·보상 배수만 검증 (조우열이 같아진다)
  const isolated = contentWith({ hard: { rareWeightAdd: 0, legendaryAdd: 0 } });
  const mult = isolated.balance.difficulties.hard;

  it('적 전투력 × enemyMult, 승리 골드 × goldMult — 조우열은 동일 (재료는 불변)', () => {
    for (const seed of ['d1', 'd2', 'd3']) {
      const normal = resolveWith(isolated, MARSH_VETERANS, 'sunken-marsh', 'deep', seed, undefined, ['safe', 'safe']);
      const hard = resolveWith(isolated, MARSH_VETERANS, 'sunken-marsh', 'deep', seed, 'hard', ['safe', 'safe']);
      expect(hard.difficulty).toBe('hard');
      expect(normal.difficulty).toBeUndefined();
      const n = encounters(normal);
      const h = encounters(hard);
      expect(h.map((e) => e.monsterId), seed).toEqual(n.map((e) => e.monsterId));
      expect(h.length).toBeGreaterThan(5);
      for (let i = 0; i < h.length; i++) {
        const a = n[i]!;
        const b = h[i]!;
        expect(b.enemyPower).toBeCloseTo(a.enemyPower * mult.enemyMult, -1);
        if (a.result === 'win' && b.result === 'win' && a.gold > 0) {
          expect(b.gold / a.gold).toBeCloseTo(mult.goldMult, 1);
        }
      }
      expect(hard.totals.materials, '재료는 난이도 배수 없음').toEqual(normal.totals.materials);
    }
  });

  it('보통(undefined)은 난이도 도입 전 결과와 바이트 동일 — 필드가 없으면 배수 1', () => {
    const j1 = resolveWith(content, MARSH_VETERANS, 'sunken-marsh', 'deep', 'same', undefined, ['risky', 'safe']);
    const j2 = resolveWith(content, MARSH_VETERANS, 'sunken-marsh', 'deep', 'same', 'normal', ['risky', 'safe']);
    expect(JSON.stringify(j2)).toBe(JSON.stringify(j1));
  });

  it('보통을 여유 있게 넘는 파티도 극한을 고르면 전멸이 늘어난다 (적 배수는 실제 위험)', () => {
    // 만렙 스타터 3마리는 물안개 해안 원정 권장(290)의 몇 배라 보통은 안전하지만, 극한(×6)은 그 위다
    const party = STARTERS.map((p) => ({ ...p, level: 30 }));
    let wipesNormal = 0;
    let wipesExtreme = 0;
    for (let i = 0; i < 40; i++) {
      if (resolveWith(content, party, 'misty-coast', 'deep', `w${i}`, undefined).wiped) wipesNormal++;
      if (resolveWith(content, party, 'misty-coast', 'deep', `w${i}`, 'extreme').wiped) wipesExtreme++;
    }
    expect(wipesNormal).toBeLessThan(40);
    expect(wipesExtreme).toBeGreaterThan(wipesNormal);
  });

  it('전설 가산 — deep에서 legendaryAdd가 조우 확률을 올린다 (극한을 98%로 강제한 사본)', () => {
    const forced = contentWith({ extreme: { legendaryAdd: 0.98, rareWeightAdd: 0 } });
    let legendNormal = 0;
    let legendExtreme = 0;
    const isLegend = (j: Journal) => encounters(j).some((e) => content.monsters.get(e.monsterId)!.rarity === 'legendary');
    for (let i = 0; i < 40; i++) {
      if (isLegend(resolveWith(forced, MARSH_VETERANS, 'sunken-marsh', 'deep', `l${i}`, undefined))) legendNormal++;
      if (isLegend(resolveWith(forced, MARSH_VETERANS, 'sunken-marsh', 'deep', `l${i}`, 'extreme'))) legendExtreme++;
    }
    expect(legendNormal).toBeLessThanOrEqual(5); // 기본 2%
    expect(legendExtreme).toBeGreaterThanOrEqual(35); // 2% + 98%
    // 기본 확률이 0인 티어(조사)는 가산도 무효 — rng 호출 수가 바뀌면 진행 중 원정의 결정론이 깨진다
    let legendStandard = 0;
    for (let i = 0; i < 20; i++) {
      // extended가 아닌 standard는 난이도 자체가 불가하므로 makeExpedition 뒤에 직접 붙여 코어의 방어만 본다
      const clock = makeCtx();
      const { save, partyIds } = saveWithParty(clock, MARSH_VETERANS, { partySlots: 5, unlockAll: true });
      const expedition = makeExpedition('sunken-marsh', 'standard', partyIds, [], `s${i}`);
      expedition.difficulty = 'extreme';
      save.expeditions.push(expedition);
      if (isLegend(resolveExpedition(forced, save, expedition))) legendStandard++;
    }
    expect(legendStandard).toBe(0);
  });

  it('갈림길 위험 판정 분모에 적 배수 — 중간 전투력 파티는 극한에서 성공률이 바닥으로 떨어진다', () => {
    // 물안개 해안 기준 CP 100: P/(100×1.15)가 0.6~0.85 구간이 되는 스타터 레벨을 고른다 (보통 = 그 값, 극한 = /6 → 바닥 0.15)
    const region = content.regions.get('misty-coast')!;
    let level = 1;
    let ratio = 0;
    for (level = 1; level <= 30; level++) {
      const clock = makeCtx();
      const { save, partyIds } = saveWithParty(clock, STARTERS.map((p) => ({ ...p, level })), { unlockAll: true });
      const party = partyIds.map((id) => save.roster.find((m) => m.monsterId === id)!);
      const power = computePartyPower(content, collectTeamEffects(content, save, partyIds, []).effects, party, region, 'standard').total;
      ratio = power / (region.recommendedCp * content.balance.crossroad.riskyCheckRatio);
      if (ratio >= 0.6 && ratio <= 0.85) break;
    }
    expect(ratio, '검증 가능한 전투력 구간을 찾아야 한다').toBeGreaterThanOrEqual(0.6);
    const party = STARTERS.map((p) => ({ ...p, level }));
    let okNormal = 0;
    let okExtreme = 0;
    // deep은 갈림길 2회 — 위험만 고른다. 극한은 적도 6배라 전멸이 잦지만 첫 갈림길은 계획 중앙 전이라 대체로 도달한다
    const riskyOk = (j: Journal) => j.entries.filter((e) => e.type === 'crossroad' && e.choice === 'risky').map((e) => (e.type === 'crossroad' ? e.success : false));
    for (let i = 0; i < 150; i++) {
      okNormal += riskyOk(resolveWith(content, party, 'misty-coast', 'deep', `x${i}`, undefined, ['risky', 'risky'])).filter(Boolean).length;
      okExtreme += riskyOk(resolveWith(content, party, 'misty-coast', 'deep', `x${i}`, 'extreme', ['risky', 'risky'])).filter(Boolean).length;
    }
    expect(okNormal).toBeGreaterThan(okExtreme * 2);
  });
});

describe('갈림길 대성공 유물 기회 — artifacts.sources.crossroadCrit (2026-09-02 구현)', () => {
  it('유물 보상이 없는 이벤트의 위험 성공에서 15% 확률로 유물이 붙는다 (확률 시트 고지값)', () => {
    let successes = 0;
    let withArtifact = 0;
    for (let i = 0; i < 400; i++) {
      const journal = resolveWith(content, MARSH_VETERANS, 'sunken-marsh', 'standard', `c${i}`, undefined, ['risky']);
      const entry = journal.entries.find((e) => e.type === 'crossroad');
      if (!entry || entry.type !== 'crossroad' || !entry.success) continue;
      const event = content.events.crossroads.find((c) => c.id === entry.eventId)!;
      if (event.risky.success.some((r) => r.kind === 'artifactRoll')) continue; // 이벤트 자체 유물은 제외
      successes++;
      if (entry.rewards.some((r) => r.kind === 'artifact')) withArtifact++;
    }
    expect(successes).toBeGreaterThan(100);
    const rate = withArtifact / successes;
    const expected = content.balance.artifacts.sources.crossroadCrit;
    expect(rate).toBeGreaterThan(expected * 0.5);
    expect(rate).toBeLessThan(expected * 1.6);
  });

  it('유물이 붙은 갈림길의 유물은 정산 총계·지급에 포함된다', () => {
    for (let i = 0; i < 400; i++) {
      const clock = makeCtx();
      const { save, partyIds } = saveWithParty(clock, MARSH_VETERANS, { partySlots: 5, unlockAll: true });
      const expedition = makeExpedition('sunken-marsh', 'standard', partyIds, [], `k${i}`, { choices: ['risky'] });
      save.expeditions.push(expedition);
      const journal = resolveExpedition(content, save, expedition);
      const entry = journal.entries.find((e) => e.type === 'crossroad');
      if (!entry || entry.type !== 'crossroad' || !entry.rewards.some((r) => r.kind === 'artifact')) continue;
      expect(journal.totals.artifacts.length).toBeGreaterThanOrEqual(1);
      clock.set(expedition.endsAt + 1);
      const claimed = claimExpedition(content, save, expedition.id, clock.ctx);
      expect(claimed.save.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(claimed.save.journalArchive[0]!.difficulty).toBeUndefined();
      return;
    }
    throw new Error('400시드 안에 갈림길 유물 케이스를 찾지 못함');
  });
});

describe('정산 요약', () => {
  it('난이도가 일지와 아카이브 요약에 남는다 (보통은 필드 없음)', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, MARSH_VETERANS, { partySlots: 5, unlockAll: true });
    const expedition = makeExpedition('sunken-marsh', 'deep', partyIds, [], 'arch-1', { choices: ['safe', 'safe'] });
    expedition.difficulty = 'hard';
    save.expeditions.push(expedition);
    clock.set(expedition.endsAt + 1);
    const { journal, save: next } = claimExpedition(content, save, expedition.id, clock.ctx);
    expect(journal.difficulty).toBe('hard');
    expect(next.journalArchive[0]!.difficulty).toBe('hard');
  });
});

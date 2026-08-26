import { describe, expect, it } from 'vitest';
import {
  accelerateExpedition,
  chooseCrossroad,
  claimExpedition,
  createExpedition,
  resolveExpedition,
  rollArtifact,
  useHourglass,
} from '../src/core/expedition';
import { streamRng } from '../src/core/rng';
import { GameError, type Journal, type SaveState } from '../src/core/types';
import { content, findSeed, makeCtx, makeExpedition, saveWithParty, T0, type PartySpec } from './helpers';

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

function resolveWith(party: PartySpec[], regionId: string, tier: 'scout' | 'standard' | 'deep', seed: string, opts: {
  artifacts?: string[];
  choices?: ('safe' | 'risky' | null)[];
  lures?: number;
  mutate?: (save: SaveState) => void;
} = {}): Journal {
  const clock = makeCtx();
  const { save, partyIds, artifactUids } = saveWithParty(clock, party, {
    artifacts: opts.artifacts,
    partySlots: Math.max(3, party.length),
    unlockAll: true,
  });
  opts.mutate?.(save);
  const expedition = makeExpedition(regionId, tier, partyIds, artifactUids, seed, {
    choices: opts.choices,
    luresLoaded: opts.lures ?? 0,
  });
  save.expeditions.push(expedition);
  return resolveExpedition(content, save, expedition);
}

const encounterEntries = (j: Journal) => j.entries.filter((e) => e.type === 'encounter');

describe('결정론', () => {
  it('같은 (시드, 선택, 상태)면 일지가 완전히 같다', () => {
    const a = resolveWith(STARTERS, 'misty-coast', 'standard', 'det-1', { choices: ['risky'] });
    const b = resolveWith(STARTERS, 'misty-coast', 'standard', 'det-1', { choices: ['risky'] });
    expect(a).toEqual(b);
  });

  it('선택이 다르면 갈림길 결과만 갈린다 (같은 조우 시퀀스)', () => {
    const safe = resolveWith(STARTERS, 'misty-coast', 'standard', 'det-2', { choices: ['safe'] });
    const risky = resolveWith(STARTERS, 'misty-coast', 'standard', 'det-2', { choices: ['risky'] });
    const kinds = (j: Journal) => j.entries.filter((e) => e.type !== 'crossroad' && e.type !== 'wipe').map((e) => e.type);
    // 전멸 시점이 갈릴 수 있으므로 공통 접두 구간만 비교
    const len = Math.min(kinds(safe).length, kinds(risky).length);
    expect(kinds(safe).slice(0, len)).toEqual(kinds(risky).slice(0, len));
    const crossroadOf = (j: Journal) => j.entries.find((e) => e.type === 'crossroad');
    expect(crossroadOf(safe)).toMatchObject({ choice: 'safe', success: true });
    expect(crossroadOf(risky)!.choice).toBe('risky');
  });

  it('일지 스냅샷 — 정찰(해안·스타터)', () => {
    expect(resolveWith(STARTERS, 'misty-coast', 'scout', 'snap-scout')).toMatchSnapshot();
  });

  it('일지 스냅샷 — 심층(늪·정예 5인 + 유물)', () => {
    const journal = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'deep', 'snap-deep', {
      artifacts: ['grave-scythe', 'obsidian-wall', 'ashen-idol', 'willo-lantern'],
      choices: ['risky', 'safe'],
      lures: 3,
    });
    expect(journal).toMatchSnapshot();
  });
});

describe('유물 고유 능력 (훅 통합)', () => {
  it('포식자의 송곳니 — 첫 몬스터 조우는 자동 승리', () => {
    const seed = findSeed((s) => encounterEntries(resolveWith(STARTERS, 'misty-coast', 'scout', s)).length > 0);
    const journal = resolveWith(STARTERS, 'misty-coast', 'scout', seed, { artifacts: ['predators-fang'] });
    const first = encounterEntries(journal).find((e) => e.type === 'encounter' && e.index === 0)!;
    expect(first).toMatchObject({ result: 'autowin' });
  });

  it('밀렵꾼의 올가미 — 포획 실패 시 재시도가 발생한다', () => {
    const seed = findSeed((s) => {
      const journal = resolveWith(STARTERS, 'misty-coast', 'standard', s, { artifacts: ['poachers-snare'] });
      return journal.entries.some((e) => e.type === 'encounter' && e.capture?.retried === true);
    });
    expect(seed).toBeTruthy();
  });

  it('시간모래 호리병 — 파견 시간 25% 단축', () => {
    const clock = makeCtx();
    const { save, partyIds, artifactUids } = saveWithParty(clock, STARTERS, { artifacts: ['hourglass-flask'] });
    const { expedition } = createExpedition(
      content,
      save,
      { regionId: 'misty-coast', tier: 'scout', partyIds, artifactIds: artifactUids },
      clock.ctx,
    );
    expect(expedition.endsAt - expedition.startedAt).toBe(Math.round(15 * 60_000 * 0.75));
  });

  it('폭풍인도자의 뿔피리 — 조우 +2, 함정 빈도 증가', () => {
    const countOf = (artifacts: string[] | undefined, type: 'trap' | 'all', seed: string) => {
      const journal = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'scout', seed, { artifacts });
      const slots = journal.entries.filter((e) => e.type !== 'crossroad' && e.type !== 'wipe' && e.type !== 'clearBox');
      return type === 'all' ? slots.length : slots.filter((e) => e.type === 'trap').length;
    };
    // 정예 파티는 전멸하지 않으므로 슬롯 수가 그대로 관측된다
    expect(countOf(['stormcallers-horn'], 'all', 'horn-1')).toBe(countOf(undefined, 'all', 'horn-1') + 2);
    // 함정 가중 2배 — 여러 시드 합산으로 확인 (결정론적 고정 시드 집합)
    let withHorn = 0;
    let without = 0;
    for (let i = 0; i < 40; i++) {
      withHorn += countOf(['stormcallers-horn'], 'trap', `horn-m${i}`);
      without += countOf(undefined, 'trap', `horn-m${i}`);
    }
    expect(withHorn).toBeGreaterThan(without);
  });

  it('심연의 초롱 — 심층에서 에픽 이상 출현 가중 증가', () => {
    const epicSeen = (artifacts: string[] | undefined, seed: string) => {
      const journal = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'deep', seed, { artifacts });
      return journal.totals.seenMonsterIds.filter((id) => {
        const rarity = content.monsters.get(id)!.rarity;
        return rarity === 'heroic' || rarity === 'legendary';
      }).length;
    };
    let withLantern = 0;
    let without = 0;
    for (let i = 0; i < 30; i++) {
      withLantern += epicSeen(['abyssal-lantern'], `lantern-${i}`);
      without += epicSeen(undefined, `lantern-${i}`);
    }
    expect(withLantern).toBeGreaterThan(without);
  });

  it('여명의 나침반 — 갈림길 위험 실패에도 절반 보상 (유물 제외)', () => {
    const failedCrossroad = (j: Journal) => j.entries.find((e) => e.type === 'crossroad' && e.choice === 'risky' && !e.success);
    const seed = findSeed((s) => {
      const journal = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'standard', s, { choices: ['risky'] });
      const entry = failedCrossroad(journal);
      if (entry?.type !== 'crossroad') return false;
      // 성공 보상이 유물뿐인 이벤트(고대의 문)는 절반 보상이 비므로 제외
      const event = content.events.crossroads.find((c) => c.id === entry.eventId)!;
      return event.risky.success.some((r) => r.kind !== 'artifactRoll');
    });
    const plain = failedCrossroad(resolveWith(MARSH_VETERANS, 'sunken-marsh', 'standard', seed, { choices: ['risky'] }))!;
    expect(plain.type).toBe('crossroad');
    if (plain.type === 'crossroad') expect(plain.rewards).toHaveLength(0);

    const withCompass = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'standard', seed, {
      choices: ['risky'],
      artifacts: ['dawn-compass'],
    });
    const salvagedEntry = failedCrossroad(withCompass);
    // 나침반 장착 시에도 같은 갈림길이 실패해야 비교 가능 — 성공률 로직은 동일하므로 보장됨
    expect(salvagedEntry).toBeDefined();
    if (salvagedEntry?.type === 'crossroad') {
      expect(salvagedEntry.salvaged).toBe(true);
      expect(salvagedEntry.rewards.length).toBeGreaterThan(0);
      expect(salvagedEntry.rewards.every((r) => r.kind !== 'artifact')).toBe(true);
    }
  });

  it('검은 심연 4세트 — 전멸 반입 비율 50% → 75%', () => {
    const weak: PartySpec[] = [{ id: 'dune-pup' }, { id: 'bubble-crab' }];
    const seed = findSeed((s) => {
      const journal = resolveWith(weak, 'sunken-marsh', 'standard', s);
      return journal.wiped && journal.totals.gold > 10;
    });
    const plain = resolveWith(weak, 'sunken-marsh', 'standard', seed);
    const withSet = resolveWith(weak, 'sunken-marsh', 'standard', seed, {
      artifacts: ['grave-scythe', 'obsidian-wall', 'ashen-idol', 'willo-lantern'],
    });
    expect(withSet.wiped).toBe(true);
    expect(withSet.totals.gold).toBeGreaterThan(plain.totals.gold);
  });
});

describe('시너지 (훅 통합)', () => {
  it('비행 3마리 — 함정 완전 회피 + 조우 +1', () => {
    const flyers: PartySpec[] = [
      { id: 'gale-owl', level: 30, star: 3 },
      { id: 'glow-moth', level: 30, star: 3 },
      { id: 'moss-drake', level: 30, star: 3 },
    ];
    const seed = findSeed((s) => {
      const journal = resolveWith(flyers, 'whispering-woods', 'standard', s);
      return journal.entries.some((e) => e.type === 'trap');
    });
    const journal = resolveWith(flyers, 'whispering-woods', 'standard', seed);
    for (const entry of journal.entries) {
      if (entry.type === 'trap') expect(entry.avoided).toBe(true);
    }
    // 비교군도 같은 조련 계단(★3 동일)이어야 계정 조우 보너스가 상쇄되고 시너지 몫 +1만 남는다 (GDD §4.6)
    const noSynergy = resolveWith([flyers[0]!, { id: 'thorn-wolf', level: 30, star: 3 }, { id: 'dew-fairy', level: 30, star: 3 }], 'whispering-woods', 'standard', seed);
    const slotCount = (j: Journal) => j.entries.filter((e) => e.type !== 'crossroad' && e.type !== 'wipe').length;
    expect(slotCount(journal)).toBe(slotCount(noSynergy) + 1);
  });

  it('정령 3마리 — 승리 피해를 회복이 상쇄해 HP가 유지된다', () => {
    const spirits: PartySpec[] = [
      { id: 'salt-sprite', level: 30, star: 3 },
      { id: 'dew-fairy', level: 30, star: 3 },
      { id: 'spore-shaman', level: 30, star: 3 },
    ];
    const seed = findSeed((s) => encounterEntries(resolveWith(spirits, 'misty-coast', 'scout', s)).length >= 2);
    const journal = resolveWith(spirits, 'misty-coast', 'scout', seed);
    const wins = encounterEntries(journal).filter((e) => e.type === 'encounter' && e.result !== 'flee');
    // 커먼 상대 피해 ≪ 회복 0.12 → 승리 후 HP는 항상 만피 유지
    for (const win of wins) {
      if (win.type === 'encounter') expect(win.hpAfter).toBe(1);
    }
  });

  it('언데드 3마리 — 전멸 시 1회 부활 후 원정을 잇는다', () => {
    const undead: PartySpec[] = [{ id: 'rot-rat' }, { id: 'gravemoss-crawler' }, { id: 'drowned-knight' }];
    const seed = findSeed((s) => {
      const journal = resolveWith(undead, 'ashen-volcano', 'standard', s);
      return journal.entries.some((e) => e.type === 'wipe');
    });
    const journal = resolveWith(undead, 'ashen-volcano', 'standard', seed);
    const wipes = journal.entries.filter((e) => e.type === 'wipe');
    expect(wipes[0]).toMatchObject({ revived: true });
  });
});

describe('드랍과 연민(pity)', () => {
  it('계정 첫 보물 조우는 유물 확정', () => {
    const seed = findSeed((s) => {
      const journal = resolveWith(STARTERS, 'misty-coast', 'standard', s);
      return journal.entries.some((e) => e.type === 'treasure');
    });
    const fresh = resolveWith(STARTERS, 'misty-coast', 'standard', seed);
    const firstTreasure = fresh.entries.find((e) => e.type === 'treasure')!;
    expect(firstTreasure.type === 'treasure' && firstTreasure.artifact).toBeDefined();

    // 이미 받은 계정이면 확률 드랍 — 같은 시드에서 미드랍인 케이스가 존재
    const noPitySeed = findSeed((s) => {
      const journal = resolveWith(STARTERS, 'misty-coast', 'standard', s, {
        mutate: (save) => {
          save.profile.flags['firstArtifactDropped'] = true;
        },
      });
      const treasure = journal.entries.find((e) => e.type === 'treasure');
      return treasure?.type === 'treasure' && treasure.artifact === undefined;
    });
    expect(noPitySeed).toBeTruthy();
  });

  it('심층 완주 상자 — 완주 시 확정 1개, 전멸 시 없음', () => {
    const done = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'deep', 'box-1');
    expect(done.wiped).toBe(false);
    expect(done.entries.some((e) => e.type === 'clearBox')).toBe(true);

    const weakSeed = findSeed((s) => resolveWith([{ id: 'dune-pup' }], 'sunken-marsh', 'deep', s).wiped);
    const wiped = resolveWith([{ id: 'dune-pup' }], 'sunken-marsh', 'deep', weakSeed);
    expect(wiped.entries.some((e) => e.type === 'clearBox')).toBe(false);
  });

  it('전설 몬스터는 심층에서만 출현한다', () => {
    const legendSeed = findSeed((s) => {
      const journal = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'deep', s);
      return journal.totals.seenMonsterIds.includes('lich-of-depths');
    });
    expect(legendSeed).toBeTruthy();
    // 정찰·원정에선 절대 등장하지 않음 (40개 시드 표본)
    for (let i = 0; i < 40; i++) {
      const journal = resolveWith(MARSH_VETERANS, 'sunken-marsh', 'standard', `nolegend-${i}`);
      expect(journal.totals.seenMonsterIds).not.toContain('lich-of-depths');
    }
  });

  it('rollArtifact — 모든 등급이 추첨 목록에 포함된다 (uncommon 누락 회귀 방지)', () => {
    const rng = streamRng('roll-test', 'loot');
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const drop = rollArtifact(content, rng);
      const def = content.artifacts.get(drop.itemId)!;
      seen.add(def.rarity);
    }
    for (const rarity of ['common', 'uncommon', 'rare', 'heroic'] as const) {
      if (content.balance.artifacts.dropRarity[rarity] > 0) expect(seen).toContain(rarity);
    }
  });
});

describe('파견 생성 검증', () => {
  it('잠긴 지역·중복 편성·원정 중 몬스터·슬롯 중복·팀 한도를 막는다', () => {
    const clock = makeCtx();
    const { save, partyIds, artifactUids } = saveWithParty(clock, STARTERS, {
      artifacts: ['rusty-saber', 'keen-cutlass'],
    });
    const input = { regionId: 'misty-coast', tier: 'scout' as const, partyIds, artifactIds: [] };

    expect(() => createExpedition(content, save, { ...input, regionId: 'ashen-volcano' }, clock.ctx)).toThrow(/잠겨/);
    expect(() => createExpedition(content, save, { ...input, partyIds: [partyIds[0]!, partyIds[0]!] }, clock.ctx)).toThrow(/두 번/);
    // 무기 슬롯 중복 (녹슨 세이버 + 예리한 커틀러스)
    expect(() => createExpedition(content, save, { ...input, artifactIds: artifactUids }, clock.ctx)).toThrow(/같은 슬롯/);

    const { save: dispatched } = createExpedition(content, save, input, clock.ctx);
    // 같은 몬스터 재파견 불가 + 1팀 한도
    expect(() => createExpedition(content, dispatched, input, clock.ctx)).toThrow(GameError);
  });

  it('미끼는 최대 3개까지 적재되고 지갑에서 차감된다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, STARTERS, { lures: 5 });
    const { save: next, expedition } = createExpedition(
      content,
      save,
      { regionId: 'misty-coast', tier: 'standard', partyIds, artifactIds: [] },
      clock.ctx,
    );
    expect(expedition.luresLoaded).toBe(3);
    expect(next.wallet.lures).toBe(2);
  });
});

describe('원정 시간 가속', () => {
  it('시간축만 당기고 총 소요시간은 유지, 남은 시간 초과는 지금 귀환으로 클램프', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, STARTERS);
    const { save: dispatched, expedition } = createExpedition(
      content,
      save,
      { regionId: 'misty-coast', tier: 'standard', partyIds, artifactIds: [] },
      clock.ctx,
    );
    const duration = expedition.endsAt - expedition.startedAt;

    const after = accelerateExpedition(dispatched, expedition.id, 30 * 60_000, clock.ctx.now());
    const accelerated = after.expeditions.find((e) => e.id === expedition.id)!;
    expect(accelerated.endsAt).toBe(expedition.endsAt - 30 * 60_000);
    expect(accelerated.endsAt - accelerated.startedAt).toBe(duration);

    const rushed = accelerateExpedition(dispatched, expedition.id, duration * 10, clock.ctx.now());
    expect(rushed.expeditions.find((e) => e.id === expedition.id)!.endsAt).toBe(clock.ctx.now());

    // 가속해도 정산 결과는 가속 전과 동일하다 (시드 결정론)
    clock.advance(1);
    const { journal } = claimExpedition(content, rushed, expedition.id, clock.ctx);
    expect(journal).toEqual(resolveExpedition(content, dispatched, expedition));
  });

  it('없는(또는 정산된) 원정 가속은 거부한다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, STARTERS);
    expect(() => accelerateExpedition(save, 'no-such', 60_000, clock.ctx.now())).toThrow(/진행 중인 원정/);
  });
});

describe('모래시계 사용', () => {
  function dispatchedWith(hourglasses: Record<string, number>) {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, STARTERS);
    save.wallet.hourglasses = hourglasses;
    const { save: dispatched, expedition } = createExpedition(
      content,
      save,
      { regionId: 'misty-coast', tier: 'standard', partyIds: STARTERS.map((s) => s.id), artifactIds: [] },
      clock.ctx,
    );
    return { clock, dispatched, expedition };
  }

  it('1개 소모하고 단축량만큼 당긴다 — 남은 시간 초과면 finished', () => {
    const { clock, dispatched, expedition } = dispatchedWith({ 'hourglass-15': 2, 'hourglass-480': 1 });
    const result = useHourglass(content, dispatched, expedition.id, 'hourglass-15', clock.ctx.now());
    expect(result.save.wallet.hourglasses['hourglass-15']).toBe(1);
    expect(result.finished).toBe(false);
    expect(result.save.expeditions[0]!.endsAt).toBe(expedition.endsAt - 15 * 60_000);

    // 8시간짜리는 2시간 원정을 끝내버린다 (클램프 — 정확히 지금 귀환)
    const big = useHourglass(content, dispatched, expedition.id, 'hourglass-480', clock.ctx.now());
    expect(big.finished).toBe(true);
    expect(big.save.expeditions[0]!.endsAt).toBe(clock.ctx.now());
  });

  it('없는 모래시계·미보유·끝난 원정은 거부한다', () => {
    const { clock, dispatched, expedition } = dispatchedWith({ 'hourglass-15': 1 });
    expect(() => useHourglass(content, dispatched, expedition.id, 'no-such', clock.ctx.now())).toThrow(/없는 모래시계/);
    expect(() => useHourglass(content, dispatched, expedition.id, 'hourglass-60', clock.ctx.now())).toThrow(/없습니다/);
    clock.set(expedition.endsAt + 1);
    expect(() => useHourglass(content, dispatched, expedition.id, 'hourglass-15', clock.ctx.now())).toThrow(/이미 돌아온/);
  });
});

describe('귀환 정산', () => {
  it('완료 전 정산은 거부, 완료 후 재화·도감·유물·미끼가 반영된다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, STARTERS, { lures: 2 });
    const { save: dispatched, expedition } = createExpedition(
      content,
      save,
      { regionId: 'misty-coast', tier: 'scout', partyIds, artifactIds: [] },
      clock.ctx,
    );
    expect(() => claimExpedition(content, dispatched, expedition.id, clock.ctx)).toThrow(/돌아오지/);

    clock.set(expedition.endsAt + 1);
    const { save: after, journal, newMilestones } = claimExpedition(content, dispatched, expedition.id, clock.ctx);
    // 정산 중 달성된 업적 보상(골드)도 함께 지급된다 (지역별 10계단 확장 후 초반 계단이 자주 걸림)
    const milestoneGold = newMilestones.reduce(
      (sum, id) => sum + (content.milestones.find((m) => m.id === id)?.reward.gold ?? 0), 0);
    expect(after.wallet.gold).toBe(dispatched.wallet.gold + journal.totals.gold + milestoneGold);
    expect(after.expeditions).toHaveLength(0);
    expect(after.journalArchive[0]).toMatchObject({ expeditionId: expedition.id, wiped: journal.wiped });
    // 풀 일지는 정산 시점 그대로 보관된다 (재열람 — 정산 후엔 시드로 재생성 불가)
    expect(after.journalArchive[0]!.journal).toEqual(journal);
    expect(after.roster.length).toBe(dispatched.roster.length + journal.totals.capturedMonsterIds.length);
    for (const id of journal.totals.capturedMonsterIds) {
      expect(after.codex[id]).toMatchObject({ captured: true });
    }
    expect(after.wallet.lures).toBe(
      dispatched.wallet.lures + expedition.luresLoaded - journal.totals.luresUsed + journal.totals.luresGained,
    );
    // 정산은 resolve와 동일한 결정론 결과를 쓴다
    expect(journal).toEqual(resolveExpedition(content, dispatched, expedition));
  });

  it('갈림길 선택 기록이 정산에 반영된다', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, STARTERS);
    const { save: dispatched, expedition } = createExpedition(
      content,
      save,
      { regionId: 'misty-coast', tier: 'standard', partyIds, artifactIds: [] },
      clock.ctx,
    );
    const chosen = chooseCrossroad(dispatched, expedition.id, 0, 'risky');
    clock.set(expedition.endsAt + 1);
    const { journal } = claimExpedition(content, chosen, expedition.id, clock.ctx);
    const crossroad = journal.entries.find((e) => e.type === 'crossroad');
    expect(crossroad?.type === 'crossroad' && crossroad.choice).toBe('risky');
  });

  it('포획으로 도감 마일스톤이 달성되면 보상이 지급된다', () => {
    // 8종 사전 포획 → 9종째 포획이 coast-9 계단을 넘는다 (12지역 개편으로 사다리가 2/5/9/12/16/18)
    const coastNatives = content.monsterList.filter(
      (m) => m.habitat === 'misty-coast' && m.rarity !== 'legendary' && m.rarity !== 'transcendent');
    const preCaptured = coastNatives.slice(0, 8).map((m) => m.id);

    const trial = (seed: string): { captured: number } => {
      const clock = makeCtx();
      const { save, partyIds } = saveWithParty(clock, [{ id: preCaptured[0]!, level: 30 }]);
      for (const id of preCaptured) save.codex[id] = { seen: true, captured: true, awakened: false };
      const expedition = makeExpedition('misty-coast', 'standard', partyIds, [], seed);
      save.expeditions.push(expedition);
      const journal = resolveExpedition(content, save, expedition);
      return { captured: journal.totals.capturedMonsterIds.filter((id) => !preCaptured.includes(id)).length };
    };
    const seed = findSeed((s) => trial(s).captured >= 1);

    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: preCaptured[0]!, level: 30 }]);
    for (const id of preCaptured) save.codex[id] = { seen: true, captured: true, awakened: false };
    const expedition = makeExpedition('misty-coast', 'standard', partyIds, [], seed);
    save.expeditions.push(expedition);
    clock.set(expedition.endsAt + 1);
    const goldBefore = save.wallet.gold;
    const { save: after, journal, newMilestones } = claimExpedition(content, save, expedition.id, clock.ctx);

    expect(newMilestones).toContain('coast-9');
    // 8종 사전 포획 상태라 coast-2·coast-5도 함께 달성된다 — 새로 달성된 전체 보상 합으로 검증
    const rewardGold = newMilestones.reduce(
      (sum, id) => sum + (content.milestones.find((m) => m.id === id)?.reward.gold ?? 0), 0);
    expect(after.wallet.gold).toBe(goldBefore + journal.totals.gold + rewardGold);
    expect(after.milestones).toContain('coast-9');
  });
});

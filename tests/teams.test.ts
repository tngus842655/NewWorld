import { describe, expect, it } from 'vitest';
import { createExpedition } from '../src/core/expedition';
import { ensureTeams, setTeamLoadout, speciesUsedByTeams } from '../src/core/teams';
import { regionFlagKey } from '../src/core/progression';
import { content, makeCtx, saveWithParty } from './helpers';

describe('군 프리셋 (2026-08-23 군 시스템)', () => {
  it('ensureTeams — 해금된 군 수만큼 프리셋 생성, 이름 원정대 1·2', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    save.teams = [{ id: 'team-1', name: '옛이름', partyIds: [], artifactIds: [] }];
    const base = ensureTeams(content, save);
    expect(base.teams).toHaveLength(1); // 시작은 1군
    expect(base.teams[0]!.name).toBe('원정대 1');

    base.profile.flags[regionFlagKey('whispering-woods')] = true;
    const two = ensureTeams(content, base);
    expect(two.teams).toHaveLength(2);
    expect(two.teams[1]).toEqual({ id: 'team-2', name: '원정대 2', partyIds: [], artifactIds: [] });

    two.profile.flags[regionFlagKey('sunken-marsh')] = true;
    two.profile.flags[regionFlagKey('ashen-volcano')] = true;
    const four = ensureTeams(content, two);
    expect(four.teams).toHaveLength(4); // 화산까지 → 4군
  });

  it('군 간 카드 배타 — 카드 1장은 한 군만, 2장이면 두 군 편성 가능', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }, { id: 'bubble-crab' }]);
    save.teams = [
      { id: 'team-1', name: '원정대 1', partyIds: [], artifactIds: [] },
      { id: 'team-2', name: '원정대 2', partyIds: [], artifactIds: [] },
    ];
    const one = setTeamLoadout(content, save, 'team-1', ['dune-pup'], []);
    // 카드 1장 — 2군에 같은 종 편성 불가
    expect(() => setTeamLoadout(content, one, 'team-2', ['dune-pup'], [])).toThrow(/카드가 부족/);

    // 카드 2장 — 두 군 동시 편성 가능
    one.roster.find((m) => m.monsterId === 'dune-pup')!.count = 2;
    const both = setTeamLoadout(content, one, 'team-2', ['dune-pup'], []);
    expect(speciesUsedByTeams(both).get('dune-pup')).toBe(2);

    // 같은 군 내 중복은 불가 (기존 규칙)
    expect(() => setTeamLoadout(content, both, 'team-1', ['dune-pup', 'dune-pup'], [])).toThrow(/두 번/);
  });

  it('유물은 uid 단위로 한 군에만 연결', () => {
    const { save, artifactUids } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }], { artifacts: ['rusty-saber'] });
    save.teams = [
      { id: 'team-1', name: '원정대 1', partyIds: [], artifactIds: [] },
      { id: 'team-2', name: '원정대 2', partyIds: [], artifactIds: [] },
    ];
    const one = setTeamLoadout(content, save, 'team-1', [], artifactUids);
    expect(() => setTeamLoadout(content, one, 'team-2', [], artifactUids)).toThrow(/다른 군/);
  });

  it('파견 — 카드 수 기반 동시 파견, 군 재파견 잠금', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    save.profile.flags[regionFlagKey('whispering-woods')] = true; // 2군 해금 — 팀 한도가 아닌 카드 배타를 검증
    // 카드 1장: 첫 파견 후 같은 종 재파견 불가
    const first = createExpedition(content, save, {
      regionId: 'misty-coast', tier: 'scout', partyIds: ['dune-pup'], artifactIds: [], teamId: 'team-1',
    }, clock.ctx);
    expect(first.expedition.teamId).toBe('team-1');
    expect(() => createExpedition(content, first.save, {
      regionId: 'misty-coast', tier: 'scout', partyIds: ['dune-pup'], artifactIds: [], teamId: 'team-2',
    }, clock.ctx)).toThrow(/원정 중인 몬스터/);

    // 카드 2장이면 같은 종 동시 파견 가능
    const rich = structuredClone(save);
    rich.roster.find((m) => m.monsterId === 'dune-pup')!.count = 2;
    const a = createExpedition(content, rich, {
      regionId: 'misty-coast', tier: 'scout', partyIds: ['dune-pup'], artifactIds: [], teamId: 'team-1',
    }, clock.ctx);
    const b = createExpedition(content, a.save, {
      regionId: 'misty-coast', tier: 'scout', partyIds: ['dune-pup'], artifactIds: [], teamId: 'team-2',
    }, clock.ctx);
    expect(b.save.expeditions.filter((e) => !e.claimed)).toHaveLength(2);

    // 같은 군 재파견은 잠금
    expect(() => createExpedition(content, a.save, {
      regionId: 'misty-coast', tier: 'scout', partyIds: [], artifactIds: [], teamId: 'team-1',
    }, clock.ctx)).toThrow(/이미 원정 중/);
  });
});

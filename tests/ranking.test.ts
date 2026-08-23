import { describe, expect, it } from 'vitest';
import { claimExpedition } from '../src/core/expedition';
import { artifactScore, monsterBaseScore, monsterScore, scoreBreakdown, TIER_SCORE } from '../src/core/score';
import { settleTasks, taskCounterValue } from '../src/core/tasks';
import type { CoreCtx } from '../src/core/types';
import { T0, content, makeCtx, makeExpedition, saveWithParty } from './helpers';

const fixedCtx = (seed: string): CoreCtx => ({ now: () => T0 + 3600_000, newSeed: () => seed, newUid: () => 'uid' });

describe('반복 과업 (GDD §9.3)', () => {
  it('카운터가 문턱을 넘을 때마다 보상 지급, 이미 수령분은 재지급 없음', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    const craftTask = content.tasks.find((t) => t.id === 'task-craft')!;
    save.stats.crafts = craftTask.every * 2 + 3; // 2회 달성 + 자투리
    const goldBefore = save.wallet.gold;

    const completed = settleTasks(content, save);
    expect(completed).toEqual([
      { taskId: 'task-craft', times: 2, gold: craftTask.reward.gold * 2, dust: craftTask.reward.dust * 2 },
    ]);
    expect(save.tasks['task-craft']).toBe(2);
    expect(save.wallet.gold).toBe(goldBefore + craftTask.reward.gold * 2);

    // 같은 상태에서 재정산 — 변화 없음
    expect(settleTasks(content, save)).toEqual([]);
    expect(save.wallet.gold).toBe(goldBefore + craftTask.reward.gold * 2);
  });

  it('원정 카운터는 3단 파견 합산', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    save.stats.expeditions = { scout: 3, standard: 2, deep: 1 };
    expect(taskCounterValue(save, 'expedition')).toBe(6);
  });

  it('정산이 원정 통계를 누적하고 과업까지 잇는다', () => {
    const { save, partyIds } = saveWithParty(makeCtx(), [{ id: 'dune-pup', level: 10 }]);
    const expTask = content.tasks.find((t) => t.id === 'task-expedition')!;
    save.stats.expeditions.scout = expTask.every - 1; // 이번 정산으로 문턱 도달
    save.expeditions.push(makeExpedition('misty-coast', 'scout', partyIds, [], 'stat-seed'));

    const result = claimExpedition(content, save, 'exp:stat-seed', fixedCtx('s'));
    expect(result.save.stats.expeditions.scout).toBe(expTask.every);
    expect(result.save.stats.wipes.scout).toBe(result.journal.wiped ? 1 : 0);
    const captures = result.journal.entries.filter((e) => e.type === 'encounter' && e.capture?.success).length;
    expect(result.save.stats.captures).toBe(captures);
    expect(result.newTasks.some((t) => t.taskId === 'task-expedition')).toBe(true);
    expect(result.save.tasks['task-expedition']).toBe(1);
  });
});

describe('랭킹 점수 (GDD §9.3)', () => {
  it('몬스터 점수 — 등급×지역 기본점 + 육성 가산', () => {
    // dune-pup: 해안(order 1) 일반 → 기본점 10
    expect(monsterBaseScore(content, 'dune-pup')).toBe(10);
    expect(monsterScore(content, { monsterId: 'dune-pup', level: 1, star: 1, count: 1 })).toBe(10);
    // Lv5 ★2 → 10 × (1 + 0.05×4 + 0.5×1) = 17
    expect(monsterScore(content, { monsterId: 'dune-pup', level: 5, star: 2, count: 3 })).toBe(17);
    // 화산(order 4) 전설 → 기본점 200×4 = 800
    const volcanoLegend = content.monsterList.find((m) => m.habitat === 'ashen-volcano' && m.rarity === 'legendary')!;
    expect(monsterBaseScore(content, volcanoLegend.id)).toBe(800);
  });

  it('유물 점수 — 등급점 + 강화 20%/단계', () => {
    const uncommonId = content.artifactsByRarity.get('uncommon')![0]!.id;
    expect(artifactScore(content, { itemId: uncommonId, enhance: 0, count: 1 })).toBe(20);
    expect(artifactScore(content, { itemId: uncommonId, enhance: 3, count: 2 })).toBe(32); // 종당 1회 — 개수 무관
  });

  it('종합 점수 — 원정(전멸 절반)·과업 가중·전투력 반영', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    save.stats.expeditions = { scout: 4, standard: 0, deep: 2 };
    save.stats.wipes = { scout: 0, standard: 0, deep: 1 };
    save.stats.bestPower = 1234;
    save.tasks = { 'task-craft': 3 };
    const craftTask = content.tasks.find((t) => t.id === 'task-craft')!;

    const scores = scoreBreakdown(content, save);
    expect(scores.expedition).toBe(4 * TIER_SCORE.scout + TIER_SCORE.deep + Math.ceil(TIER_SCORE.deep / 2));
    expect(scores.monster).toBe(10); // dune-pup Lv1★1
    expect(scores.task).toBe(craftTask.score * 3);
    expect(scores.power).toBe(1234);
    expect(scores.total).toBe(scores.expedition + scores.monster + scores.artifact + scores.task * 2 + Math.round(1234 / 10));
  });
});

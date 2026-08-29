/**
 * 반복 과업 (GDD §9.3) — 누적 카운터가 문턱을 넘을 때마다 소모 재화 보상을 자동 지급.
 * 업적(마일스톤)과 달리 무한 반복이며, 달성 횟수가 랭킹 점수가 된다.
 */
import type { Content } from '../content';
import { TIERS, type TaskCounter } from '../content/schema';
import type { SaveState } from './types';

export function taskCounterValue(save: SaveState, counter: TaskCounter): number {
  switch (counter) {
    case 'expedition':
      return TIERS.reduce((sum, tier) => sum + save.stats.expeditions[tier], 0);
    case 'capture':
      return save.stats.captures;
    case 'craft':
      return save.stats.crafts;
    case 'fusion':
      return save.stats.fusions;
  }
}

export interface TaskCompletion {
  taskId: string;
  times: number;
  gold: number;
  dust: number;
}

/** 카운터 갱신 직후 호출 — save(호출부에서 이미 클론된 next)를 제자리 수정하고 새 달성 목록을 돌려준다 */
export function settleTasks(content: Content, save: SaveState): TaskCompletion[] {
  const completed: TaskCompletion[] = [];
  for (const task of content.tasks) {
    const earned = Math.floor(taskCounterValue(save, task.counter) / task.every);
    const claimed = save.tasks[task.id] ?? 0;
    if (earned <= claimed) continue;
    const times = earned - claimed;
    save.tasks[task.id] = earned;
    save.wallet.gold += task.reward.gold * times;
    save.wallet.dust += task.reward.dust * times;
    completed.push({ taskId: task.id, times, gold: task.reward.gold * times, dust: task.reward.dust * times });
  }
  return completed;
}

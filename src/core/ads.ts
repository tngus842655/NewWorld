/**
 * 광고 보상 (GDD §9.2 — 전부 보상형, 강제 없음) — 순수 함수만.
 * 광고 시청 성공 검증은 platform/ads.ts, 액션 배선은 store.ts가 한다.
 * 일일 카운터는 counters.adUsed — 상점(todayKey)과 같은 로컬 자정 리셋 기준.
 * 슬롯 키는 balance.ads.daily의 키와 일치해야 한다.
 */
import type { Content } from '../content';
import { accelerateExpedition } from './expedition';
import { todayKey } from './shop';
import { GameError, type SaveState } from './types';

export type AdSlot = 'instantReturn' | 'scentBuff';

/** 오늘 사용 횟수 — 날짜가 바뀌면 기록 리셋 전이어도 0으로 취급 (shop.purchasesToday와 동일 패턴) */
export function adUsesToday(save: SaveState, slot: AdSlot, now: number): number {
  if (save.counters.day !== todayKey(now)) return 0;
  return save.counters.adUsed[slot] ?? 0;
}

/** 오늘 남은 횟수 — UI 표시·버튼 비활성 공용 */
export function adUsesLeft(content: Content, save: SaveState, slot: AdSlot, now: number): number {
  const limit = content.balance.ads.daily[slot] ?? 0;
  return Math.max(0, limit - adUsesToday(save, slot, now));
}

/** 사용 1회 기록 — 한도 초과는 GameError. 클론을 돌려준다 */
export function markAdUse(content: Content, save: SaveState, slot: AdSlot, now: number): SaveState {
  if (adUsesLeft(content, save, slot, now) <= 0) {
    throw new GameError('ad-limit', '오늘은 더 볼 수 없습니다 — 내일 다시!');
  }
  const next = structuredClone(save);
  const today = todayKey(now);
  if (next.counters.day !== today) next.counters = { day: today, adUsed: {} };
  next.counters.adUsed[slot] = (next.counters.adUsed[slot] ?? 0) + 1;
  return next;
}

/**
 * 야생의 향기 — 포획률 ×capture.adBuffMult, ads.scentMinutes 동안.
 * 적용은 실시간이 아니라 **버프 중 출발한 원정의 스냅샷**(expedition.scent) —
 * 정산은 시드 결정론이라 "정산 시점에 버프가 살아있나"로 걸면 미리보기·재정산이 갈라진다.
 */
export function applyScentBuff(content: Content, save: SaveState, now: number): SaveState {
  const next = markAdUse(content, save, 'scentBuff', now);
  next.buffs.scentUntil = now + content.balance.ads.scentMinutes * 60_000;
  return next;
}

/** 즉시 귀환 — 남은 시간 전부 단축 (모래시계와 같은 시간축 이동이라 달력 시스템 무영향) */
export function adInstantReturn(content: Content, save: SaveState, expeditionId: string, now: number): SaveState {
  const target = save.expeditions.find((e) => e.id === expeditionId && !e.claimed);
  if (!target) throw new GameError('expedition-missing', '진행 중인 원정이 아닙니다');
  if (target.endsAt <= now) throw new GameError('expedition-done', '이미 돌아온 원정입니다');
  const marked = markAdUse(content, save, 'instantReturn', now);
  return accelerateExpedition(marked, expeditionId, target.endsAt - now, now); // 회군 중이면 여기서 GameError
}

/**
 * 일지 정산 2배 (원정당 1회) — 받은 재화(골드·재료)만큼 한 번 더 지급.
 * 카드·포획·유물은 도감·확률 자산이라 제외 (GDD §9.2). 전멸 귀환도 받은 만큼만 2배.
 */
export function doubleJournalRewards(
  save: SaveState,
  expeditionId: string,
): { save: SaveState; gold: number; materials: Record<string, number> } {
  const next = structuredClone(save);
  const entry = next.journalArchive.find((j) => j.expeditionId === expeditionId);
  if (!entry?.journal) throw new GameError('journal-missing', '정산 기록을 찾을 수 없습니다');
  if (entry.doubled) throw new GameError('journal-doubled', '이미 2배로 받은 일지입니다');
  const { gold, materials } = entry.journal.totals;
  next.wallet.gold += gold;
  for (const [materialId, count] of Object.entries(materials)) {
    next.wallet.materials[materialId] = (next.wallet.materials[materialId] ?? 0) + count;
  }
  entry.doubled = true;
  return { save: next, gold, materials };
}

/**
 * 월간 출석 (v8, GDD §9) — 매월 리셋되는 달력 도장.
 * 보상은 날짜가 아니라 그 달의 n번째 출석 순서로 지급 — 며칠 빠져도 사다리를 계속 탄다.
 * 표(28칸)를 다 받은 뒤의 출석은 도장만 찍힌다 (29~31일). 다이아의 v1 유일 획득처.
 */
import type { Content } from '../content';
import type { AttendanceReward } from '../content/schema';
import { GameError, type AttendanceState, type SaveState } from './types';

/** 로컬 기준 'YYYY-MM' + 일(day of month) — 일일 리셋(shop todayKey)과 동일하게 기기 자정 기준 */
export function monthParts(now: number): { month: string; day: number } {
  const d = new Date(now);
  return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, day: d.getDate() };
}

/** 달이 바뀌었으면 빈 상태로 취급 (기록 리셋 전이어도) */
export function attendanceNow(save: SaveState, now: number): AttendanceState {
  const { month } = monthParts(now);
  if (save.attendance.month !== month) return { month, days: [] };
  return save.attendance;
}

export function canCheckIn(save: SaveState, now: number): boolean {
  const { day } = monthParts(now);
  return !attendanceNow(save, now).days.includes(day);
}

/** 다음 출석(n+1번째)에 받을 보상 — 표를 다 받았으면 null (도장만) */
export function nextReward(content: Content, save: SaveState, now: number): AttendanceReward | null {
  const { rewards } = content.balance.attendance;
  const count = attendanceNow(save, now).days.length;
  return count < rewards.length ? rewards[count]! : null;
}

export interface CheckInResult {
  save: SaveState;
  reward: AttendanceReward | null; // null = 표를 다 받아 도장만 찍힘
  dayIndex: number; // 이번 달 n번째 출석 (1부터)
}

export function checkIn(content: Content, save: SaveState, now: number): CheckInResult {
  const { month, day } = monthParts(now);
  const next = structuredClone(save);
  if (next.attendance.month !== month) next.attendance = { month, days: [] };
  if (next.attendance.days.includes(day)) throw new GameError('attendance-done', '오늘은 이미 출석했습니다');

  const reward = nextReward(content, next, now);
  next.attendance.days.push(day);
  if (reward) {
    next.wallet.gold += reward.gold ?? 0;
    next.wallet.dust += reward.dust ?? 0;
    next.wallet.diamonds += reward.diamonds ?? 0;
    next.wallet.lures += reward.lures ?? 0;
  }
  return { save: next, reward, dayIndex: next.attendance.days.length };
}

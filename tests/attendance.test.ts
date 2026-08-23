import { describe, expect, it } from 'vitest';
import { attendanceNow, canCheckIn, checkIn, monthParts, nextReward } from '../src/core/attendance';
import { GameError } from '../src/core/types';
import { content, makeCtx, saveWithParty } from './helpers';

// 로컬 자정 기준(todayKey와 동일 규약)이라 타임스탬프도 로컬 생성자로 만든다
const JAN_15 = new Date(2026, 0, 15, 10).getTime();
const JAN_15_NIGHT = new Date(2026, 0, 15, 23).getTime();
const JAN_16 = new Date(2026, 0, 16, 10).getTime();
const JAN_20 = new Date(2026, 0, 20, 10).getTime();
const JAN_29 = new Date(2026, 0, 29, 10).getTime();
const FEB_01 = new Date(2026, 1, 1, 10).getTime();

const rewards = content.balance.attendance.rewards;

function freshSave() {
  const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }], { gold: 1000, dust: 0 });
  return save;
}

describe('월간 출석 (v8)', () => {
  it('첫 출석 — 이번 달로 초기화, 1일차 보상 지급, 원본 불변', () => {
    const save = freshSave();
    const { save: next, reward, dayIndex } = checkIn(content, save, JAN_15);
    expect(next.attendance).toEqual({ month: '2026-01', days: [15] });
    expect(dayIndex).toBe(1);
    expect(reward).toEqual(rewards[0]);
    expect(next.wallet.gold).toBe(1000 + (rewards[0]!.gold ?? 0));
    expect(save.attendance.days).toHaveLength(0); // 원본 불변
  });

  it('같은 날 재출석은 GameError — 시간이 달라도 같은 로컬 날짜면 막힌다', () => {
    const { save: next } = checkIn(content, freshSave(), JAN_15);
    expect(canCheckIn(next, JAN_15_NIGHT)).toBe(false);
    expect(() => checkIn(content, next, JAN_15_NIGHT)).toThrow(GameError);
    expect(canCheckIn(next, JAN_16)).toBe(true);
  });

  it('보상은 날짜가 아니라 출석 순서 — 며칠 빠져도 사다리를 이어간다', () => {
    let state = checkIn(content, freshSave(), JAN_15).save;
    const second = checkIn(content, state, JAN_20); // 15→20일로 건너뜀
    expect(second.dayIndex).toBe(2);
    expect(second.reward).toEqual(rewards[1]); // 2일차 보상
    const third = checkIn(content, second.save, JAN_29);
    expect(third.reward).toEqual(rewards[2]); // 3일차 = 다이아
    expect(third.reward!.diamonds).toBeGreaterThan(0);
    expect(third.save.wallet.diamonds).toBe(rewards[2]!.diamonds);
  });

  it('달이 바뀌면 리셋 — 새 달 첫 출석은 다시 1일차', () => {
    const jan = checkIn(content, checkIn(content, freshSave(), JAN_15).save, JAN_16).save;
    expect(attendanceNow(jan, FEB_01).days).toHaveLength(0); // 조회만으로도 빈 상태 취급
    expect(canCheckIn(jan, FEB_01)).toBe(true);
    const feb = checkIn(content, jan, FEB_01);
    expect(feb.save.attendance).toEqual({ month: '2026-02', days: [1] });
    expect(feb.dayIndex).toBe(1);
    expect(feb.reward).toEqual(rewards[0]);
  });

  it('보상표(28칸)를 다 받으면 도장만 찍힌다 (29~31일)', () => {
    const save = freshSave();
    save.attendance = { month: monthParts(JAN_29).month, days: Array.from({ length: rewards.length }, (_, i) => i + 1) };
    expect(nextReward(content, save, JAN_29)).toBeNull();
    const { save: next, reward, dayIndex } = checkIn(content, save, JAN_29);
    expect(reward).toBeNull();
    expect(dayIndex).toBe(rewards.length + 1);
    expect(next.attendance.days).toContain(29);
    expect(next.wallet.gold).toBe(save.wallet.gold); // 지갑 변화 없음
  });

  it('보상표 검증 — 다이아 데이가 존재하고 월 합계가 설계 범위', () => {
    const total = rewards.reduce((sum, r) => sum + (r.diamonds ?? 0), 0);
    expect(rewards).toHaveLength(28); // 2월(28일)에도 완주 가능
    expect(total).toBeGreaterThanOrEqual(100); // 다이아 획득처로서 유의미
  });
});

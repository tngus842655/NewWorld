/**
 * 귀환 로컬 알림 (ROADMAP M5) — 순수부(desiredReturnAlarms)만 검증한다.
 * OS 예약 반영(applyAlarms)은 네이티브 전용이라 실기기 DoD에서 확인.
 */
import { describe, expect, it } from 'vitest';
import { alarmId, desiredReturnAlarms, isNightTime } from '../src/platform/returnAlarms';
import { T0, makeCtx, makeExpedition, saveWithParty } from './helpers';

/** 러너 시간대와 무관하게 "로컬 h시 m분" 타임스탬프를 만든다 (야간 판정은 기기 로컬 기준) */
const atLocal = (hour: number, minute = 0): number => new Date(2026, 7, 31, hour, minute).getTime();

describe('귀환 알림 파생 (desiredReturnAlarms)', () => {
  it('진행 중 원정만 — 정산·회군·이미 귀환한 것은 제외', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    save.settings.nightAlarms = true; // 이 테스트는 야간 필터와 무관 — T0 기반 endsAt이 야간에 걸리지 않게
    const active = makeExpedition('misty-coast', 'deep', partyIds, [], 'alarm-a');
    const claimed = { ...makeExpedition('misty-coast', 'scout', partyIds, [], 'alarm-b'), claimed: true };
    const recalled = { ...makeExpedition('misty-coast', 'standard', partyIds, [], 'alarm-c'), recallAt: T0 + 1000 };
    const returned = { ...makeExpedition('misty-coast', 'scout', partyIds, [], 'alarm-d'), endsAt: T0 - 1 };
    save.expeditions = [active, claimed, recalled, returned];

    const alarms = desiredReturnAlarms(save, T0);
    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.id).toBe(alarmId(active.id));
    expect(alarms[0]!.at).toBe(active.endsAt);
    expect(alarms[0]!.body).toContain('원정'); // deep 티어 이름 (TIER_NAME.deep)
  });

  it('가속으로 endsAt이 당겨지면 파생값도 따라온다 (선언적 동기화의 근거)', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    save.settings.nightAlarms = true; // 야간 필터와 무관한 테스트
    const expedition = makeExpedition('misty-coast', 'deep', partyIds, [], 'alarm-shift');
    save.expeditions = [expedition];
    const before = desiredReturnAlarms(save, T0)[0]!;

    expedition.endsAt -= 60 * 60_000; // 모래시계 1시간
    const after = desiredReturnAlarms(save, T0)[0]!;
    expect(after.id).toBe(before.id); // 같은 원정 = 같은 알림 id → 덮어쓰기 재예약
    expect(after.at).toBe(before.at - 60 * 60_000);
  });

  it('야간(21~08시) 도착 알림은 기본 무음 — 미루지 않고 아예 안 울린다 (검토 목록 ③)', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }]);
    const night = { ...makeExpedition('misty-coast', 'deep', partyIds, [], 'night-a'), endsAt: atLocal(22, 30) };
    const dawn = { ...makeExpedition('misty-coast', 'deep', partyIds, [], 'night-b'), endsAt: atLocal(7, 59) };
    const day = { ...makeExpedition('misty-coast', 'deep', partyIds, [], 'night-c'), endsAt: atLocal(8, 0) };
    save.expeditions = [night, dawn, day];
    const now = atLocal(6, 0);

    expect(save.settings.nightAlarms).toBe(false); // 신규 세이브 기본값 = 야간 무음
    const quiet = desiredReturnAlarms(save, now);
    expect(quiet.map((a) => a.id)).toEqual([alarmId(day.id)]); // 22:30·07:59 제외, 08:00은 주간

    save.settings.nightAlarms = true; // 켜면 전부 울린다
    expect(desiredReturnAlarms(save, now)).toHaveLength(3);
  });

  it('야간 경계 판정 — 21:00부터 07:59까지가 야간', () => {
    expect(isNightTime(atLocal(20, 59))).toBe(false);
    expect(isNightTime(atLocal(21, 0))).toBe(true);
    expect(isNightTime(atLocal(0, 30))).toBe(true);
    expect(isNightTime(atLocal(7, 59))).toBe(true);
    expect(isNightTime(atLocal(8, 0))).toBe(false);
    expect(isNightTime(atLocal(12, 0))).toBe(false);
  });

  it('알림 id는 안정적이고 원정마다 다르다 (양의 32비트 정수)', () => {
    expect(alarmId('exp:seed-1')).toBe(alarmId('exp:seed-1'));
    expect(alarmId('exp:seed-1')).not.toBe(alarmId('exp:seed-2'));
    for (let i = 0; i < 50; i++) {
      const id = alarmId(`exp:uid-${i}`);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(0x7fffffff);
    }
  });
});

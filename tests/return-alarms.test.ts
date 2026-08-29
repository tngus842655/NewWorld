/**
 * 귀환 로컬 알림 (ROADMAP M5) — 순수부(desiredReturnAlarms)만 검증한다.
 * OS 예약 반영(applyAlarms)은 네이티브 전용이라 실기기 DoD에서 확인.
 */
import { describe, expect, it } from 'vitest';
import { alarmId, desiredReturnAlarms } from '../src/platform/returnAlarms';
import { T0, makeCtx, makeExpedition, saveWithParty } from './helpers';

describe('귀환 알림 파생 (desiredReturnAlarms)', () => {
  it('진행 중 원정만 — 정산·회군·이미 귀환한 것은 제외', () => {
    const clock = makeCtx();
    const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }]);
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
    const expedition = makeExpedition('misty-coast', 'deep', partyIds, [], 'alarm-shift');
    save.expeditions = [expedition];
    const before = desiredReturnAlarms(save, T0)[0]!;

    expedition.endsAt -= 60 * 60_000; // 모래시계 1시간
    const after = desiredReturnAlarms(save, T0)[0]!;
    expect(after.id).toBe(before.id); // 같은 원정 = 같은 알림 id → 덮어쓰기 재예약
    expect(after.at).toBe(before.at - 60 * 60_000);
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

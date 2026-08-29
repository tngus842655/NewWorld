/**
 * 귀환 로컬 알림 (ROADMAP M5, 2026-08-29) — endsAt이 파견 시점에 확정되므로 서버 푸시가
 * 필요 없다. 선언적 동기화: 세이브의 진행 중 원정에서 "울려야 할 알림 집합"을 파생해
 * OS 예약과의 차이만 반영한다 — 파견·정산·회군·모래시계·DEV 가속 어느 경로로 endsAt이
 * 바뀌어도 액션별 훅 없이 항상 맞는다. 웹(비네이티브)에서는 전부 무동작.
 * 기기 재부팅 후 복원은 플러그인의 부트 리시버가 담당한다.
 * store는 동적 import — 이 모듈의 순수부(desiredReturnAlarms)를 테스트가 store 없이 불러온다.
 */
import { Capacitor } from '@capacitor/core';
import { content } from '../content';
import type { SaveState } from '../core/types';
import { TIER_NAME } from '../ui/kit';

const CHANNEL_ID = 'expedition-return';

export interface ReturnAlarm {
  id: number; // 알림 id — 원정 id의 해시 (플러그인이 정수만 받는다)
  at: number;
  title: string;
  body: string;
}

/** 원정 id → 알림 id. 같은 원정은 항상 같은 값 (재예약이 같은 id를 덮어쓰게) */
export function alarmId(expeditionId: string): number {
  let hash = 5381;
  for (let i = 0; i < expeditionId.length; i++) {
    hash = (Math.imul(hash, 33) ^ expeditionId.charCodeAt(i)) >>> 0;
  }
  return hash & 0x7fffffff;
}

// 야간 무음 구간 (검토 목록 ③, 2026-08-30) — 국내 게임 표준 관행(21~08시).
// settings.nightAlarms가 꺼져 있으면(기본) 이 구간에 도착하는 알림은 미루지 않고 아예 안 울린다.
export const NIGHT_START_HOUR = 21;
export const NIGHT_END_HOUR = 8;

/** 기기 로컬 시각 기준 야간 여부 — 알림은 기기 속성이라 로컬 시간대가 맞다 */
export function isNightTime(at: number): boolean {
  const hour = new Date(at).getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/** 세이브에서 파생한 "울려야 할 알림" — 순수 함수 (회군·정산·과거 귀환·야간 무음 제외) */
export function desiredReturnAlarms(state: SaveState, now: number): ReturnAlarm[] {
  return state.expeditions
    .filter((e) => !e.claimed && e.recallAt === undefined && e.endsAt > now)
    .filter((e) => state.settings.nightAlarms || !isNightTime(e.endsAt))
    .map((e) => ({
      id: alarmId(e.id),
      at: e.endsAt,
      title: '🏕️ 원정대가 돌아왔습니다!',
      body: `${content.regions.get(e.regionId)?.name ?? e.regionId} ${TIER_NAME[e.tier]} — 일지가 기다립니다`,
    }));
}

let synced = new Map<number, number>(); // id → at (이번 세션에서 예약해 둔 것)
let permissionAsked = false;

async function applyAlarms(desired: ReturnAlarm[]): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const want = new Map(desired.map((a) => [a.id, a.at] as const));

  const cancelIds = [...synced.keys()].filter((id) => !want.has(id));
  if (cancelIds.length > 0) {
    await LocalNotifications.cancel({ notifications: cancelIds.map((id) => ({ id })) });
  }

  // 같은 id로 다시 예약하면 덮어써지므로 시각이 바뀐 것도 schedule 한 번으로 끝난다
  const toSchedule = desired.filter((a) => synced.get(a.id) !== a.at);
  if (toSchedule.length > 0) {
    // 권한은 처음 예약할 일이 생겼을 때 묻는다 (Android 13+ POST_NOTIFICATIONS).
    // 거부돼도 예약 자체는 두고 조용히 넘어간다 — 알림은 비크리티컬, 게임은 그대로 돈다
    if (!permissionAsked) {
      permissionAsked = true;
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') await LocalNotifications.requestPermissions();
    }
    await LocalNotifications.schedule({
      notifications: toSchedule.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        channelId: CHANNEL_ID,
        schedule: { at: new Date(a.at), allowWhileIdle: true },
      })),
    });
  }
  synced = want;
}

/** 예약 전체 취소 — 탈퇴(세이브 파기) 시. 남겨두면 지워진 계정의 원정 알림이 울린다 */
export async function cancelAllReturnAlarms(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
    synced = new Map();
  } catch { /* 비크리티컬 — 실패해도 탈퇴 흐름을 막지 않는다 */ }
}

/** 게임 마운트 후 1회 (main.ts, 게임 경로 전용) — 채널 생성 + 세이브 변화 구독 */
export async function initReturnAlarms(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const [{ LocalNotifications }, clock, { effect }, { save }] = await Promise.all([
    import('@capacitor/local-notifications'),
    import('../state/clock'),
    import('../state/signal'),
    import('../state/store'),
  ]);
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: '원정 귀환',
      description: '원정대가 돌아오면 알려줍니다',
      importance: 4,
      vibration: true,
    });
    // 부팅 정리: 이 앱의 예약은 전부 우리 것 — 스테일(클라우드 복원으로 사라진 원정 등)을
    // 털어내고 아래 effect가 현재 세이브 기준으로 다시 깐다
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
  } catch { /* 비크리티컬 */ }
  effect(() => {
    const state = save();
    void applyAlarms(desiredReturnAlarms(state, clock.now())).catch(() => { /* 비크리티컬 */ });
  });
}

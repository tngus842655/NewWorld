/**
 * 앱 업데이트 안내 (2026-08-29 — my-investment 파이어패스 패턴 이식).
 * 최신 버전 판정은 플레이 In-App Updates API가 직접 한다 — .aab만 올리면 심사 통과 후
 * 자동으로 안내가 뜨고, 우리가 버전 값을 따로 관리하거나 웹을 재배포할 일이 없다.
 * ⚠️ 플레이스토어 설치본에서만 동작 — 사이드로드·디버그 빌드는 조회가 실패해 조용히 넘어간다
 * (실기기 확인은 테스트 트랙에서). 웹에서는 무동작, DEV 웹에는 팝업 미리보기 손잡이만 노출.
 */
import { Capacitor } from '@capacitor/core';

/** 안내를 미룬 기록 `{ build, ts }` — 같은 버전은 24시간 다시 묻지 않는다.
 *  더 새 버전이 그 사이 올라오면(build가 다름) 기다리지 않고 다시 안내한다 */
const SNOOZE_KEY = 'newworld-app-update-snoozed';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function isSnoozed(build: string): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const { build: snoozed, ts } = JSON.parse(raw) as { build: string; ts: number };
    return snoozed === build && Date.now() - ts < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(build: string): void {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ build, ts: Date.now() }));
  } catch { /* 비크리티컬 */ }
}

/** 안내 팝업 — 업데이트를 누르면 플레이스토어의 이 앱 페이지로 (패키지명은 플러그인이 채운다).
 *  어느 쪽으로 닫아도 스누즈를 남긴다: 스토어에 갔다가 업데이트 없이 돌아오면
 *  아래 appStateChange 검사가 곧바로 다시 띄우게 되기 때문 */
async function promptUpdate(build: string): Promise<void> {
  const { askConfirm } = await import('../ui/dialog');
  snooze(build);
  const go = await askConfirm({
    title: '🆕 새 버전이 나왔어요',
    message: '원정 몬스터즈의 새 버전이 준비됐습니다.\n플레이스토어에서 업데이트해 주세요.',
    confirmLabel: '업데이트',
    cancelLabel: '나중에',
  });
  if (go) {
    const { AppUpdate } = await import('@capawesome/capacitor-app-update');
    await AppUpdate.openAppStore();
  }
}

/** 부팅 시 1회 (main.ts — 게이트·게임 공통 경로) + 백그라운드 복귀 때마다 검사 */
export async function initAppUpdatePrompt(): Promise<void> {
  // DEV 웹 미리보기 손잡이 — 실기기 밖에서 팝업 모양을 확인한다 (프로드 번들에서는 제거)
  if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
    Object.assign(window, { __newworldUpdatePrompt: () => void promptUpdate('preview') });
    return;
  }
  if (!Capacitor.isNativePlatform()) return;
  const [{ AppUpdate, AppUpdateAvailability }, { App }] = await Promise.all([
    import('@capawesome/capacitor-app-update'),
    import('@capacitor/app'),
  ]);
  const check = async (): Promise<void> => {
    try {
      const info = await AppUpdate.getAppUpdateInfo();
      if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return;
      const build = info.availableVersionCode ?? '';
      if (isSnoozed(build)) return;
      await promptUpdate(build);
    } catch { /* 스토어 미설치·사이드로드 — 안내만 못 할 뿐, 조용히 */ }
  };
  void check();
  // 앱을 종료하지 않고 백그라운드에 두는 사용자에게도 스누즈가 풀린 뒤 안내가 닿게
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void check();
  });
}

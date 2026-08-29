/**
 * 보상형 광고 브리지 (GDD §9.2 — 전부 보상형, 강제 없음. ROADMAP M6 AdMob).
 * 네이티브: @capacitor-community/admob (MoneyGame과 같은 검증된 조합).
 * 웹 DEV: 시뮬 폴백(1.5초 대기 후 보상) — 광고 없이 보상 플로우를 검증한다.
 * 프로드 웹: unavailable — UI가 슬롯을 통째로 숨긴다 (adsAvailable).
 * 보상 판정: Rewarded 이벤트가 닫히기(Dismissed) 전에 왔는가 — 중간에 끄면 'dismissed'.
 */
import { Capacitor } from '@capacitor/core';
import { ADMOB_REWARDED_ID, ADMOB_TESTING } from './adsConfig';

export type AdResult = 'rewarded' | 'dismissed' | 'unavailable';

/** 광고 슬롯을 보여줄 환경인가 — 아니면 UI는 행 자체를 그리지 않는다 */
export function adsAvailable(): boolean {
  return Capacitor.isNativePlatform() || import.meta.env.DEV;
}

let initialized = false;

export async function showRewardedAd(): Promise<AdResult> {
  if (!Capacitor.isNativePlatform()) {
    if (!import.meta.env.DEV) return 'unavailable';
    await new Promise((resolve) => setTimeout(resolve, 1500)); // DEV 시뮬
    return 'rewarded';
  }
  try {
    const { AdMob, RewardAdPluginEvents } = await import('@capacitor-community/admob');
    if (!initialized) {
      await AdMob.initialize({});
      initialized = true;
    }
    let rewarded = false;
    const onRewarded = await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { rewarded = true; });
    // 닫힘을 기다려야 보상 여부가 확정된다. 안전망 5분 — Dismissed가 유실되면 그때 보상 기준으로 반환
    let resolveDismissed = (): void => undefined;
    const dismissed = new Promise<void>((resolve) => { resolveDismissed = resolve; });
    const timer = setTimeout(resolveDismissed, 5 * 60_000);
    const onDismissed = await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => resolveDismissed());
    try {
      await AdMob.prepareRewardVideoAd({ adId: ADMOB_REWARDED_ID, isTesting: ADMOB_TESTING });
      await AdMob.showRewardVideoAd();
      await dismissed;
    } finally {
      clearTimeout(timer);
      void onRewarded.remove();
      void onDismissed.remove();
    }
    return rewarded ? 'rewarded' : 'dismissed';
  } catch {
    return 'unavailable'; // 로드 실패·오프라인 등 — 비크리티컬, 호출부가 조용히 안내
  }
}

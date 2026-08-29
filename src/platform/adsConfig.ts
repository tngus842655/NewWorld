/**
 * AdMob 단위 ID — ⚠️ 현재 전부 **구글 공식 테스트 ID**다. 정식 출시 전에 AdMob 콘솔에서
 * 발급받은 실제 ID로 교체할 것 (테스트 ID로 출시하면 수익이 0이고 정책 위반).
 * 앱 ID는 여기가 아니라 android/app/src/main/AndroidManifest.xml의
 * com.google.android.gms.ads.APPLICATION_ID meta-data — 같이 교체해야 한다.
 * 교체 시 ADMOB_TESTING도 false로.
 */
export const ADMOB_TESTING = true;
export const ADMOB_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917'; // 구글 공식 보상형 테스트 ID

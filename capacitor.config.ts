// Capacitor(안드로이드 포장) 설정 — MoneyGame 파이프라인 이식 (ROADMAP M5, 2026-08-29).
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // ⚠️ 패키지명(applicationId) — 플레이스토어에 한 번 올리면 **영구히 바꿀 수 없습니다.**
  // 첫 업로드 전에 원하는 값으로 확정하세요. 바꾸려면 이 값을 고친 뒤
  // android/를 지우고 `npx cap add android`로 네이티브 프로젝트를 다시 생성하면 됩니다.
  appId: 'com.expeditionmonsters.app',
  appName: '원정 몬스터즈', // 런처 아이콘 아래 표시되는 이름 (res/values/strings.xml)
  webDir: 'dist', // vite build 산출물
  android: {
    // 웹뷰가 뜨기 전 잠깐 보이는 배경 — styles.css --bg와 맞춰 깜빡임을 줄인다
    backgroundColor: '#12141c',
  },
};

export default config;

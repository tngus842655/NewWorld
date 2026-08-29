import { defineConfig } from 'vite';

// 개발 서버 포트 — 하니스(autoPort)가 주는 PORT 환경변수 우선, 없으면 5199 (launch.json과 짝).
// strictPort는 하니스 실행에만: 지정 포트가 곧 프리뷰 주소라 어긋나면 실패가 맞다.
// 수동 npm run dev는 5199가 선점돼 있어도 다음 빈 포트로 밀려 뜬다 (2026-08-29 사용자 리포트)
export default defineConfig({
  server: { port: Number(process.env.PORT) || 5199, strictPort: Boolean(process.env.PORT) },
});

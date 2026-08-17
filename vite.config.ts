import { defineConfig } from 'vite';

/** 개발 서버 기본 포트. PORT 환경변수가 있으면 그쪽이 우선한다. */
const DEV_PORT = 5174;

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : DEV_PORT,
    // 포트가 사용 중이면 조용히 다른 포트로 넘어가지 말고 실패시킨다
    // (어느 포트로 떴는지 헷갈리는 상황 방지)
    strictPort: true,
  },
});

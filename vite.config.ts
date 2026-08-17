import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // PORT 환경변수가 있으면 그 포트를 쓴다 (없으면 vite 기본값)
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
});

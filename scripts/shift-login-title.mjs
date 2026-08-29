// 로그인 키아트 타이틀 하향 이동 (2026-08-29) — 상태바·펀치홀이 타이틀을 가리는 실기기 문제.
// 타이틀 글자는 난색(warm) 픽셀 키잉으로 분리해 스티커처럼 아래로 옮기고(사각형 이동은
// 아래의 돛단배·섬을 덮는다), 빈 자리는 같은 행의 주변 하늘 평균색 + 노이즈로 메운다.
// 1회성 도구 — 원본은 실행 전에 BAK에 백업해 둘 것.
//
//   node scripts/shift-login-title.mjs
import sharp from 'sharp';

const SRC = 'public/app-icon/login-background.webp';
const OUT = 'public/app-icon/login-background.webp';

const RECT = { x0: 140, y0: 25, x1: 650, y1: 195 }; // 타이틀 두 줄을 넉넉히 감싸는 영역
const SHIFT = 50; // 아래로 옮길 px — 게이트 cover 배율(×1.71)에서 펀치홀(~120px)을 벗어나는 최소량

// 난색 판정 — 타이틀(크림·금·갈색 외곽선)은 r이 b보다 확실히 크고, 밤하늘(파랑)·별(무채색)·격자(하늘색)는 아니다
const isTitle = (r, g, b) => r > b + 18 && r > 60;
// 우상단 설산·화산 자락 제외 (난색·밝은색이라 키잉에 걸린다)
const excluded = (x, y) => (x > 630 && y < 95) || (x > 590 && y < 42);

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const idx = (x, y) => (y * width + x) * channels;

// 1) 타이틀 픽셀 수집 + 행별 하늘 평균(채움 색) 계산
const titlePixels = []; // { x, y, r, g, b }
const rowSky = new Map(); // y → [r,g,b] (rect 내 비-타이틀 픽셀 평균)
for (let y = RECT.y0; y < RECT.y1; y++) {
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let x = RECT.x0; x < RECT.x1; x++) {
    const i = idx(x, y);
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (!excluded(x, y) && isTitle(r, g, b)) {
      titlePixels.push({ x, y, r, g, b });
    } else if (b > r) { // 하늘 표본은 확실한 파란 픽셀만 (설산·별 제외)
      sr += r; sg += g; sb += b; n++;
    }
  }
  rowSky.set(y, n > 0 ? [sr / n, sg / n, sb / n] : [18, 32, 70]);
}
console.log(`타이틀 픽셀 ${titlePixels.length}개 분리`);

// 2) 원래 자리 메우기 — 행 평균 하늘색 + 픽셀 노이즈 (해당 영역은 폰에서 상태바 뒤라 정밀 복원 불요)
for (const p of titlePixels) {
  const [r, g, b] = rowSky.get(p.y);
  const noise = () => (Math.random() - 0.5) * 7;
  const i = idx(p.x, p.y);
  data[i] = Math.max(0, Math.min(255, r + noise()));
  data[i + 1] = Math.max(0, Math.min(255, g + noise()));
  data[i + 2] = Math.max(0, Math.min(255, b + noise()));
}

// 3) 타이틀을 SHIFT만큼 아래에 다시 찍기 (원본 색 그대로 — 스티커 방식)
for (const p of titlePixels) {
  const y2 = p.y + SHIFT;
  if (y2 >= height) continue;
  const i = idx(p.x, y2);
  data[i] = p.r; data[i + 1] = p.g; data[i + 2] = p.b;
}

await sharp(data, { raw: { width, height, channels } }).webp({ quality: 95 }).toFile(OUT + '.tmp');
const { renameSync } = await import('node:fs');
renameSync(OUT + '.tmp', OUT);
console.log(`완료 — ${OUT} (타이틀 +${SHIFT}px)`);

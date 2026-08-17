import type { BuildingDef, GameState } from '../core/types';

/**
 * 도시 화면. 원작 휴먼 마을 스크린샷의 구성을 참고해 다시 그렸다:
 * 팔각 성벽 + 파란 지붕 망루, 성 밖은 잔디·성 안은 흙바닥,
 * 지붕 색이 제각각인 건물이 빽빽하게 들어선 모습.
 *
 * 원본 스프라이트는 보존된 것이 없어 캔버스로 직접 그린다.
 * public/assets/buildings/{id}.png 를 넣으면 그 이미지로 대체된다.
 */

// 원작 도시 스크린샷(480x440) 비율 기준
export const CITY_W = 480;
export const CITY_H = 440;
/** 직접 그리는 폴백용 정사각 영역 */
const S = 427;
const OFF_X = (CITY_W - S) / 2;

/**
 * 원작 도시 스크린샷을 배경으로 쓴다 (개인용 — git 제외 디렉터리).
 * reference 스크린샷을 public/assets/city/human.png 로 저장하면 자동 적용되고,
 * 없으면 아래의 직접 그린 마을로 폴백한다.
 */
const cityImg = new Image();
// 확장자는 png/jpg 아무거나 — 실제 형식은 브라우저가 내용으로 판단한다
const CITY_IMG_CANDIDATES = ['/assets/city/base.png', '/assets/city/base.jpg'];
let cityImgTry = 0;
cityImg.onerror = () => {
  cityImgTry++;
  if (cityImgTry < CITY_IMG_CANDIDATES.length) cityImg.src = CITY_IMG_CANDIDATES[cityImgTry];
};
cityImg.src = CITY_IMG_CANDIDATES[0];
function cityImageReady(): boolean {
  return cityImg.complete && cityImg.naturalWidth > 0;
}

/**
 * 스크린샷 위 건물 클릭 영역 (이미지 픽셀 좌표, 중심 기준).
 * 원작 화면의 실제 건물 위치에 눈대중으로 맞춘 값 — 보면서 조정한다.
 */
export const HOTSPOTS: Record<string, { x: number; y: number; w: number; h: number }> = {
  sawmill: { x: 240, y: 78, w: 58, h: 54 },        // 상단 목조 골조 건물
  barracks: { x: 320, y: 80, w: 66, h: 56 },       // 우상단 원형 투기장
  'crystal-mine': { x: 62, y: 167, w: 58, h: 50 }, // 좌측 파란 수정 분수
  farm: { x: 110, y: 167, w: 58, h: 52 },          // 좌측 노란 지붕 농가
  quarry: { x: 285, y: 165, w: 56, h: 52 },        // 중앙 석조 성채
  tavern: { x: 243, y: 205, w: 58, h: 50 },        // 중앙 파란 지붕 건물
  academy: { x: 325, y: 237, w: 44, h: 62 },       // 우측 수정 첨탑
  market: { x: 66, y: 252, w: 60, h: 56 },         // 좌하단 분홍 천막
};

/** 건물 배치 (중심 좌표). 타일에 묶지 않고 원작처럼 촘촘히 배치한다 */
interface Plot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const PLOTS: Plot[] = [
  { id: 'sawmill', x: 112, y: 132, w: 52, h: 46 },
  { id: 'quarry', x: 180, y: 122, w: 52, h: 46 },
  { id: 'crystal-mine', x: 250, y: 128, w: 52, h: 46 },
  { id: 'farm', x: 112, y: 205, w: 52, h: 46 },
  { id: 'market', x: 182, y: 196, w: 54, h: 48 },
  { id: 'academy', x: 254, y: 202, w: 52, h: 50 },
  { id: 'barracks', x: 148, y: 272, w: 56, h: 50 },
  { id: 'tavern', x: 224, y: 274, w: 52, h: 46 },
];

/** 기능 없는 장식 건물 — 원작처럼 마을이 빽빽해 보이게 채운다 */
const DECOR: { x: number; y: number; w: number; h: number; roof: string; kind: Shape }[] = [
  { x: 306, y: 160, w: 40, h: 36, roof: '#c0453c', kind: 'house' },
  { x: 316, y: 228, w: 38, h: 34, roof: '#e6c34a', kind: 'dome' },
  { x: 300, y: 300, w: 42, h: 38, roof: '#4a8f4a', kind: 'house' },
  { x: 84, y: 268, w: 38, h: 34, roof: '#8a5fb0', kind: 'tent' },
  { x: 300, y: 104, w: 34, h: 34, roof: '#4a90d0', kind: 'tower' },
  { x: 80, y: 166, w: 34, h: 34, roof: '#c0453c', kind: 'tower' },
  { x: 222, y: 340, w: 44, h: 36, roof: '#8a5a2f', kind: 'house' },
  { x: 148, y: 340, w: 38, h: 34, roof: '#4a90d0', kind: 'dome' },
  { x: 352, y: 196, w: 28, h: 46, roof: '#3fa9d4', kind: 'spire' },
  { x: 76, y: 108, w: 32, h: 30, roof: '#d8a63a', kind: 'house' },
  { x: 352, y: 262, w: 30, h: 30, roof: '#8a5fb0', kind: 'tower' },
  { x: 76, y: 330, w: 32, h: 30, roof: '#c9762f', kind: 'house' },
  { x: 286, y: 348, w: 30, h: 28, roof: '#4a8f4a', kind: 'house' },
  { x: 110, y: 92, w: 30, h: 28, roof: '#b03a30', kind: 'house' },
  { x: 190, y: 84, w: 34, h: 30, roof: '#3f74b8', kind: 'dome' },
  { x: 258, y: 84, w: 30, h: 28, roof: '#e6c34a', kind: 'house' },
];

type Shape = 'house' | 'tower' | 'dome' | 'tent' | 'spire';

/** 건물별 지붕 색·표식·형태 — 원작처럼 생김새가 제각각이도록 */
const LOOK: Record<string, { roof: string; mark: string; shape: Shape }> = {
  sawmill: { roof: '#8a5a2f', mark: '🪓', shape: 'house' },
  quarry: { roof: '#8d939c', mark: '⛏️', shape: 'house' },
  farm: { roof: '#d8a63a', mark: '🌾', shape: 'dome' },
  'crystal-mine': { roof: '#7d5ba6', mark: '💎', shape: 'tower' },
  market: { roof: '#4a8f4a', mark: '🏪', shape: 'tent' },
  barracks: { roof: '#b03a30', mark: '⚔️', shape: 'house' },
  tavern: { roof: '#c9762f', mark: '🍺', shape: 'house' },
  academy: { roof: '#3f74b8', mark: '📜', shape: 'tower' },
};

const spriteCache = new Map<string, HTMLImageElement>();
function sprite(id: string): HTMLImageElement {
  let img = spriteCache.get(id);
  if (!img) {
    img = new Image();
    img.src = `/assets/buildings/${id}.png`;
    spriteCache.set(id, img);
  }
  return img;
}

/** 좌표 해시 기반 난수 — 다시 그려도 지형이 흔들리지 않게 */
function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/** 성벽 팔각형 꼭짓점 */
const WALL_M = 34;
const WALL_C = 96;
function octagon(): [number, number][] {
  const m = WALL_M;
  const c = WALL_C;
  return [
    [m + c, m],
    [S - m - c, m],
    [S - m, m + c],
    [S - m, S - m - c],
    [S - m - c, S - m],
    [m + c, S - m],
    [m, S - m - c],
    [m, m + c],
  ];
}

export function buildingAt(px: number, py: number): string | null {
  // 터치 오차를 감안해 약간 넉넉하게 판정
  const pad = 6;
  const inRect = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) =>
    x >= r.x - r.w / 2 - pad &&
    x <= r.x + r.w / 2 + pad &&
    y >= r.y - r.h / 2 - pad &&
    y <= r.y + r.h / 2 + pad;

  if (cityImageReady()) {
    for (const [id, r] of Object.entries(HOTSPOTS)) {
      if (inRect(px, py, r)) return id;
    }
    return null;
  }
  for (const p of PLOTS) {
    if (inRect(px - OFF_X, py, p)) return p.id;
  }
  return null;
}

// ── 그리기 도우미 ────────────────────────────────────────────

function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, w * 0.42, w * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 집 모양 건물: 몸체 + 지붕 + 문·창 */
function drawHouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
): void {
  const bodyH = h * 0.52;
  const left = x - w / 2;
  const top = y + h / 2 - bodyH;

  drawShadow(ctx, x, y + h / 2, w);

  // 몸체
  ctx.fillStyle = '#efe2c4';
  ctx.fillRect(left, top, w, bodyH);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(left + w * 0.72, top, w * 0.28, bodyH); // 그늘진 면
  ctx.strokeStyle = '#8a7454';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, bodyH - 1);

  // 지붕 (사다리꼴)
  const roofH = h * 0.48;
  ctx.beginPath();
  ctx.moveTo(left - 3, top);
  ctx.lineTo(x, top - roofH);
  ctx.lineTo(left + w + 3, top);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  // 지붕 하이라이트
  ctx.beginPath();
  ctx.moveTo(left - 3, top);
  ctx.lineTo(x, top - roofH);
  ctx.lineTo(x, top);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();

  // 문
  ctx.fillStyle = '#6b4a28';
  ctx.fillRect(x - w * 0.09, top + bodyH * 0.35, w * 0.18, bodyH * 0.65);
  // 창
  ctx.fillStyle = '#7fb6d8';
  ctx.fillRect(left + w * 0.14, top + bodyH * 0.25, w * 0.14, bodyH * 0.3);
  ctx.fillRect(left + w * 0.72, top + bodyH * 0.25, w * 0.14, bodyH * 0.3);
}

/** 원통 탑 */
function drawTower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
): void {
  const bodyW = w * 0.62;
  const bodyH = h * 0.62;
  const top = y + h / 2 - bodyH;

  drawShadow(ctx, x, y + h / 2, w);

  ctx.fillStyle = '#e3e0d4';
  ctx.fillRect(x - bodyW / 2, top, bodyW, bodyH);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x + bodyW * 0.18, top, bodyW * 0.32, bodyH);
  ctx.strokeStyle = '#8d8a7e';
  ctx.strokeRect(x - bodyW / 2 + 0.5, top + 0.5, bodyW - 1, bodyH - 1);

  // 뾰족 지붕
  ctx.beginPath();
  ctx.moveTo(x - bodyW / 2 - 4, top);
  ctx.lineTo(x, top - h * 0.42);
  ctx.lineTo(x + bodyW / 2 + 4, top);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.stroke();

  ctx.fillStyle = '#7fb6d8';
  ctx.fillRect(x - bodyW * 0.16, top + bodyH * 0.3, bodyW * 0.32, bodyH * 0.34);
}

/** 첨탑 (장식) */
function drawSpire(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
): void {
  drawShadow(ctx, x, y + h / 2, w);
  const bw = w * 0.5;
  const top = y - h * 0.1;
  ctx.fillStyle = '#e8e6dc';
  ctx.fillRect(x - bw / 2, top, bw, h * 0.6);
  ctx.strokeStyle = '#8d8a7e';
  ctx.strokeRect(x - bw / 2 + 0.5, top + 0.5, bw - 1, h * 0.6 - 1);
  ctx.beginPath();
  ctx.moveTo(x - bw / 2 - 3, top);
  ctx.lineTo(x, top - h * 0.5);
  ctx.lineTo(x + bw / 2 + 3, top);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
}

/** 돔 지붕 건물 */
function drawDome(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
): void {
  const bodyH = h * 0.5;
  const top = y + h / 2 - bodyH;
  drawShadow(ctx, x, y + h / 2, w);

  ctx.fillStyle = '#efe2c4';
  ctx.fillRect(x - w / 2, top, w, bodyH);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(x + w * 0.22, top, w * 0.28, bodyH);
  ctx.strokeStyle = '#8a7454';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - w / 2 + 0.5, top + 0.5, w - 1, bodyH - 1);

  ctx.beginPath();
  ctx.ellipse(x, top, w * 0.52, h * 0.42, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x - w * 0.14, top - h * 0.1, w * 0.16, h * 0.13, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();

  ctx.fillStyle = '#6b4a28';
  ctx.fillRect(x - w * 0.09, top + bodyH * 0.4, w * 0.18, bodyH * 0.6);
}

/** 천막(시장 등) */
function drawTent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
): void {
  drawShadow(ctx, x, y + h / 2, w);
  const base = y + h / 2 - h * 0.12;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.lineTo(x, y - h / 2);
  ctx.lineTo(x + w / 2, base);
  ctx.closePath();
  ctx.fillStyle = roof;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 줄무늬
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(x + (i * w) / 6, base);
    ctx.lineTo(x + (i * w) / 12, y - h / 2 + 4);
    ctx.lineTo(x + (i * w) / 4, base);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#8a7454';
  ctx.fillRect(x - w / 2, base, w, h * 0.12);
}

/** 성벽 망루 — 원작처럼 큼직한 사각 탑에 파란 뿔지붕과 깃발 */
function drawWallTower(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const w = 40;
  const h = 36;
  const top = y - h / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + h / 2, w * 0.5, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#cfcfcf';
  ctx.fillRect(x - w / 2, top, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(x + w * 0.16, top, w * 0.34, h);
  ctx.strokeStyle = '#6f6f6f';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - w / 2 + 0.5, top + 0.5, w - 1, h - 1);

  // 성가퀴
  ctx.fillStyle = '#dcdcdc';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x - w / 2 + 2 + i * (w / 4), top - 5, w / 6, 6);
  }
  // 창
  ctx.fillStyle = '#3a4a58';
  ctx.fillRect(x - 4, top + h * 0.42, 8, 11);

  // 파란 뿔지붕
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 4, top - 4);
  ctx.lineTo(x, top - 22);
  ctx.lineTo(x + w / 2 + 4, top - 4);
  ctx.closePath();
  ctx.fillStyle = '#3fa9d4';
  ctx.fill();
  ctx.strokeStyle = '#1f6f96';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 4, top - 3);
  ctx.lineTo(x, top - 24);
  ctx.lineTo(x, top - 3);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fill();

  // 깃발
  ctx.strokeStyle = '#5a4a34';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, top - 24);
  ctx.lineTo(x, top - 36);
  ctx.stroke();
  ctx.fillStyle = '#2a7fb8';
  ctx.beginPath();
  ctx.moveTo(x, top - 36);
  ctx.lineTo(x + 11, top - 32);
  ctx.lineTo(x, top - 28);
  ctx.closePath();
  ctx.fill();
}

/** 형태에 맞춰 건물 하나를 그린다 */
function drawStructure(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
): void {
  if (shape === 'tower') drawTower(ctx, x, y, w, h, roof);
  else if (shape === 'dome') drawDome(ctx, x, y, w, h, roof);
  else if (shape === 'tent') drawTent(ctx, x, y, w, h, roof);
  else if (shape === 'spire') drawSpire(ctx, x, y, w, h, roof);
  else drawHouse(ctx, x, y, w, h, roof);
}

// ── 메인 ─────────────────────────────────────────────────────

export function drawCity(
  canvas: HTMLCanvasElement,
  state: GameState,
  defs: Map<string, BuildingDef>,
  selectedId: string | null,
  now: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 원작 스크린샷이 있으면 그것을 배경으로 쓰고, 그 위에 상태 표시만 얹는다
  if (cityImageReady()) {
    drawCityFromImage(ctx, state, defs, selectedId, now);
    return;
  }

  const poly = octagon();
  ctx.save();
  ctx.translate(OFF_X, 0);

  // ── 성 밖: 잔디 ──
  for (let y = 0; y < S; y += 16) {
    for (let x = 0; x < S; x += 16) {
      const r = hash(x, y);
      ctx.fillStyle = r < 0.5 ? '#5b9c3a' : r < 0.85 ? '#63a640' : '#548f35';
      ctx.fillRect(x, y, 16, 16);
    }
  }

  // ── 성 안: 흙바닥 ──
  ctx.save();
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  for (let y = 0; y < S; y += 16) {
    for (let x = 0; x < S; x += 16) {
      const r = hash(x + 7, y + 13);
      ctx.fillStyle = r < 0.45 ? '#c9a878' : r < 0.8 ? '#bf9c69' : '#d2b184';
      ctx.fillRect(x, y, 16, 16);
    }
  }
  // 잔디 패치 몇 군데
  for (let y = 0; y < S; y += 24) {
    for (let x = 0; x < S; x += 24) {
      if (hash(x + 31, y + 17) > 0.86) {
        ctx.fillStyle = 'rgba(96,150,60,0.55)';
        ctx.beginPath();
        ctx.ellipse(x, y, 14, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  // ── 성벽 ──
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineJoin = 'round';
  // 두꺼운 석벽: 바깥 테두리 → 몸통 → 윗면 하이라이트
  ctx.strokeStyle = '#5f5f5f';
  ctx.lineWidth = 26;
  ctx.stroke();
  ctx.strokeStyle = '#b0b0b0';
  ctx.lineWidth = 21;
  ctx.stroke();
  ctx.strokeStyle = '#c9c9c9';
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // 성가퀴 + 석재 이음매 — 벽면을 따라 촘촘히
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = (x2 - x1) / len;
    const ny = (y2 - y1) / len;
    const steps = Math.max(2, Math.round(len / 13));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const cx = x1 + (x2 - x1) * t;
      const cy = y1 + (y2 - y1) * t;
      // 성가퀴 (바깥쪽으로 살짝 튀어나온 돌기)
      ctx.fillStyle = '#dcdcdc';
      ctx.fillRect(cx - 3.5 + ny * 9, cy - 3.5 - nx * 9, 7, 7);
      ctx.strokeStyle = 'rgba(70,70,70,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - 3.5 + ny * 9, cy - 3.5 - nx * 9, 7, 7);
      // 석재 이음매
      ctx.beginPath();
      ctx.moveTo(cx - ny * 8, cy + nx * 8);
      ctx.lineTo(cx + ny * 5, cy - nx * 5);
      ctx.strokeStyle = 'rgba(90,90,90,0.35)';
      ctx.stroke();
    }
  }

  for (const [x, y] of poly) drawWallTower(ctx, x, y);

  // ── 장식 건물 (기능 건물보다 먼저 = 뒤쪽) ──
  for (const d of [...DECOR].sort((a, b) => a.y - b.y)) {
    drawStructure(ctx, d.kind, d.x, d.y, d.w, d.h, d.roof);
  }

  // ── 기능 건물 ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const sorted = [...PLOTS].sort((a, b) => a.y - b.y); // 위쪽부터 그려 겹침 자연스럽게
  for (const plot of sorted) {
    const b = state.buildings.find((x) => x.defId === plot.id);
    const def = defs.get(plot.id);
    const look = LOOK[plot.id] ?? { roof: '#8a8a8a', mark: '❓', shape: 'house' as Shape };
    const level = b?.level ?? 0;

    if (level < 1) {
      // 공터: 흙 기초와 이름표만
      ctx.fillStyle = 'rgba(120,92,58,0.55)';
      ctx.fillRect(plot.x - plot.w / 2, plot.y - plot.h / 4, plot.w, plot.h * 0.5);
      ctx.strokeStyle = 'rgba(80,60,36,0.8)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(plot.x - plot.w / 2, plot.y - plot.h / 4, plot.w, plot.h * 0.5);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '10px sans-serif';
      ctx.fillText(def?.name ?? plot.id, plot.x, plot.y);
    } else {
      const img = sprite(plot.id);
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, plot.x - plot.w / 2, plot.y - plot.h / 2 - 10, plot.w, plot.h + 10);
      } else {
        drawStructure(ctx, look.shape, plot.x, plot.y, plot.w, plot.h, look.roof);
        ctx.font = '12px serif';
        ctx.fillText(look.mark, plot.x, plot.y + plot.h * 0.16);
      }

      // 레벨 배지 — 마을 풍경을 가리지 않게 작게, 오른쪽 아래에
      const bx = plot.x + plot.w / 2 - 3;
      const by = plot.y + plot.h / 2 - 2;
      ctx.fillStyle = 'rgba(24,20,18,0.8)';
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd479';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(String(level), bx, by + 1);
    }

    // 건설 중
    if (state.upgradeQueue?.defId === plot.id) {
      const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
      ctx.font = '14px serif';
      ctx.fillText('🔨', plot.x, plot.y - plot.h / 2 - 18);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(`${remain}s`, plot.x, plot.y + plot.h / 2 + 8);
    }

    // 선택 표시
    if (selectedId === plot.id) {
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(
        plot.x - plot.w / 2 - 4,
        plot.y - plot.h / 2 - 12,
        plot.w + 8,
        plot.h + 16,
      );
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

/**
 * 원작 스크린샷을 배경으로 한 도시 화면.
 * 배경은 건드리지 않고 건물 위에 레벨·건설중·선택 표시만 겹쳐 그린다.
 */
function drawCityFromImage(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  defs: Map<string, BuildingDef>,
  selectedId: string | null,
  now: number,
): void {
  ctx.clearRect(0, 0, CITY_W, CITY_H);
  ctx.drawImage(cityImg, 0, 0, CITY_W, CITY_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [id, r] of Object.entries(HOTSPOTS)) {
    const b = state.buildings.find((x) => x.defId === id);
    const def = defs.get(id);
    const level = b?.level ?? 0;

    if (level < 1) {
      // 미건설: 해당 자리를 어둡게 덮고 이름표를 띄운다
      ctx.fillStyle = 'rgba(10,8,6,0.62)';
      ctx.fillRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(def?.name ?? id, r.x, r.y - 6);
      ctx.fillStyle = 'rgba(255,212,121,0.9)';
      ctx.font = '10px sans-serif';
      ctx.fillText('건설 가능', r.x, r.y + 8);
    } else {
      // 레벨 배지
      const bx = r.x + r.w / 2 - 8;
      const by = r.y + r.h / 2 - 8;
      ctx.fillStyle = 'rgba(20,16,14,0.82)';
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,212,121,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ffd479';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(String(level), bx, by + 1);
    }

    if (state.upgradeQueue?.defId === id) {
      const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
      ctx.font = '15px serif';
      ctx.fillText('🔨', r.x, r.y - r.h / 2 - 10);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(`${remain}s`, r.x, r.y - r.h / 2 + 2);
      ctx.fillText(`${remain}s`, r.x, r.y - r.h / 2 + 2);
    }

    if (selectedId === id) {
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h);
      ctx.setLineDash([]);
    }
  }
}

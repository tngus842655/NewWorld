import type { BuildingDef, GameState } from '../core/types';

/**
 * 기지 화면 — 정면 3/4 시점(캐비닛 투영) 렌더러.
 *
 * 마름모로 눕힌 아이소는 네 귀퉁이에 빈 공간이 남아 모바일 화면을 못 채운다.
 * 그래서 격자를 45도 돌려 정면을 보게 하고(= 축 정렬 직사각형), 건물만
 * 앞면·윗면·우측면 3면으로 그려 깊이를 준다. 직사각형이라 화면을 꽉 채운다.
 *
 * public/assets/city/base.png 를 두면 그 이미지를 배경으로 대신 쓴다.
 */

export const CITY_W = 480;
export const CITY_H = 430;

/** 격자: 화면을 정확히 나누어 여백이 남지 않게 한다 */
const COLS = 8;
const ROWS = 7;
const TW = CITY_W / COLS; // 60
const TH = CITY_H / ROWS; // ≈61.4

/** 깊이(안쪽으로 밀려나는 양) — 캐비닛 투영 */
const DX = 13;
const DY = 11;

const tileX = (gx: number) => gx * TW;
const tileY = (gy: number) => gy * TH;
/** 구조물 코드가 쓰는 좌표 헬퍼 (격자 좌표 → 화면 좌표) */
const isoX = (gx: number, _gy: number) => gx * TW;
const isoY = (_gx: number, gy: number) => gy * TH;

// ── 팔레트 ───────────────────────────────────────────────────
const C = {
  terrainA: '#241c19',
  terrainB: '#2c221c',
  terrainC: '#191312',
  deckA: '#39424e',
  deckB: '#323b46',
  deckLine: '#4b5764',
  wall: '#4a545f',
  wallTop: '#5d6976',
  wallDark: '#333c46',
  steel: '#5a646f',
  steelTop: '#6f7a87',
  steelDark: '#414a54',
  accent: '#35c7e0',
  amber: '#e0a020',
  glass: '#7fe6ff',
  hazard: '#c9a227',
};

interface Slot {
  id: string;
  gx: number;
  gy: number;
  w: number;
  d: number;
}

/** 기능 건물 배치 (격자 8×7) */
const SLOTS: Slot[] = [
  { id: 'sawmill', gx: 1, gy: 0, w: 1, d: 1 },
  { id: 'quarry', gx: 4, gy: 0, w: 1, d: 1 },
  { id: 'crystal-mine', gx: 6, gy: 1, w: 1, d: 1 },
  { id: 'barracks', gx: 1, gy: 2, w: 1, d: 1 },
  { id: 'academy', gx: 6, gy: 3, w: 1, d: 1 },
  { id: 'farm', gx: 1, gy: 4, w: 1, d: 1 },
  { id: 'tavern', gx: 5, gy: 5, w: 1, d: 1 },
  { id: 'market', gx: 3, gy: 6, w: 1, d: 1 },
];

/** 중앙 사령부 — 기능 없는 상징물 */
const HQ = { gx: 3, gy: 2, w: 2, d: 2 };

/** 빈 구역을 채우는 소품 */
const PROPS: { gx: number; gy: number; kind: 'crates' | 'mast' | 'pad' | 'pipe' }[] = [
  { gx: 0, gy: 0, kind: 'mast' },
  { gx: 2, gy: 1, kind: 'crates' },
  { gx: 5, gy: 1, kind: 'pipe' },
  { gx: 7, gy: 0, kind: 'crates' },
  { gx: 0, gy: 2, kind: 'pipe' },
  { gx: 5, gy: 2, kind: 'crates' },
  { gx: 7, gy: 2, kind: 'mast' },
  { gx: 2, gy: 3, kind: 'pad' },
  { gx: 0, gy: 4, kind: 'crates' },
  { gx: 3, gy: 4, kind: 'pipe' },
  { gx: 6, gy: 5, kind: 'crates' },
  { gx: 7, gy: 4, kind: 'pipe' },
  { gx: 0, gy: 6, kind: 'mast' },
  { gx: 1, gy: 5, kind: 'crates' },
  { gx: 4, gy: 5, kind: 'pad' },
  { gx: 5, gy: 6, kind: 'crates' },
  { gx: 7, gy: 6, kind: 'pipe' },
];

/** 화면 좌표 기준 클릭 영역 (그릴 때 채운다) */
const hitAreas: { id: string; x: number; y: number; w: number; h: number }[] = [];

// ── 배경 이미지 (있으면 대체) ────────────────────────────────
const cityImg = new Image();
const CANDIDATES = ['/assets/city/base.png', '/assets/city/base.jpg'];
let tryIdx = 0;
cityImg.onerror = () => {
  tryIdx++;
  if (tryIdx < CANDIDATES.length) cityImg.src = CANDIDATES[tryIdx];
};
cityImg.src = CANDIDATES[0];
const imgReady = () => cityImg.complete && cityImg.naturalWidth > 0;

/** 좌표 해시 — 다시 그려도 지형이 흔들리지 않게 */
function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export function buildingAt(px: number, py: number): string | null {
  // 앞에 그려진(=아래쪽) 건물이 우선
  for (let i = hitAreas.length - 1; i >= 0; i--) {
    const a = hitAreas[i];
    if (px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h) return a.id;
  }
  return null;
}

// ── 프리미티브 ───────────────────────────────────────────────

/** 바닥 타일 (직사각형) */
function tile(ctx: CanvasRenderingContext2D, gx: number, gy: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(tileX(gx), tileY(gy), TW, TH);
}

/**
 * 캐비닛 투영 상자. (gx,gy)에서 w×d 타일을 차지하고 높이 h픽셀.
 * 앞면·윗면·우측면 3면을 그린다.
 *
 * 돌려주는 W/S/E는 창문을 찍을 두 면의 모서리다:
 *   W→S = 앞면 아래 모서리, S→E = 우측면 아래 모서리
 */
function box(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  w: number,
  d: number,
  h: number,
  face: { top: string; left: string; right: string },
  inset = 10,
): {
  cx: number;
  cy: number;
  top: number;
  N: { x: number; y: number };
  E: { x: number; y: number };
  S: { x: number; y: number };
  W: { x: number; y: number };
} {
  const pad = (TW * inset) / 100;
  const x = tileX(gx) + pad;
  const bw = TW * w - pad * 2;
  // 바닥선: 타일 아래쪽에서 깊이만큼 올려 세운다
  const baseY = tileY(gy) + TH * d - pad * 0.8;
  const topY = baseY - h;

  // 바닥 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath();
  ctx.ellipse(x + bw / 2 + DX / 2, baseY + 2, bw * 0.62, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // 우측면
  ctx.beginPath();
  ctx.moveTo(x + bw, baseY);
  ctx.lineTo(x + bw + DX, baseY - DY);
  ctx.lineTo(x + bw + DX, topY - DY);
  ctx.lineTo(x + bw, topY);
  ctx.closePath();
  ctx.fillStyle = face.right;
  ctx.fill();

  // 윗면
  ctx.beginPath();
  ctx.moveTo(x, topY);
  ctx.lineTo(x + DX, topY - DY);
  ctx.lineTo(x + bw + DX, topY - DY);
  ctx.lineTo(x + bw, topY);
  ctx.closePath();
  ctx.fillStyle = face.top;
  ctx.fill();

  // 앞면
  ctx.beginPath();
  ctx.rect(x, topY, bw, h);
  ctx.fillStyle = face.left;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, topY + 0.5, bw - 1, h - 1);

  return {
    cx: x + bw / 2,
    cy: topY,
    top: topY,
    N: { x: x + DX, y: topY - DY },
    E: { x: x + bw + DX, y: baseY - DY },
    S: { x: x + bw, y: baseY },
    W: { x, y: baseY },
  };
}

/**
 * 상자 옆면에 발광 창문을 박는다. 어두운 배경에서 '가동 중인 시설' 느낌을 만드는
 * 가장 효과적인 요소라 대부분의 건물에 넣는다.
 */
function windows(
  ctx: CanvasRenderingContext2D,
  b: ReturnType<typeof box>,
  h: number,
  rows: number,
  cols: number,
  color: string,
  t: number,
  seed = 0,
): void {
  const faces: [{ x: number; y: number }, { x: number; y: number }][] = [
    [b.W, b.S],
    [b.S, b.E],
  ];
  faces.forEach(([p0, p1], fi) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = (c + 1) / (cols + 1);
        const v = (r + 1) / (rows + 1);
        const x = p0.x + (p1.x - p0.x) * u;
        const y = p0.y + (p1.y - p0.y) * u - h * v;
        const k = Math.sin(seed * 3.1 + fi * 2.7 + r * 1.9 + c * 4.3);
        if (k < -0.35) continue;
        const flick = 0.55 + 0.45 * Math.sin(t / 900 + seed + r + c * 2);
        ctx.globalAlpha = 0.35 + 0.5 * flick;
        ctx.fillStyle = color;
        ctx.fillRect(x - 2, y - 2.5, 4, 4);
        ctx.globalAlpha = 1;
      }
    }
  });
}

const STEEL = { top: C.steelTop, left: C.steel, right: C.steelDark };

/** 건물별 강조색 — 윗면에 물들여 종류를 구분한다 */
const TINT: Record<string, string> = {
  sawmill: '#8a6a3a',
  quarry: '#8a4f3a',
  farm: '#4a7a55',
  'crystal-mine': '#3f7f6d',
  market: '#7a7a8f',
  barracks: '#7a4a4a',
  tavern: '#8a6f45',
  academy: '#40638f',
};

function tinted(id: string): { top: string; left: string; right: string } {
  return { top: TINT[id] ?? C.steelTop, left: C.steel, right: C.steelDark };
}

/** 발광 점 (창문·표시등) */
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  strength = 1,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.55 * strength;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 아이소 원통 */
function cylinder(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  h: number,
  body: string,
  top: string,
): void {
  const ry = rx / 2;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy - h);
  ctx.lineTo(cx - rx, cy);
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(cx + rx, cy - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── 건물별 실루엣 ────────────────────────────────────────────

function drawStructure(
  ctx: CanvasRenderingContext2D,
  id: string,
  s: Slot,
  level: number,
  t: number,
): void {
  const blink = 0.55 + 0.45 * Math.sin(t / 380 + s.gx * 1.7 + s.gy);
  // 레벨이 올라도 높이 차이는 작게 — 모바일에서 건물 크기가 들쭉날쭉하면 읽기 나쁘다
  const h = 30 + Math.min(level, 10) * 0.9;

  switch (id) {
    case 'sawmill': {
      // 채굴장 — 시추 탑
      const b = box(ctx, s.gx, s.gy, s.w, s.d, 16, tinted(id));
      windows(ctx, b, 16, 1, 2, C.amber, t, s.gx);
      ctx.strokeStyle = C.steelTop;
      ctx.lineWidth = 2.5;
      const legs = 16;
      ctx.beginPath();
      ctx.moveTo(b.cx - legs, b.top + 4);
      ctx.lineTo(b.cx, b.top - 30);
      ctx.lineTo(b.cx + legs, b.top + 4);
      ctx.moveTo(b.cx - legs * 0.6, b.top - 10);
      ctx.lineTo(b.cx + legs * 0.6, b.top - 10);
      ctx.stroke();
      ctx.fillStyle = C.hazard;
      ctx.fillRect(b.cx - 3, b.top - 34, 6, 8);
      glow(ctx, b.cx, b.top - 36, 2, C.amber, blink);
      break;
    }
    case 'quarry': {
      // 제련소 — 굴뚝 두 개 + 용광로 빛
      const b = box(ctx, s.gx, s.gy, s.w, s.d, h, tinted(id));
      windows(ctx, b, h, 2, 2, '#ffb070', t, s.gx);
      cylinder(ctx, b.cx - 9, b.top + 4, 5, 26, C.steelDark, C.steelTop);
      cylinder(ctx, b.cx + 8, b.top + 6, 4, 18, C.steelDark, C.steelTop);
      glow(ctx, b.cx - 9, b.top - 22, 2.5, '#ff8a3c', blink);
      ctx.fillStyle = 'rgba(255,120,40,0.5)';
      ctx.fillRect(b.cx - 12, b.top + 8, 24, 4);
      break;
    }
    case 'farm': {
      // 보급창 — 낮고 넓은 창고 + 컨테이너
      const b = box(ctx, s.gx, s.gy, s.w, s.d, 20, tinted(id));
      windows(ctx, b, 20, 1, 3, C.glass, t, s.gy);
      const cols = ['#3f6b4a', '#6b5a3f', '#3f556b'];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = cols[i];
        ctx.fillRect(b.cx - 16 + i * 11, b.top - 8, 10, 9);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(b.cx - 16 + i * 11, b.top - 8, 10, 9);
      }
      break;
    }
    case 'crystal-mine': {
      // 가스 추출기 — 탱크 두 기 + 배관
      windows(ctx, box(ctx, s.gx, s.gy, s.w, s.d, 12, tinted(id)), 12, 1, 2, '#5fe0a0', t, s.gx);
      const cx = isoX(s.gx + 0.5, s.gy + 0.5);
      const cy = isoY(s.gx + 0.5, s.gy + 0.5) - 10;
      cylinder(ctx, cx - 10, cy + 6, 8, 22, '#4a6b5f', '#5f8578');
      cylinder(ctx, cx + 10, cy + 10, 6, 16, '#415d53', '#557a6d');
      ctx.strokeStyle = C.steelDark;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 8);
      ctx.lineTo(cx + 10, cy - 2);
      ctx.stroke();
      glow(ctx, cx - 10, cy - 18, 2.5, '#5fe0a0', blink);
      break;
    }
    case 'market': {
      // 거래소 — 통신 접시
      const b = box(ctx, s.gx, s.gy, s.w, s.d, h - 6, tinted(id));
      windows(ctx, b, h - 6, 2, 2, C.glass, t, s.gy);
      const spin = Math.sin(t / 1400);
      ctx.save();
      ctx.translate(b.cx, b.top - 6);
      ctx.scale(1, 0.55);
      ctx.rotate(spin * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, 13, Math.PI * 0.15, Math.PI * 1.85);
      ctx.closePath();
      ctx.fillStyle = '#8c98a6';
      ctx.fill();
      ctx.strokeStyle = '#5d6976';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = C.steelDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.cx, b.top);
      ctx.lineTo(b.cx, b.top - 8);
      ctx.stroke();
      break;
    }
    case 'barracks': {
      // 병영 — 격납고 (아치형 지붕 + 게이트)
      const b = box(ctx, s.gx, s.gy, s.w, s.d, h - 8, tinted(id));
      windows(ctx, b, h - 8, 1, 3, C.accent, t, s.gx + 2);
      ctx.beginPath();
      ctx.ellipse(b.cx, b.top + 2, 22, 12, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#65707d';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.stroke();
      // 격납고 문
      ctx.fillStyle = '#252c34';
      ctx.beginPath();
      ctx.ellipse(b.cx + 8, b.top + 8, 9, 7, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      glow(ctx, b.cx + 8, b.top + 6, 1.8, C.accent, blink);
      // 위험 표시 줄무늬
      ctx.fillStyle = C.hazard;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(b.cx - 20, b.top + 10, 40, 2);
      ctx.globalAlpha = 1;
      break;
    }
    case 'tavern': {
      // 용병 사무소 — 착륙장 + 관제탑
      windows(ctx, box(ctx, s.gx, s.gy, s.w, s.d, 14, tinted(id)), 14, 1, 2, C.amber, t, s.gy);
      const cx = isoX(s.gx + 0.5, s.gy + 0.5);
      const cy = isoY(s.gx + 0.5, s.gy + 0.5) - 12;
      // 착륙 패드
      ctx.beginPath();
      ctx.ellipse(cx + 4, cy + 6, 20, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2d353d';
      ctx.fill();
      ctx.strokeStyle = C.hazard;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      // 관제탑
      cylinder(ctx, cx - 12, cy + 2, 6, 26, C.steelDark, C.steelTop);
      ctx.fillStyle = C.glass;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(cx - 17, cy - 26, 10, 5);
      ctx.globalAlpha = 1;
      glow(ctx, cx + 4, cy + 6, 2, C.amber, blink);
      break;
    }
    case 'academy': {
      // 연구소 — 돔 + 링 안테나
      const b = box(ctx, s.gx, s.gy, s.w, s.d, h - 10, tinted(id));
      windows(ctx, b, h - 10, 2, 2, C.accent, t, s.gx * 2);
      ctx.beginPath();
      ctx.ellipse(b.cx, b.top + 4, 18, 15, 0, Math.PI, 0);
      ctx.closePath();
      const g = ctx.createLinearGradient(b.cx - 18, b.top - 12, b.cx + 18, b.top + 4);
      g.addColorStop(0, '#7c8b9c');
      g.addColorStop(1, '#4d5867');
      ctx.fillStyle = g;
      ctx.fill();
      // 링
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5 + 0.5 * blink;
      ctx.beginPath();
      ctx.ellipse(b.cx, b.top - 6, 22, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      glow(ctx, b.cx, b.top - 14, 2.5, C.accent, blink);
      break;
    }
    default:
      box(ctx, s.gx, s.gy, s.w, s.d, h, STEEL);
  }
}

/** 빈 구역 소품 */
function drawProp(
  ctx: CanvasRenderingContext2D,
  p: { gx: number; gy: number; kind: string },
  t: number,
): void {
  const cx = isoX(p.gx + 0.5, p.gy + 0.5);
  const cy = isoY(p.gx + 0.5, p.gy + 0.5);
  const blink = 0.5 + 0.5 * Math.sin(t / 500 + p.gx + p.gy * 2);

  if (p.kind === 'crates') {
    const cols = ['#4a5a48', '#5a5140', '#40505a'];
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * 11;
      const oy = i === 1 ? -5 : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(cx + ox, cy + 4 + oy, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = cols[i];
      ctx.fillRect(cx + ox - 7, cy - 8 + oy, 14, 12);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + ox - 7, cy - 8 + oy, 14, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(cx + ox - 7, cy - 8 + oy, 14, 3);
    }
  } else if (p.kind === 'mast') {
    ctx.strokeStyle = '#6f7a87';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - 30);
    ctx.moveTo(cx - 7, cy - 4);
    ctx.lineTo(cx, cy - 14);
    ctx.lineTo(cx + 7, cy - 4);
    ctx.stroke();
    glow(ctx, cx, cy - 32, 1.8, '#ff5a4a', blink);
  } else if (p.kind === 'pad') {
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, 22, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2b333b';
    ctx.fill();
    ctx.strokeStyle = C.hazard;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      glow(ctx, cx + Math.cos(a) * 20, cy + 2 + Math.sin(a) * 10, 1.2, C.amber, blink);
    }
  } else {
    // 배관
    ctx.strokeStyle = '#525c68';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy + 6);
    ctx.lineTo(cx + 24, cy - 6);
    ctx.stroke();
    ctx.strokeStyle = '#6a7683';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineCap = 'butt';
    for (let i = -1; i <= 1; i++) {
      ctx.fillStyle = '#414a54';
      ctx.fillRect(cx + i * 16 - 2, cy - i * 4 - 5, 4, 9);
    }
  }
}

/** 중앙 사령부 (장식) */
function drawHQ(ctx: CanvasRenderingContext2D, t: number): void {
  const beacon = 0.5 + 0.5 * Math.sin(t / 300);

  // 1층 — 넓은 기단
  const b1 = box(ctx, HQ.gx, HQ.gy, HQ.w, HQ.d, 22, {
    top: '#4d5763',
    left: '#333b45',
    right: '#454f5a',
  });
  windows(ctx, b1, 22, 1, 4, C.glass, t, 11);
  // 기단 강조 띠
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(b1.W.x, b1.W.y - 18);
  ctx.lineTo(b1.S.x, b1.S.y - 18);
  ctx.lineTo(b1.E.x, b1.E.y - 18);
  ctx.stroke();
  ctx.restore();

  // 2층 — 좁고 높은 본체
  const b2 = box(ctx, HQ.gx + 0.28, HQ.gy + 0.28, HQ.w - 0.56, HQ.d - 0.56, 44, {
    top: '#5d6874',
    left: '#3a434e',
    right: '#4f5a66',
  });
  windows(ctx, b2, 44, 2, 3, C.glass, t, 5);

  // 관제 링 (돌아가는 느낌)
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.35 * beacon;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.ellipse(b2.cx, b2.top + 4, 34, 15, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 옥상 관제탑
  const b3 = box(ctx, HQ.gx + 0.72, HQ.gy + 0.72, 0.56, 0.56, 58, {
    top: '#79858f',
    left: '#3f4852',
    right: '#586470',
  });
  ctx.fillStyle = C.glass;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(b3.cx - 11, b3.top + 4, 22, 5);
  ctx.globalAlpha = 1;

  // 안테나 배열
  ctx.strokeStyle = '#95a1af';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(b3.cx, b3.top + 2);
  ctx.lineTo(b3.cx, b3.top - 30);
  ctx.moveTo(b3.cx - 9, b3.top - 14);
  ctx.lineTo(b3.cx + 9, b3.top - 20);
  ctx.stroke();
  glow(ctx, b3.cx, b3.top - 32, 3.2, '#ff5a4a', beacon);

  // 바닥에 번지는 조명
  ctx.save();
  const spill = ctx.createRadialGradient(b1.cx, b1.cy + 26, 4, b1.cx, b1.cy + 26, 74);
  spill.addColorStop(0, 'rgba(53,199,224,0.20)');
  spill.addColorStop(1, 'rgba(53,199,224,0)');
  ctx.fillStyle = spill;
  ctx.beginPath();
  ctx.ellipse(b1.cx, b1.cy + 26, 74, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
  hitAreas.length = 0;

  if (imgReady()) {
    ctx.clearRect(0, 0, CITY_W, CITY_H);
    ctx.drawImage(cityImg, 0, 0, CITY_W, CITY_H);
    return;
  }

  const t = now;

  // ── 기지 바닥: 화면 전체를 덮는 격자 데크 ──
  for (let gy = 0; gy < ROWS; gy++) {
    for (let gx = 0; gx < COLS; gx++) {
      const r = hash(gx * 31, gy * 17);
      tile(ctx, gx, gy, r < 0.5 ? C.deckA : C.deckB);
    }
  }
  // 원경 명암 — 위쪽이 어두워 깊이가 생긴다
  const depth = ctx.createLinearGradient(0, 0, 0, CITY_H);
  depth.addColorStop(0, 'rgba(0,0,0,0.45)');
  depth.addColorStop(0.45, 'rgba(0,0,0,0.10)');
  depth.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = depth;
  ctx.fillRect(0, 0, CITY_W, CITY_H);

  // 패널 라인
  ctx.strokeStyle = C.deckLine;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  for (let i = 0; i <= COLS; i++) {
    ctx.beginPath();
    ctx.moveTo(tileX(i), 0);
    ctx.lineTo(tileX(i), CITY_H);
    ctx.stroke();
  }
  for (let i = 0; i <= ROWS; i++) {
    ctx.beginPath();
    ctx.moveTo(0, tileY(i));
    ctx.lineTo(CITY_W, tileY(i));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ── 방벽: 화면 가장자리를 두르는 테두리 + 에너지 장막 ──
  const barrier = 0.45 + 0.25 * Math.sin(t / 700);
  const m = 3;
  ctx.strokeStyle = C.wallDark;
  ctx.lineWidth = 10;
  ctx.strokeRect(m, m, CITY_W - m * 2, CITY_H - m * 2);
  ctx.strokeStyle = C.wall;
  ctx.lineWidth = 5;
  ctx.strokeRect(m, m, CITY_W - m * 2, CITY_H - m * 2);
  ctx.save();
  ctx.globalAlpha = barrier;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 8;
  ctx.strokeRect(m + 5, m + 5, CITY_W - (m + 5) * 2, CITY_H - (m + 5) * 2);
  ctx.restore();

  // 방벽 기둥 — 가장자리를 따라 일정 간격으로
  const posts: [number, number][] = [];
  for (let i = 0; i <= COLS; i += 2) {
    posts.push([tileX(i), 6], [tileX(i), CITY_H - 6]);
  }
  for (let i = 1; i < ROWS; i += 2) {
    posts.push([6, tileY(i)], [CITY_W - 6, tileY(i)]);
  }
  for (const [x, y] of posts) {
    ctx.fillStyle = C.wallDark;
    ctx.fillRect(x - 4, y - 12, 8, 16);
    ctx.fillStyle = C.wallTop;
    ctx.fillRect(x - 5, y - 15, 10, 4);
    glow(ctx, x, y - 16, 1.5, C.accent, barrier);
  }

  // ── 건물·소품: 뒤(작은 gx+gy)부터 앞으로 ──
  const order = [
    ...SLOTS.map((s) => ({ kind: 'slot' as const, s, prop: null, depth: s.gx + s.gy })),
    ...PROPS.map((p) => ({ kind: 'prop' as const, s: null, prop: p, depth: p.gx + p.gy })),
    { kind: 'hq' as const, s: null, prop: null, depth: HQ.gx + HQ.gy + 0.5 },
  ].sort((a, b) => a.depth - b.depth);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const item of order) {
    if (item.kind === 'hq') {
      drawHQ(ctx, t);
      continue;
    }
    if (item.kind === 'prop') {
      drawProp(ctx, item.prop!, t);
      continue;
    }
    const s = item.s!;
    const b = state.buildings.find((x) => x.defId === s.id);
    const def = defs.get(s.id);
    const level = b?.level ?? 0;
    const cx = isoX(s.gx + s.w / 2, s.gy + s.d / 2);
    const cy = isoY(s.gx + s.w / 2, s.gy + s.d / 2);

    if (level < 1) {
      // 미건설 부지 — 점선 구획 + 이름
      tile(ctx, s.gx, s.gy, 'rgba(20,26,32,0.55)');
      ctx.save();
      ctx.strokeStyle = 'rgba(224,181,104,0.5)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(isoX(s.gx, s.gy), isoY(s.gx, s.gy));
      ctx.lineTo(isoX(s.gx + 1, s.gy), isoY(s.gx + 1, s.gy));
      ctx.lineTo(isoX(s.gx + 1, s.gy + 1), isoY(s.gx + 1, s.gy + 1));
      ctx.lineTo(isoX(s.gx, s.gy + 1), isoY(s.gx, s.gy + 1));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.font = '10px sans-serif';
      ctx.fillText(def?.name ?? s.id, cx, cy + TH / 2 - 2);
      hitAreas.push({ id: s.id, x: cx - TW / 2, y: cy - 4, w: TW, h: TH + 8 });
    } else {
      drawStructure(ctx, s.id, s, level, t);
      hitAreas.push({ id: s.id, x: cx - TW / 2 - 4, y: cy - 46, w: TW + 8, h: 60 });

      // 레벨 배지
      const bx = cx + 15;
      const by = cy + 10;
      ctx.fillStyle = 'rgba(12,16,20,0.85)';
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(53,199,224,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(String(level), bx, by + 1);
    }

    // 건설 중
    if (state.upgradeQueue?.defId === s.id) {
      const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
      const pulse = 0.5 + 0.5 * Math.sin(t / 240);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.35 * pulse;
      ctx.fillStyle = C.hazard;
      ctx.beginPath();
      ctx.moveTo(isoX(s.gx, s.gy), isoY(s.gx, s.gy));
      ctx.lineTo(isoX(s.gx + 1, s.gy), isoY(s.gx + 1, s.gy));
      ctx.lineTo(isoX(s.gx + 1, s.gy + 1), isoY(s.gx + 1, s.gy + 1));
      ctx.lineTo(isoX(s.gx, s.gy + 1), isoY(s.gx, s.gy + 1));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeText(`⚙ ${remain}s`, cx, cy - 42);
      ctx.fillText(`⚙ ${remain}s`, cx, cy - 42);
    }

    // 선택 표시
    if (selectedId === s.id) {
      ctx.save();
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.shadowColor = C.accent;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(isoX(s.gx, s.gy), isoY(s.gx, s.gy));
      ctx.lineTo(isoX(s.gx + 1, s.gy), isoY(s.gx + 1, s.gy));
      ctx.lineTo(isoX(s.gx + 1, s.gy + 1), isoY(s.gx + 1, s.gy + 1));
      ctx.lineTo(isoX(s.gx, s.gy + 1), isoY(s.gx, s.gy + 1));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── 화면 전체 비네팅 (깊이감) ──
  const vig = ctx.createRadialGradient(
    CITY_W / 2,
    CITY_H / 2,
    CITY_H * 0.35,
    CITY_W / 2,
    CITY_H / 2,
    CITY_H * 0.85,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, CITY_W, CITY_H);
}

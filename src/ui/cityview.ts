import type { GameState } from '../core/types';
import {
  buildingAtCell,
  buildJob,
  GRID_COLS,
  GRID_ROWS,
  isBuilding,
  placedBuildings,
  type Cell,
} from '../core/city';

/**
 * 기지 화면 — 정면 시점 + 바둑판 부지.
 *
 * 화면을 마주 보는 쪽이 '면'이 되도록(모서리가 아니라) 축 정렬 격자를 쓴다.
 * 바닥은 6×6=36칸 바둑판이고 한 칸에 건물 하나가 선다. 건물만 캐비닛 투영
 * (앞면 + 윗면 + 우측면)으로 그려 평면처럼 보이지 않게 한다.
 *
 * 화면을 두르는 테두리는 장식이 아니라 성벽 건물(rampart) 그 자체다.
 * 레벨이 오르면 두꺼워지고 성가퀴·망루가 붙는다. 남쪽(6시) 한가운데는
 * 출입구로 비워 두고, 거기에 성문(gate)을 세울 수 있다.
 *
 * 어느 건물이 어느 칸에 있는지는 저장 상태(CityBuilding.col/row)가 들고 있다.
 * 여기서는 그걸 읽어 그리기만 하고, 드래그 중에는 setDragGhost()로 받은
 * 미리보기를 얹는다.
 *
 * public/assets/city/base.png 를 두면 그 이미지를 바닥 배경으로 대신 쓴다.
 */

export const CITY_W = 480;
export const CITY_H = 430;

/** 성벽 건물 id — 화면 테두리가 이 건물이다 */
export const WALL_ID = 'rampart';
/** 성문 건물 id — 남쪽 성벽 한가운데 */
export const GATE_ID = 'gate';

/** 성벽 두께 (레벨 0 기준. 레벨이 오르면 조금씩 두꺼워진다) */
const WALL = 18;
/** 성문 폭 */
const GATE_W = 92;
const AREA_X = WALL;
const AREA_Y = WALL;
const AREA_W = CITY_W - WALL * 2;
const AREA_H = CITY_H - WALL * 2;
const CW = AREA_W / GRID_COLS; // 칸 너비 ≈75.7
const CH = AREA_H / GRID_ROWS; // 칸 높이 ≈67.3

/** 건물 깊이(캐비닛 투영에서 뒤로 밀리는 양) */
const DX = 9;
const DY = 8;

const cellX = (c: number) => AREA_X + c * CW;
const cellY = (r: number) => AREA_Y + r * CH;

// ── 팔레트 ───────────────────────────────────────────────────
const C = {
  groundA: '#8a7550',
  groundB: '#7e6a48',
  groundLine: 'rgba(0,0,0,0.16)',
  grass: '#4e7a3a',
  wallFace: '#9aa0a8',
  wallTop: '#b6bcc4',
  wallDark: '#6d737a',
  body: '#e6dcc4',
  bodyDark: '#c2b696',
  bodySide: '#a89c80',
  door: '#5f4526',
  glass: '#7fb6d8',
  ok: '#7fd39a',
  bad: '#e08a7e',
  gold: '#ffd479',
};

/** 건물별 지붕색과 표식 */
const LOOK: Record<string, { roof: string; icon: string }> = {
  sawmill: { roof: '#8a5a2f', icon: '⛏' },
  quarry: { roof: '#8d939c', icon: '🔥' },
  farm: { roof: '#4a8f4a', icon: '🌾' },
  'crystal-mine': { roof: '#3f8f7d', icon: '💠' },
  market: { roof: '#c9a227', icon: '💰' },
  barracks: { roof: '#b03a30', icon: '⚔' },
  tavern: { roof: '#c9762f', icon: '🎖' },
  academy: { roof: '#3f74b8', icon: '🔬' },
  rampart: { roof: '#7d8794', icon: '🛡' },
  turret: { roof: '#a3453a', icon: '🎯' },
  radar: { roof: '#4a90a8', icon: '📡' },
  // 가공·물류
  'ore-refinery': { roof: '#9c6b3a', icon: '🏭' },
  'alloy-foundry': { roof: '#7f858e', icon: '🔩' },
  'ration-plant': { roof: '#5f9a4a', icon: '🍞' },
  'gas-processor': { roof: '#3f8f8a', icon: '🧪' },
  'power-plant': { roof: '#c9a227', icon: '⚡' },
  warehouse: { roof: '#8a7a5a', icon: '📦' },
  'black-market': { roof: '#5c4a6b', icon: '🃏' },
  // 군사
  'advanced-barracks': { roof: '#8f2f26', icon: '🗡' },
  factory: { roof: '#6f7a86', icon: '🚜' },
  starport: { roof: '#3a6ea8', icon: '🚀' },
  armory: { roof: '#7a5c3a', icon: '🧰' },
  medbay: { roof: '#c46b6b', icon: '🏥' },
  bunker: { roof: '#5f6a52', icon: '🕳' },
  'command-post': { roof: '#4a5a7a', icon: '📋' },
  garage: { roof: '#a8702f', icon: '🏍' },
  'beast-pen': { roof: '#6f8a3a', icon: '🐾' },
  // 방어
  'missile-turret': { roof: '#b04a3a', icon: '💥' },
  'shield-battery': { roof: '#3f7a9c', icon: '🔋' },
  'shield-generator': { roof: '#5a7fb8', icon: '🛡' },
  observatory: { roof: '#4a7f9c', icon: '🔭' },
  // 지휘
  'training-ground': { roof: '#a8863a', icon: '🏋' },
  arena: { roof: '#a85a3a', icon: '🏟' },
  workshop: { roof: '#8a6a3a', icon: '🔨' },
  'relic-vault': { roof: '#7a5f9c', icon: '🏺' },
  'guild-hall': { roof: '#b8873a', icon: '🤝' },
  // 특수
  'warp-gate': { roof: '#6f4aa8', icon: '🌀' },
};

/** 마지막으로 그린 건물들의 클릭 영역 — 건물은 칸보다 위로 솟으므로 칸 계산과 별도로 둔다 */
const hitAreas: { id: string; x: number; y: number; w: number; h: number }[] = [];

/** 드래그 중인 건물의 미리보기 */
export interface DragGhost {
  defId: string;
  /** 손가락(포인터) 위치 — 캔버스 좌표 */
  px: number;
  py: number;
  /** 놓일 칸. 격자 밖이면 null */
  cell: Cell | null;
  /** 여기 놓을 수 있는가 */
  valid: boolean;
}
let ghost: DragGhost | null = null;

export function setDragGhost(next: DragGhost | null): void {
  ghost = next;
}

// ── 배경 이미지 (있으면 바닥 대체) ───────────────────────────
const cityImg = new Image();
const CANDIDATES = ['/assets/city/base.png', '/assets/city/base.jpg'];
let tryIdx = 0;
cityImg.onerror = () => {
  tryIdx++;
  if (tryIdx < CANDIDATES.length) cityImg.src = CANDIDATES[tryIdx];
};
cityImg.src = CANDIDATES[0];
const imgReady = () => cityImg.complete && cityImg.naturalWidth > 0;

// ── 건물 아이콘 (public/assets/buildings/<id>.png 가 있으면 코드 그림 대신 쓴다) ──
const iconCache = new Map<string, HTMLImageElement>();
/**
 * 아이콘이 준비됐으면 반환, 아직 로딩 중이거나 파일이 없으면 null.
 * null이면 지금까지처럼 코드로 상자를 그린다 — 아이콘을 덜 받아둔 상태에서도 화면이 깨지지 않는다.
 */
function buildingIcon(id: string): HTMLImageElement | null {
  let img = iconCache.get(id);
  if (!img) {
    img = new Image();
    img.src = '/assets/buildings/' + id + '.png';
    iconCache.set(id, img);
  }
  // 404여도 complete는 true가 되므로 naturalWidth로 실제 로드 여부를 가린다
  return img.complete && img.naturalWidth > 0 ? img : null;
}


/** 캔버스 좌표 → 건물 id ('__hq' 포함). 건물 그림 위를 눌렀을 때만 잡힌다 */
export function buildingAt(px: number, py: number): string | null {
  for (let i = hitAreas.length - 1; i >= 0; i--) {
    const a = hitAreas[i];
    if (px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h) return a.id;
  }
  return null;
}

/** 캔버스 좌표 → 부지 칸. 성벽 위 등 격자 밖이면 null */
export function cellAt(px: number, py: number): Cell | null {
  const c = Math.floor((px - AREA_X) / CW);
  const r = Math.floor((py - AREA_Y) / CH);
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return null;
  return { c, r };
}

// ── 그리기 도우미 ────────────────────────────────────────────

/** 캐비닛 투영 상자: 앞면 + 윗면 + 우측면 */
function box(
  ctx: CanvasRenderingContext2D,
  x: number,
  yBase: number,
  w: number,
  h: number,
  front: string,
  top: string,
  side: string,
): void {
  const yTop = yBase - h;
  // 우측면
  ctx.beginPath();
  ctx.moveTo(x + w, yBase);
  ctx.lineTo(x + w + DX, yBase - DY);
  ctx.lineTo(x + w + DX, yTop - DY);
  ctx.lineTo(x + w, yTop);
  ctx.closePath();
  ctx.fillStyle = side;
  ctx.fill();
  // 윗면
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x + DX, yTop - DY);
  ctx.lineTo(x + w + DX, yTop - DY);
  ctx.lineTo(x + w, yTop);
  ctx.closePath();
  ctx.fillStyle = top;
  ctx.fill();
  // 앞면
  ctx.fillStyle = front;
  ctx.fillRect(x, yTop, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, yTop + 0.5, w - 1, h - 1);
}

/** 맞배지붕 (앞에서 본 삼각형 + 우측 경사면) */
function roof(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  // 우측 경사면
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w / 2, y - h);
  ctx.lineTo(x + w / 2 + DX, y - h - DY);
  ctx.lineTo(x + w + DX, y - DY);
  ctx.closePath();
  ctx.fillStyle = shade(color, -0.22);
  ctx.fill();
  // 앞면 삼각형
  ctx.beginPath();
  ctx.moveTo(x - 3, y);
  ctx.lineTo(x + w / 2, y - h);
  ctx.lineTo(x + w + 3, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function shadow(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, y + 2, w * 0.52, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function lamp(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, k: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, 11);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.55 * k;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
}

// ── 성벽 · 성문 ──────────────────────────────────────────────

/** 성벽 레벨에 따른 겉모습. 흙벽 → 석벽 → 망루 딸린 성벽 */
function wallStyle(level: number): {
  face: string;
  top: string;
  dark: string;
  /** 성가퀴 간격. 0이면 안 붙는다 */
  merlon: number;
  tower: boolean;
} {
  if (level < 1) return { face: '#7a6647', top: '#8d7757', dark: '#57492f', merlon: 0, tower: false };
  if (level < 4) {
    return { face: C.wallFace, top: C.wallTop, dark: C.wallDark, merlon: 22, tower: false };
  }
  if (level < 7) {
    return { face: '#a6adb6', top: '#c3c9d1', dark: '#767c84', merlon: 18, tower: true };
  }
  return { face: '#b3bac4', top: '#d2d8df', dark: '#828992', merlon: 14, tower: true };
}

const gateX0 = () => (CITY_W - GATE_W) / 2;

/** 성벽 면에 돌 이음매를 새긴다 (dir='h'면 가로벽, 'v'면 세로벽) */
function stoneJoints(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
  dir: 'h' | 'v',
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  const step = 16;
  ctx.beginPath();
  if (dir === 'h') {
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    for (let i = 0, px = x; px < x + w; i++, px += step) {
      const off = i % 2 === 0 ? 0 : step / 2;
      ctx.moveTo(px + off, y);
      ctx.lineTo(px + off, y + h / 2);
      ctx.moveTo(px + off + step / 2, y + h / 2);
      ctx.lineTo(px + off + step / 2, y + h);
    }
  } else {
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    for (let i = 0, py = y; py < y + h; i++, py += step) {
      const off = i % 2 === 0 ? 0 : step / 2;
      ctx.moveTo(x, py + off);
      ctx.lineTo(x + w / 2, py + off);
      ctx.moveTo(x + w / 2, py + off + step / 2);
      ctx.lineTo(x + w, py + off + step / 2);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** 성벽 뒤쪽(위·좌·우) — 건물보다 먼저 그려 건물이 앞에 서게 한다 */
function drawWallBack(ctx: CanvasRenderingContext2D, level: number, selected: boolean): void {
  const s = wallStyle(level);

  ctx.fillStyle = s.dark;
  ctx.fillRect(0, 0, CITY_W, WALL);
  ctx.fillRect(0, 0, WALL, CITY_H);
  ctx.fillRect(CITY_W - WALL, 0, WALL, CITY_H);
  ctx.fillStyle = s.face;
  ctx.fillRect(2, 2, CITY_W - 4, WALL - 4);
  ctx.fillRect(2, 2, WALL - 4, CITY_H - 4);
  ctx.fillRect(CITY_W - WALL + 2, 2, WALL - 4, CITY_H - 4);

  // 돌 이음매 — 테두리가 '벽'으로 읽히게
  stoneJoints(ctx, s.dark, 2, 2, CITY_W - 4, WALL - 4, 'h');
  stoneJoints(ctx, s.dark, 2, 2, WALL - 4, CITY_H - 4, 'v');
  stoneJoints(ctx, s.dark, CITY_W - WALL + 2, 2, WALL - 4, CITY_H - 4, 'v');

  if (s.merlon) {
    ctx.fillStyle = s.top;
    const m = s.merlon * 0.55;
    for (let x = 4; x < CITY_W - 8; x += s.merlon) ctx.fillRect(x, 1, m, 5);
    for (let y = 4; y < CITY_H - 8; y += s.merlon) {
      ctx.fillRect(1, y, 5, m);
      ctx.fillRect(CITY_W - 6, y, 5, m);
    }
  }

  if (s.tower) {
    const T = WALL * 1.8;
    const corners: [number, number][] = [
      [0, 0],
      [CITY_W - T, 0],
      [0, CITY_H - T],
      [CITY_W - T, CITY_H - T],
    ];
    for (const [tx, ty] of corners) {
      ctx.fillStyle = s.dark;
      ctx.fillRect(tx, ty, T, T);
      ctx.fillStyle = s.face;
      ctx.fillRect(tx + 2, ty + 2, T - 4, T - 4);
      ctx.fillStyle = s.top;
      ctx.fillRect(tx + T * 0.28, ty + T * 0.28, T * 0.44, T * 0.44);
    }
  }

  hitAreas.push({ id: WALL_ID, x: 0, y: 0, w: CITY_W, h: WALL });
  hitAreas.push({ id: WALL_ID, x: 0, y: 0, w: WALL, h: CITY_H });
  hitAreas.push({ id: WALL_ID, x: CITY_W - WALL, y: 0, w: WALL, h: CITY_H });

  if (selected) {
    ctx.save();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = 8;
    ctx.strokeRect(1, 1, CITY_W - 2, CITY_H - 2);
    ctx.restore();
  }
}

/** 성벽 앞쪽(아래) + 성문 — 건물보다 나중에 그려 앞에 선다 */
function drawWallFront(
  ctx: CanvasRenderingContext2D,
  level: number,
  gateLevel: number,
  gateBuilding: boolean,
  selectedId: string | null,
): void {
  const s = wallStyle(level);
  const y = CITY_H - WALL;
  const x0 = gateX0();
  const x1 = x0 + GATE_W;

  // 출입구를 남기고 좌우 두 토막
  for (const [a, b] of [
    [0, x0],
    [x1, CITY_W],
  ]) {
    ctx.fillStyle = s.dark;
    ctx.fillRect(a, y, b - a, WALL);
    ctx.fillStyle = s.face;
    ctx.fillRect(a + 2, y + 2, b - a - 4, WALL - 4);
    stoneJoints(ctx, s.dark, a + 2, y + 2, b - a - 4, WALL - 4, 'h');
    if (s.merlon) {
      ctx.fillStyle = s.top;
      for (let x = a + 3; x < b - 6; x += s.merlon) ctx.fillRect(x, CITY_H - 6, s.merlon * 0.55, 5);
    }
    hitAreas.push({ id: WALL_ID, x: a, y, w: b - a, h: WALL });
  }

  drawGate(ctx, s, gateLevel, gateBuilding, selectedId === GATE_ID);

  if (selectedId === WALL_ID) {
    ctx.save();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = 8;
    ctx.strokeRect(1, 1, CITY_W - 2, CITY_H - 2);
    ctx.restore();
  }
}

/** 남쪽 성벽 한가운데 출입구. 안 지었으면 뚫린 통로로 남는다 */
function drawGate(
  ctx: CanvasRenderingContext2D,
  s: ReturnType<typeof wallStyle>,
  level: number,
  building: boolean,
  selected: boolean,
): void {
  const x0 = gateX0();
  const y = CITY_H - WALL;
  const cx = CITY_W / 2;

  // 진입로 — 성문에서 성 안쪽으로 이어지는 다진 흙길
  const APRON = 16;
  ctx.fillStyle = 'rgba(60,44,26,0.55)';
  ctx.fillRect(x0 + 8, y - APRON, GATE_W - 16, APRON);
  ctx.fillStyle = '#6a5a3c';
  ctx.fillRect(x0, y, GATE_W, WALL);

  // 출입구 양옆 문설주 — 벽이 끊긴 자리라는 걸 분명히 한다
  for (const px of [x0 - 7, x0 + GATE_W - 1]) {
    ctx.fillStyle = s.dark;
    ctx.fillRect(px, y - 4, 8, WALL + 4);
    ctx.fillStyle = s.top;
    ctx.fillRect(px + 1, y - 4, 6, 4);
  }

  if (level < 1) {
    // 아직 문이 없다 — 지을 수 있는 자리로 표시
    ctx.strokeStyle = selected ? C.gold : 'rgba(255,212,121,0.6)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeRect(x0 + 2, y - APRON + 2, GATE_W - 4, WALL + APRON - 4);
    ctx.setLineDash([]);
    ctx.fillStyle = selected ? C.gold : 'rgba(255,212,121,0.85)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('＋ 성문', cx, y - APRON / 2 + 1);
    hitAreas.push({ id: GATE_ID, x: x0 - 7, y: y - APRON, w: GATE_W + 14, h: WALL + APRON });
    return;
  }

  // 문루 — 레벨이 오르면 위로 솟는다
  const th = 8 + Math.min(level, 5) * 4;
  ctx.fillStyle = s.dark;
  ctx.fillRect(x0 - 8, y - th, GATE_W + 16, th + WALL);
  ctx.fillStyle = s.face;
  ctx.fillRect(x0 - 6, y - th + 2, GATE_W + 12, th + WALL - 4);
  ctx.fillStyle = s.top;
  for (let x = x0 - 5; x < x0 + GATE_W + 8; x += 12) ctx.fillRect(x, y - th, 7, 4);

  // 문 두 짝
  const dw = GATE_W * 0.44;
  const dh = th + WALL - 12;
  const dy = y - th + 8;
  for (const dx of [cx - dw - 1, cx + 1]) {
    ctx.fillStyle = '#5f3f22';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
    ctx.fillStyle = '#b08d4a';
    ctx.fillRect(dx + 2, dy + dh * 0.28, dw - 4, 2.5);
    ctx.fillRect(dx + 2, dy + dh * 0.68, dw - 4, 2.5);
  }
  ctx.fillStyle = '#d8c48a';
  ctx.beginPath();
  ctx.arc(cx - 4, dy + dh * 0.5, 2, 0, Math.PI * 2);
  ctx.arc(cx + 4, dy + dh * 0.5, 2, 0, Math.PI * 2);
  ctx.fill();

  // 레벨 배지
  ctx.fillStyle = 'rgba(12,16,20,0.85)';
  ctx.beginPath();
  ctx.arc(x0 + GATE_W + 6, y - 2, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,212,121,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.font = 'bold 10px sans-serif';
  ctx.fillText(String(level), x0 + GATE_W + 6, y - 1);

  if (building) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText('⚙', cx, y - th - 6);
    ctx.fillText('⚙', cx, y - th - 6);
  }

  hitAreas.push({ id: GATE_ID, x: x0 - 8, y: y - th, w: GATE_W + 16, h: th + WALL });

  if (selected) {
    ctx.save();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.shadowColor = C.gold;
    ctx.shadowBlur = 8;
    ctx.strokeRect(x0 - 8, y - th, GATE_W + 16, th + WALL);
    ctx.restore();
  }
}

function dashedCell(
  ctx: CanvasRenderingContext2D,
  c: number,
  r: number,
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = width;
  ctx.strokeRect(cellX(c) + 8, cellY(r) + 10, CW - 16, CH - 20);
  ctx.setLineDash([]);
}

// ── 건물 ─────────────────────────────────────────────────────

/**
 * 한 칸에 건물 하나. 칸 중앙 하단을 기준으로 세운다.
 * cx/cy를 넘기면 그 위치에 그린다(드래그 미리보기).
 */
function drawBuilding(
  ctx: CanvasRenderingContext2D,
  id: string,
  cx: number,
  baseY: number,
  level: number,
  t: number,
): void {
  const look = LOOK[id] ?? { roof: '#8a8a8a', icon: '?' };
  const blink = 0.5 + 0.5 * Math.sin(t / 420 + cx * 0.02);

  // 3D 아이콘이 있으면 그걸로 대체한다. 칸 하단 중앙에 세우고 레벨만큼 조금 커진다.
  // (아이콘에 자체 받침대가 있어 shadow()는 생략한다)
  const icon = buildingIcon(id);
  if (icon) {
    const size = CH * 1.02 + Math.min(level, 10) * 1.6;
    ctx.drawImage(icon, cx - size / 2, baseY - size + CH * 0.06, size, size);
    if (id === 'turret' || id === 'radar' || id === 'academy') {
      lamp(ctx, cx + size * 0.32, baseY - size * 0.78, C.gold, blink);
    }
    return;
  }

  const w = CW * 0.62;
  const h = CH * 0.34 + Math.min(level, 10) * 1.1;
  const x = cx - w / 2;

  shadow(ctx, cx, baseY, w);
  box(ctx, x, baseY, w, h, C.body, C.bodyDark, C.bodySide);
  roof(ctx, x, baseY - h, w, CH * 0.26, look.roof);

  // 문·창
  ctx.fillStyle = C.door;
  ctx.fillRect(cx - w * 0.11, baseY - h * 0.55, w * 0.22, h * 0.55);
  ctx.fillStyle = C.glass;
  ctx.fillRect(x + w * 0.12, baseY - h * 0.78, w * 0.16, h * 0.26);
  ctx.fillRect(x + w * 0.72, baseY - h * 0.78, w * 0.16, h * 0.26);

  // 건물별 표식
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '13px serif';
  ctx.fillText(look.icon, cx, baseY - h - CH * 0.12);

  // 몇몇 건물은 등불
  if (id === 'turret' || id === 'radar' || id === 'academy') {
    lamp(ctx, cx + w * 0.5, baseY - h - CH * 0.2, C.gold, blink);
  }
}

// ── 메인 ─────────────────────────────────────────────────────

export function drawCity(
  canvas: HTMLCanvasElement,
  state: GameState,
  selectedId: string | null,
  selectedCell: Cell | null,
  now: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  hitAreas.length = 0;
  const t = now;

  // ── 바닥 ──
  if (imgReady()) {
    ctx.drawImage(cityImg, 0, 0, CITY_W, CITY_H);
  } else {
    // 성 밖 잔디
    ctx.fillStyle = C.grass;
    ctx.fillRect(0, 0, CITY_W, CITY_H);
    // 바둑판 부지
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        ctx.fillStyle = (c + r) % 2 === 0 ? C.groundA : C.groundB;
        ctx.fillRect(cellX(c), cellY(r), CW, CH);
      }
    }
    // 격자선
    ctx.strokeStyle = C.groundLine;
    ctx.lineWidth = 1;
    for (let c = 0; c <= GRID_COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(cellX(c), AREA_Y);
      ctx.lineTo(cellX(c), AREA_Y + AREA_H);
      ctx.stroke();
    }
    for (let r = 0; r <= GRID_ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(AREA_X, cellY(r));
      ctx.lineTo(AREA_X + AREA_W, cellY(r));
      ctx.stroke();
    }

  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // ── 성벽 뒤쪽(위·좌·우). 건물이 그 앞에 서도록 먼저 그린다 ──
  const wallLevel = state.buildings.find((b) => b.defId === WALL_ID)?.level ?? 0;
  const gateLevel = state.buildings.find((b) => b.defId === GATE_ID)?.level ?? 0;
  drawWallBack(ctx, wallLevel, selectedId === WALL_ID);

  // ── 바닥 표시: 빈 터 · 선택 · 드롭 대상 ──
  const dragging = ghost?.defId ?? null;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const occupant = buildingAtCell(state, c, r);
      const empty = !occupant || occupant.defId === dragging;
      const isSelected = selectedCell?.c === c && selectedCell?.r === r;

      if (empty) {
        // 미개발 부지 — 다진 흙에 점선 구획 + 가운데 십자
        dashedCell(ctx, c, r, isSelected ? C.gold : 'rgba(255,255,255,0.14)', isSelected ? 2 : 1);
        ctx.fillStyle = isSelected ? C.gold : 'rgba(255,255,255,0.22)';
        ctx.font = `${isSelected ? 'bold ' : ''}16px sans-serif`;
        ctx.fillText('+', cellX(c) + CW / 2, cellY(r) + CH / 2);
      }

      // 드래그 중인 손가락 아래 칸
      if (ghost?.cell?.c === c && ghost.cell.r === r) {
        ctx.fillStyle = ghost.valid ? 'rgba(127,211,154,0.22)' : 'rgba(224,138,126,0.22)';
        ctx.fillRect(cellX(c) + 4, cellY(r) + 5, CW - 8, CH - 10);
        ctx.strokeStyle = ghost.valid ? C.ok : C.bad;
        ctx.lineWidth = 2;
        ctx.strokeRect(cellX(c) + 4, cellY(r) + 5, CW - 8, CH - 10);
      }
    }
  }

  // ── 건물: 뒤 행부터 앞 행으로 ──
  interface Item {
    c: number;
    r: number;
    defId: string;
    level: number;
  }
  const items: Item[] = [];
  for (const b of placedBuildings(state)) {
    if (b.defId === dragging) continue; // 드래그 중인 건물은 맨 마지막에 손끝에 그린다
    items.push({ r: b.row, c: b.col, defId: b.defId, level: b.level });
  }
  items.sort((a, b) => a.r - b.r);

  for (const item of items) {
    const { c, r, defId, level } = item;
    const cx = cellX(c) + CW / 2;
    const cy = cellY(r) + CH * 0.82;
    const job = buildJob(state, defId);

    if (level < 1) {
      // 건설 중 — 아직 형태가 없는 공사장
      ctx.globalAlpha = 0.55;
      drawBuilding(ctx, defId, cx, cy, 1, t);
      ctx.globalAlpha = 1;
      dashedCell(ctx, c, r, C.gold, 1.5);
    } else {
      drawBuilding(ctx, defId, cx, cy, level, t);
    }
    hitAreas.push({ id: defId, x: cellX(c) + 4, y: cellY(r) + 2, w: CW - 8, h: CH - 6 });

    // 레벨 배지
    if (level >= 1) {
      ctx.fillStyle = 'rgba(12,16,20,0.85)';
      ctx.beginPath();
      ctx.arc(cx + CW * 0.3, cy - 4, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,212,121,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = C.gold;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(String(level), cx + CW * 0.3, cy - 3);
    }

    // 건설 중 남은 시간
    if (job) {
      const remain = Math.max(0, Math.ceil((job.finishesAt - now) / 1000));
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(`⚙ ${remain}s`, cx, cellY(r) + 10);
      ctx.fillText(`⚙ ${remain}s`, cx, cellY(r) + 10);
    }

    // 선택 표시
    if (selectedId === defId) {
      ctx.save();
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2;
      ctx.shadowColor = C.gold;
      ctx.shadowBlur = 8;
      ctx.strokeRect(cellX(c) + 5, cellY(r) + 6, CW - 10, CH - 12);
      ctx.restore();
    }
  }

  // ── 성벽 앞쪽(아래) + 성문. 가장 가까운 벽이라 건물보다 나중에 그린다 ──
  drawWallFront(ctx, wallLevel, gateLevel, isBuilding(state, GATE_ID), selectedId);

  // ── 드래그 미리보기 — 손끝을 따라다니는 반투명 건물 ──
  if (ghost) {
    const b = state.buildings.find((x) => x.defId === ghost!.defId);
    ctx.globalAlpha = 0.75;
    drawBuilding(ctx, ghost.defId, ghost.px, ghost.py + CH * 0.22, Math.max(1, b?.level ?? 1), t);
    ctx.globalAlpha = 1;
    if (!ghost.valid) {
      ctx.fillStyle = C.bad;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('✕', ghost.px, ghost.py - CH * 0.35);
    }
  }
}

/** 화면 좌표 → 캔버스 좌표 (캔버스는 CSS로 늘어나 있다) */
export function toCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) * canvas.width) / rect.width,
    y: ((clientY - rect.top) * canvas.height) / rect.height,
  };
}

/** 화면(정보 패널)에서 쓰는 칸 이름 — 1부터 센다 */
export function cellLabel(cell: Cell): string {
  return `${cell.r + 1}행 ${cell.c + 1}열`;
}

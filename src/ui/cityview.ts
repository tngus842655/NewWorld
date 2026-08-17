import type { BuildingDef, GameState } from '../core/types';

/**
 * 기지 화면 — 정면 시점 + 바둑판 부지.
 *
 * 화면을 마주 보는 쪽이 '면'이 되도록(모서리가 아니라) 축 정렬 격자를 쓴다.
 * 바닥은 6×6=36칸 바둑판이고 한 칸에 건물 하나가 선다. 건물만 캐비닛 투영
 * (앞면 + 윗면 + 우측면)으로 그려 평면처럼 보이지 않게 한다.
 *
 * 부지 36칸을 미리 확보해 두었으므로, 건물이 늘어도 화면을 다시 설계할 필요가
 * 없다 — SLOTS 에 한 줄 추가하면 그 칸에 들어간다.
 *
 * public/assets/city/base.png 를 두면 그 이미지를 배경으로 대신 쓴다.
 */

export const CITY_W = 480;
export const CITY_H = 430;

/** 성벽 두께 */
const WALL = 13;
/** 부지 격자 */
const COLS = 6;
const ROWS = 6;
const AREA_X = WALL;
const AREA_Y = WALL;
const AREA_W = CITY_W - WALL * 2;
const AREA_H = CITY_H - WALL * 2;
const CW = AREA_W / COLS; // 칸 너비 ≈75.7
const CH = AREA_H / ROWS; // 칸 높이 ≈67.3

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
};

interface Slot {
  id: string;
  c: number;
  r: number;
}

/** 부지 36칸 중 현재 쓰는 11칸 */
const SLOTS: Slot[] = [
  { id: 'sawmill', c: 0, r: 0 },
  { id: 'quarry', c: 2, r: 0 },
  { id: 'crystal-mine', c: 4, r: 0 },
  { id: 'radar', c: 5, r: 1 },
  { id: 'barracks', c: 0, r: 2 },
  { id: 'academy', c: 4, r: 2 },
  { id: 'farm', c: 1, r: 3 },
  { id: 'market', c: 5, r: 3 },
  { id: 'rampart', c: 0, r: 4 },
  { id: 'tavern', c: 2, r: 4 },
  { id: 'turret', c: 5, r: 5 },
];

/** 중앙 사령부 (기능 없음) — 2×2 칸 */
const HQ = { c: 2, r: 1 };

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
};

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

export function buildingAt(px: number, py: number): string | null {
  for (let i = hitAreas.length - 1; i >= 0; i--) {
    const a = hitAreas[i];
    if (px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h) return a.id;
  }
  return null;
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

// ── 건물 ─────────────────────────────────────────────────────

/** 한 칸에 건물 하나. 칸 중앙 하단을 기준으로 세운다. */
function drawBuilding(
  ctx: CanvasRenderingContext2D,
  id: string,
  c: number,
  r: number,
  level: number,
  t: number,
): { cx: number; cy: number } {
  const look = LOOK[id] ?? { roof: '#8a8a8a', icon: '?' };
  const cx = cellX(c) + CW / 2;
  const baseY = cellY(r) + CH * 0.82;
  const blink = 0.5 + 0.5 * Math.sin(t / 420 + c * 1.7 + r);

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
    lamp(ctx, cx + w * 0.5, baseY - h - CH * 0.2, '#ffd479', blink);
  }
  return { cx, cy: baseY };
}

/** 사령부 — 2×2 칸을 쓰는 큰 건물 */
function drawHQ(ctx: CanvasRenderingContext2D, t: number): { cx: number; cy: number } {
  const cx = cellX(HQ.c) + CW;
  const baseY = cellY(HQ.r) + CH * 1.78;
  const w = CW * 1.24;
  const h = CH * 0.72;
  const x = cx - w / 2;

  shadow(ctx, cx, baseY, w);
  box(ctx, x, baseY, w, h, C.body, C.bodyDark, C.bodySide);
  // 2층
  const w2 = w * 0.52;
  box(ctx, cx - w2 / 2, baseY - h, w2, h * 0.5, C.body, C.bodyDark, C.bodySide);
  roof(ctx, cx - w2 / 2, baseY - h - h * 0.5, w2, CH * 0.3, '#7a5fb0');

  // 창문 띠
  ctx.fillStyle = C.glass;
  for (let i = -2; i <= 2; i++) ctx.fillRect(cx + i * (w * 0.16) - 5, baseY - h * 0.72, 10, 12);
  // 정문
  ctx.fillStyle = C.door;
  ctx.fillRect(cx - w * 0.09, baseY - h * 0.42, w * 0.18, h * 0.42);
  // 깃대
  const beacon = 0.5 + 0.5 * Math.sin(t / 300);
  ctx.strokeStyle = '#8c98a6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, baseY - h - h * 0.5 - CH * 0.3);
  ctx.lineTo(cx, baseY - h - h * 0.5 - CH * 0.3 - 18);
  ctx.stroke();
  lamp(ctx, cx, baseY - h - h * 0.5 - CH * 0.3 - 20, '#ff6a55', beacon);
  return { cx, cy: baseY };
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

  // ── 성 밖 잔디 ──
  ctx.fillStyle = C.grass;
  ctx.fillRect(0, 0, CITY_W, CITY_H);

  // ── 바둑판 부지 ──
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (c + r) % 2 === 0 ? C.groundA : C.groundB;
      ctx.fillRect(cellX(c), cellY(r), CW, CH);
    }
  }
  // 격자선
  ctx.strokeStyle = C.groundLine;
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(cellX(c), AREA_Y);
    ctx.lineTo(cellX(c), AREA_Y + AREA_H);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(AREA_X, cellY(r));
    ctx.lineTo(AREA_X + AREA_W, cellY(r));
    ctx.stroke();
  }

  // ── 성벽 (화면을 두르는 사각 테두리) ──
  ctx.fillStyle = C.wallDark;
  ctx.fillRect(0, 0, CITY_W, WALL);
  ctx.fillRect(0, CITY_H - WALL, CITY_W, WALL);
  ctx.fillRect(0, 0, WALL, CITY_H);
  ctx.fillRect(CITY_W - WALL, 0, WALL, CITY_H);
  ctx.fillStyle = C.wallFace;
  ctx.fillRect(2, 2, CITY_W - 4, WALL - 4);
  ctx.fillRect(2, CITY_H - WALL + 2, CITY_W - 4, WALL - 4);
  ctx.fillRect(2, 2, WALL - 4, CITY_H - 4);
  ctx.fillRect(CITY_W - WALL + 2, 2, WALL - 4, CITY_H - 4);
  // 성가퀴
  ctx.fillStyle = C.wallTop;
  for (let x = 4; x < CITY_W - 8; x += 18) {
    ctx.fillRect(x, 1, 10, 5);
    ctx.fillRect(x, CITY_H - 6, 10, 5);
  }
  for (let y = 4; y < CITY_H - 8; y += 18) {
    ctx.fillRect(1, y, 5, 10);
    ctx.fillRect(CITY_W - 6, y, 5, 10);
  }

  // ── 건물: 뒤 행부터 앞 행으로 ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  interface Item {
    r: number;
    slot?: Slot;
    hq?: boolean;
    empty?: { c: number; r: number };
  }
  const items: Item[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const inHQ = c >= HQ.c && c <= HQ.c + 1 && r >= HQ.r && r <= HQ.r + 1;
      if (inHQ) {
        if (c === HQ.c && r === HQ.r) items.push({ r: HQ.r + 1, hq: true });
        continue;
      }
      const slot = SLOTS.find((s) => s.c === c && s.r === r);
      items.push(slot ? { r, slot } : { r, empty: { c, r } });
    }
  }
  items.sort((a, b) => a.r - b.r);

  for (const item of items) {
    if (item.hq) {
      const p = drawHQ(ctx, t);
      hitAreas.push({ id: '__hq', x: p.cx - 40, y: p.cy - 90, w: 80, h: 100 });
      continue;
    }
    if (item.empty) {
      // 미개발 부지 — 다진 흙에 점선 구획
      const { c, r } = item.empty;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(cellX(c) + 8, cellY(r) + 10, CW - 16, CH - 20);
      ctx.setLineDash([]);
      continue;
    }

    const slot = item.slot!;
    const b = state.buildings.find((x) => x.defId === slot.id);
    const def = defs.get(slot.id);
    const level = b?.level ?? 0;
    const cx = cellX(slot.c) + CW / 2;
    const cy = cellY(slot.r) + CH * 0.82;

    if (level < 1) {
      // 건설 가능 부지
      ctx.strokeStyle = 'rgba(255,212,121,0.55)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cellX(slot.c) + 8, cellY(slot.r) + 10, CW - 16, CH - 20);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      const label = def?.name ?? slot.id;
      ctx.font = 'bold 10px sans-serif';
      const lw = ctx.measureText(label).width + 8;
      ctx.fillRect(cx - lw / 2, cy - 20, lw, 14);
      ctx.fillStyle = '#ffd479';
      ctx.fillText(label, cx, cy - 13);
      hitAreas.push({
        id: slot.id,
        x: cellX(slot.c) + 6,
        y: cellY(slot.r) + 8,
        w: CW - 12,
        h: CH - 16,
      });
      continue;
    }

    drawBuilding(ctx, slot.id, slot.c, slot.r, level, t);
    hitAreas.push({
      id: slot.id,
      x: cellX(slot.c) + 4,
      y: cellY(slot.r) + 2,
      w: CW - 8,
      h: CH - 6,
    });

    // 레벨 배지
    ctx.fillStyle = 'rgba(12,16,20,0.85)';
    ctx.beginPath();
    ctx.arc(cx + CW * 0.3, cy - 4, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,212,121,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(String(level), cx + CW * 0.3, cy - 3);

    // 건설 중
    if (state.upgradeQueue?.defId === slot.id) {
      const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(`⚙ ${remain}s`, cx, cellY(slot.r) + 10);
      ctx.fillText(`⚙ ${remain}s`, cx, cellY(slot.r) + 10);
    }

    // 선택 표시
    if (selectedId === slot.id) {
      ctx.save();
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffd479';
      ctx.shadowBlur = 8;
      ctx.strokeRect(cellX(slot.c) + 5, cellY(slot.r) + 6, CW - 10, CH - 12);
      ctx.restore();
    }
  }
}

import type { GameState } from '../core/types';
import { buildingAtCell, GRID_COLS, GRID_ROWS, placedBuildings, type Cell } from '../core/city';

/**
 * 기지 화면 — 정면 시점 + 바둑판 부지.
 *
 * 화면을 마주 보는 쪽이 '면'이 되도록(모서리가 아니라) 축 정렬 격자를 쓴다.
 * 바닥은 6×6=36칸 바둑판이고 한 칸에 건물 하나가 선다. 건물만 캐비닛 투영
 * (앞면 + 윗면 + 우측면)으로 그려 평면처럼 보이지 않게 한다.
 *
 * 어느 건물이 어느 칸에 있는지는 저장 상태(CityBuilding.col/row)가 들고 있다.
 * 여기서는 그걸 읽어 그리기만 하고, 드래그 중에는 setDragGhost()로 받은
 * 미리보기를 얹는다.
 *
 * public/assets/city/base.png 를 두면 그 이미지를 바닥 배경으로 대신 쓴다.
 */

export const CITY_W = 480;
export const CITY_H = 430;

/** 성벽 두께 */
const WALL = 13;
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

    // 성벽 (화면을 두르는 사각 테두리)
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
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

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
    const building = state.upgradeQueue?.defId === defId;

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
    if (building && state.upgradeQueue) {
      const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
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

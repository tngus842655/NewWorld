import type { BuildingDef, GameState } from '../core/types';

/**
 * 기지 화면 — 복셀(마인크래프트풍) 렌더러.
 *
 * 정육면체만 정확히 쌓으면 단순함 자체가 스타일이 되므로, 어설픈 사실화보다
 * 훨씬 안정적으로 보인다. 지형은 화면 밖까지 깔아 여백을 없앤다.
 *
 * 부지는 6×6=36칸을 미리 확보해 두었다. 지금 쓰는 건물은 11개이고 나머지는
 * '미개발 부지'로 표시된다 — 건물이 늘어도 화면을 다시 설계할 필요가 없다.
 *
 * public/assets/city/base.png 를 두면 그 이미지를 배경으로 대신 쓴다.
 */

export const CITY_W = 480;
export const CITY_H = 430;

// ── 복셀 투영 ────────────────────────────────────────────────
/** 블록 윗면 크기와 높이 (약간 가파른 아이소 — 세로 화면을 채우기 위해) */
const BW = 24;
const BD = 15;
const BH = 13;

const ORIGIN_X = CITY_W / 2;
const ORIGIN_Y = 118;

const sx = (x: number, y: number) => (x - y) * (BW / 2) + ORIGIN_X;
const sy = (x: number, y: number, z: number) => (x + y) * (BD / 2) - z * BH + ORIGIN_Y;

// ── 블록 재질 ────────────────────────────────────────────────
interface Mat {
  top: string;
  left: string;
  right: string;
}
const M: Record<string, Mat> = {
  grass: { top: '#6aa84f', left: '#6d5136', right: '#5a4229' },
  dirt: { top: '#8a6b47', left: '#6f5539', right: '#5c462f' },
  path: { top: '#a99372', left: '#84705a', right: '#6e5c4a' },
  stone: { top: '#a0a0a0', left: '#828282', right: '#6d6d6d' },
  cobble: { top: '#8d8d8d', left: '#727272', right: '#5f5f5f' },
  planks: { top: '#bd975e', left: '#997742', right: '#7f6236' },
  log: { top: '#8a6a3e', left: '#6b512e', right: '#573f23' },
  iron: { top: '#dcdcdc', left: '#b4b4b4', right: '#9a9a9a' },
  redBrick: { top: '#a85448', right: '#733a31', left: '#8c453b' },
  blueRoof: { top: '#4a7fc0', left: '#3c689c', right: '#2f5480' },
  greenRoof: { top: '#4f9160', left: '#3f764e', right: '#33603f' },
  goldBlock: { top: '#e0b03a', left: '#b98d2b', right: '#9a7423' },
  glass: { top: '#9fd8ec', left: '#7cb8cf', right: '#67a0b7' },
  lamp: { top: '#ffd98a', left: '#e0b45c', right: '#c69a45' },
  water: { top: '#4a7fd0', left: '#3d69ad', right: '#33578f' },
};

interface Slot {
  id: string;
  px: number;
  py: number;
}

/**
 * 부지 6×6 = 36칸을 미리 확보. 현재 건물 11개를 배치하고 나머지는 비워 둔다.
 * (px, py)는 부지 격자 좌표이며 블록 좌표는 px*PLOT 로 환산한다.
 */
const PLOTS = 6;
const PLOT = 3; // 부지 한 칸 = 3×3 블록

const SLOTS: Slot[] = [
  { id: 'sawmill', px: 1, py: 0 },
  { id: 'quarry', px: 3, py: 0 },
  { id: 'crystal-mine', px: 5, py: 1 },
  { id: 'barracks', px: 0, py: 2 },
  { id: 'academy', px: 4, py: 2 },
  { id: 'farm', px: 1, py: 3 },
  { id: 'market', px: 5, py: 3 },
  { id: 'tavern', px: 2, py: 4 },
  { id: 'rampart', px: 0, py: 4 },
  { id: 'turret', px: 4, py: 5 },
  { id: 'radar', px: 2, py: 1 },
];

/** 중앙 사령부 (기능 없음) — 2×2 부지를 차지 */
const HQ = { px: 2, py: 2 };

/** 화면 좌표 기준 클릭 영역 */
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

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export function buildingAt(px: number, py: number): string | null {
  for (let i = hitAreas.length - 1; i >= 0; i--) {
    const a = hitAreas[i];
    if (px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h) return a.id;
  }
  return null;
}

// ── 블록 그리기 ──────────────────────────────────────────────

function cube(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  z: number,
  mat: Mat,
  alpha = 1,
): void {
  const px = sx(x, y);
  const py = sy(x, y, z);
  if (px < -BW || px > CITY_W + BW || py < -BH * 3 || py > CITY_H + BD * 2) return;

  ctx.globalAlpha = alpha;

  // 윗면
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + BW / 2, py + BD / 2);
  ctx.lineTo(px, py + BD);
  ctx.lineTo(px - BW / 2, py + BD / 2);
  ctx.closePath();
  ctx.fillStyle = mat.top;
  ctx.fill();

  // 좌면
  ctx.beginPath();
  ctx.moveTo(px - BW / 2, py + BD / 2);
  ctx.lineTo(px, py + BD);
  ctx.lineTo(px, py + BD + BH);
  ctx.lineTo(px - BW / 2, py + BD / 2 + BH);
  ctx.closePath();
  ctx.fillStyle = mat.left;
  ctx.fill();

  // 우면
  ctx.beginPath();
  ctx.moveTo(px, py + BD);
  ctx.lineTo(px + BW / 2, py + BD / 2);
  ctx.lineTo(px + BW / 2, py + BD / 2 + BH);
  ctx.lineTo(px, py + BD + BH);
  ctx.closePath();
  ctx.fillStyle = mat.right;
  ctx.fill();

  ctx.globalAlpha = 1;
}

/** 블록 여러 개를 상자 모양으로 (속 빈 벽 + 지붕) */
function hut(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  w: number,
  d: number,
  h: number,
  wall: Mat,
  roof: Mat,
  t: number,
): void {
  // 벽 (테두리만)
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < d; y++) {
        const edge = x === 0 || y === 0 || x === w - 1 || y === d - 1;
        if (!edge) continue;
        // 정면 가운데는 문·창으로 비운다
        const isFront = x === w - 1 || y === d - 1;
        const mid = x === Math.floor(w / 2) || y === Math.floor(d / 2);
        let mat = wall;
        if (isFront && mid && z === 1) mat = M.glass;
        if (isFront && mid && z === 0 && h > 1) mat = M.log;
        cube(ctx, ox + x, oy + y, z, mat);
      }
    }
  }
  // 지붕
  for (let x = -1; x <= w; x++) {
    for (let y = -1; y <= d; y++) {
      const rim = x === -1 || y === -1 || x === w || y === d;
      cube(ctx, ox + x, oy + y, h, rim ? { ...roof, top: roof.left } : roof);
    }
  }
  void t;
}

/** 발광 */
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  strength = 1,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.5 * strength;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ── 건물별 복셀 구조 ─────────────────────────────────────────

function drawStructure(
  ctx: CanvasRenderingContext2D,
  id: string,
  ox: number,
  oy: number,
  level: number,
  t: number,
): void {
  const blink = 0.5 + 0.5 * Math.sin(t / 420 + ox + oy);
  const lamp = (bx: number, by: number, bz: number) => {
    cube(ctx, ox + bx, oy + by, bz, M.lamp);
    glow(ctx, sx(ox + bx, oy + by), sy(ox + bx, oy + by, bz) + BD / 2, 3, '#ffd98a', blink);
  };
  // 레벨이 오르면 한 칸 더 높아진다 (최대 +2)
  const extra = Math.min(2, Math.floor(level / 4));

  switch (id) {
    case 'sawmill': // 채굴장 — 나무 시추 골조
      hut(ctx, ox, oy, 2, 2, 1 + extra, M.planks, M.log, t);
      for (let z = 2 + extra; z < 5 + extra; z++) cube(ctx, ox, oy, z, M.log);
      cube(ctx, ox + 1, oy, 4 + extra, M.log);
      lamp(0, 0, 5 + extra);
      break;

    case 'quarry': // 제련소 — 돌 건물 + 굴뚝
      hut(ctx, ox, oy, 2, 2, 1 + extra, M.cobble, M.stone, t);
      for (let z = 2 + extra; z < 5 + extra; z++) cube(ctx, ox + 1, oy + 1, z, M.cobble);
      cube(ctx, ox + 1, oy + 1, 5 + extra, M.lamp);
      glow(ctx, sx(ox + 1, oy + 1), sy(ox + 1, oy + 1, 5 + extra), 4, '#ff9040', blink);
      break;

    case 'farm': // 보급창 — 밭 + 창고
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 3; y++)
          cube(ctx, ox + x, oy + y, 0, (x + y) % 2 ? M.dirt : M.grass);
      hut(ctx, ox, oy, 2, 2, 1 + extra, M.planks, M.greenRoof, t);
      break;

    case 'crystal-mine': // 가스 추출기 — 철제 탱크
      hut(ctx, ox, oy, 2, 2, 1, M.iron, M.iron, t);
      for (let z = 2; z < 4 + extra; z++) {
        cube(ctx, ox, oy, z, M.iron);
        cube(ctx, ox + 1, oy + 1, z, M.iron);
      }
      cube(ctx, ox, oy, 4 + extra, M.glass);
      glow(ctx, sx(ox, oy), sy(ox, oy, 4 + extra), 4, '#5fe0a0', blink);
      break;

    case 'market': // 거래소 — 금블록 장식
      hut(ctx, ox, oy, 2, 2, 1 + extra, M.planks, M.goldBlock, t);
      cube(ctx, ox + 1, oy, 2 + extra, M.goldBlock);
      lamp(0, 1, 2 + extra);
      break;

    case 'barracks': // 병영 — 붉은 벽돌 + 철문
      hut(ctx, ox, oy, 3, 2, 2 + extra, M.redBrick, M.stone, t);
      cube(ctx, ox + 1, oy + 1, 0, M.iron);
      lamp(0, 0, 3 + extra);
      lamp(2, 0, 3 + extra);
      break;

    case 'tavern': // 용병 사무소 — 파란 지붕 + 착륙 표식
      hut(ctx, ox, oy, 2, 2, 1 + extra, M.planks, M.blueRoof, t);
      for (let x = 0; x < 3; x++) cube(ctx, ox + x, oy + 2, 0, M.path);
      lamp(2, 2, 1);
      break;

    case 'academy': // 연구소 — 유리 돔
      hut(ctx, ox, oy, 2, 2, 1 + extra, M.iron, M.stone, t);
      for (let x = 0; x < 2; x++)
        for (let y = 0; y < 2; y++) cube(ctx, ox + x, oy + y, 2 + extra, M.glass, 0.85);
      cube(ctx, ox, oy, 3 + extra, M.lamp);
      glow(ctx, sx(ox, oy), sy(ox, oy, 3 + extra), 5, '#7fe6ff', blink);
      break;

    case 'rampart': // 방벽 — 두꺼운 돌벽
      for (let x = 0; x < 3; x++)
        for (let z = 0; z < 2 + extra; z++) cube(ctx, ox + x, oy, z, M.cobble);
      for (let x = 0; x < 3; x += 2) cube(ctx, ox + x, oy, 2 + extra, M.stone);
      break;

    case 'turret': // 포탑 — 돌탑 + 포신
      for (let z = 0; z < 3 + extra; z++) cube(ctx, ox, oy, z, M.cobble);
      cube(ctx, ox, oy, 3 + extra, M.iron);
      cube(ctx, ox + 1, oy, 3 + extra, M.iron);
      glow(ctx, sx(ox + 1, oy), sy(ox + 1, oy, 3 + extra), 3, '#ff5a4a', blink);
      break;

    case 'radar': // 레이더 — 기둥 + 접시
      for (let z = 0; z < 3 + extra; z++) cube(ctx, ox, oy, z, M.iron);
      cube(ctx, ox, oy, 3 + extra, M.glass, 0.9);
      cube(ctx, ox + 1, oy, 3 + extra, M.iron);
      cube(ctx, ox, oy + 1, 3 + extra, M.iron);
      glow(ctx, sx(ox, oy), sy(ox, oy, 4 + extra), 4, '#35c7e0', blink);
      break;

    default:
      hut(ctx, ox, oy, 2, 2, 2, M.stone, M.cobble, t);
  }
}

/** 중앙 사령부 */
function drawHQ(ctx: CanvasRenderingContext2D, ox: number, oy: number, t: number): void {
  const beacon = 0.5 + 0.5 * Math.sin(t / 300);
  hut(ctx, ox, oy, 4, 4, 3, M.stone, M.iron, t);
  // 2층
  hut(ctx, ox + 1, oy + 1, 2, 2, 2, M.iron, M.stone, t);
  // 유리 관제실
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++) cube(ctx, ox + 1 + x, oy + 1 + y, 6, M.glass, 0.85);
  // 안테나
  for (let z = 7; z < 9; z++) cube(ctx, ox + 2, oy + 2, z, M.iron);
  cube(ctx, ox + 2, oy + 2, 9, M.lamp);
  glow(ctx, sx(ox + 2, oy + 2), sy(ox + 2, oy + 2, 9), 6, '#ff5a4a', beacon);
}

// ── 지형 캐시 ────────────────────────────────────────────────
let terrainCache: HTMLCanvasElement | null = null;

function buildTerrain(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CITY_W;
  c.height = CITY_H;
  const ctx = c.getContext('2d')!;

  // 하늘(먼 지평선) — 아래 블록이 다 덮지만 틈을 메운다
  ctx.fillStyle = '#4a6a3a';
  ctx.fillRect(0, 0, CITY_W, CITY_H);

  // 화면을 덮을 만큼 넓게 잔디 블록을 깐다 (밖은 cube()에서 잘린다)
  const RANGE = 34;
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < PLOTS * PLOT && y < PLOTS * PLOT;

  for (let s = 0; s <= RANGE * 2; s++) {
    for (let x = 0; x <= s; x++) {
      const y = s - x;
      const gx = x - 8;
      const gy = y - 8;
      const r = hash(gx * 13, gy * 29);
      let mat = M.grass;
      if (inside(gx, gy)) mat = r < 0.22 ? M.path : M.dirt; // 기지 안은 다져진 땅
      else if (r > 0.93) mat = M.water;
      else if (r > 0.86) mat = M.dirt;
      cube(ctx, gx, gy, 0, mat);
    }
  }

  // 기지 외곽 성벽 (기지 영역 테두리를 돌로 두른다)
  const N = PLOTS * PLOT;
  for (let i = -1; i <= N; i++) {
    for (const [bx, by] of [
      [i, -1],
      [i, N],
      [-1, i],
      [N, i],
    ] as [number, number][]) {
      cube(ctx, bx, by, 0, M.stone);
      cube(ctx, bx, by, 1, M.cobble);
      if ((bx + by) % 3 === 0) cube(ctx, bx, by, 2, M.stone);
    }
  }
  return c;
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
  if (!terrainCache) terrainCache = buildTerrain();
  ctx.drawImage(terrainCache, 0, 0);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 부지 36칸을 뒤에서 앞으로
  const cells: { px: number; py: number; slot?: Slot; hq?: boolean }[] = [];
  for (let py = 0; py < PLOTS; py++) {
    for (let px = 0; px < PLOTS; px++) {
      // 사령부는 2×2 부지를 차지
      if (px >= HQ.px && px <= HQ.px + 1 && py >= HQ.py && py <= HQ.py + 1) {
        if (px === HQ.px && py === HQ.py) cells.push({ px, py, hq: true });
        continue;
      }
      cells.push({ px, py, slot: SLOTS.find((s) => s.px === px && s.py === py) });
    }
  }
  cells.sort((a, b) => a.px + a.py - (b.px + b.py));

  for (const cell of cells) {
    const ox = cell.px * PLOT;
    const oy = cell.py * PLOT;
    const cx = sx(ox + 1, oy + 1);
    const cy = sy(ox + 1, oy + 1, 0);

    if (cell.hq) {
      drawHQ(ctx, ox, oy, t);
      continue;
    }

    const slot = cell.slot;
    if (!slot) {
      // 미개발 부지 — 다진 땅에 모서리 표식
      for (let x = 0; x < PLOT - 1; x++)
        for (let y = 0; y < PLOT - 1; y++) cube(ctx, ox + x, oy + y, 0, M.path);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(ox, oy), sy(ox, oy, 1));
      ctx.lineTo(sx(ox + 2, oy), sy(ox + 2, oy, 1));
      ctx.lineTo(sx(ox + 2, oy + 2), sy(ox + 2, oy + 2, 1));
      ctx.lineTo(sx(ox, oy + 2), sy(ox, oy + 2, 1));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }

    const b = state.buildings.find((x) => x.defId === slot.id);
    const def = defs.get(slot.id);
    const level = b?.level ?? 0;

    if (level < 1) {
      // 건설 가능 부지
      for (let x = 0; x < PLOT - 1; x++)
        for (let y = 0; y < PLOT - 1; y++) cube(ctx, ox + x, oy + y, 0, M.dirt);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const label = def?.name ?? slot.id;
      ctx.font = 'bold 10px sans-serif';
      const wpx = ctx.measureText(label).width + 8;
      ctx.fillRect(cx - wpx / 2, cy - 4, wpx, 14);
      ctx.fillStyle = '#ffd479';
      ctx.fillText(label, cx, cy + 3);
      hitAreas.push({ id: slot.id, x: cx - 26, y: cy - 12, w: 52, h: 32 });
      continue;
    }

    drawStructure(ctx, slot.id, ox, oy, level, t);
    hitAreas.push({ id: slot.id, x: cx - 26, y: cy - 60, w: 54, h: 76 });

    // 레벨 배지
    ctx.fillStyle = 'rgba(12,16,20,0.85)';
    ctx.beginPath();
    ctx.arc(cx + 16, cy + 12, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,212,121,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffd479';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(String(level), cx + 16, cy + 13);

    // 건설 중
    if (state.upgradeQueue?.defId === slot.id) {
      const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(`⚙ ${remain}s`, cx, cy - 52);
      ctx.fillText(`⚙ ${remain}s`, cx, cy - 52);
    }

    // 선택 표시
    if (selectedId === slot.id) {
      ctx.save();
      ctx.strokeStyle = '#ffd479';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#ffd479';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(sx(ox, oy), sy(ox, oy, 1));
      ctx.lineTo(sx(ox + 2, oy), sy(ox + 2, oy, 1));
      ctx.lineTo(sx(ox + 2, oy + 2), sy(ox + 2, oy + 2, 1));
      ctx.lineTo(sx(ox, oy + 2), sy(ox, oy + 2, 1));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }
}

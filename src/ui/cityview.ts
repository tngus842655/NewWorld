import type { BuildingDef, GameState } from '../core/types';

/**
 * 원작 도시 화면 재현: 타일 지면 + 팔각 성벽 + 부지(플롯)에 건물 배치.
 * 그래픽은 전부 플레이스홀더(도형+이모지)이며, public/assets/buildings/{id}.png
 * 파일이 있으면 자동으로 그 이미지를 대신 사용한다 — 아트 교체는 파일 교체로 끝.
 */

export const TILE = 48;
export const GRID = 13;
export const CITY_SIZE = TILE * GRID; // 624

/** 건물별 부지 위치(타일 좌표) — 원작처럼 성벽 안에 흩어 배치 */
const PLOT_POS: Record<string, [number, number]> = {
  sawmill: [3, 4],
  quarry: [7, 3],
  farm: [3, 8],
  'crystal-mine': [9, 6],
  market: [6, 6],
  barracks: [8, 9],
  tavern: [5, 9],
};

/** 플레이스홀더 아이콘/지붕색 */
const LOOK: Record<string, { icon: string; roof: string }> = {
  sawmill: { icon: '🪓', roof: '#8a5a2b' },
  quarry: { icon: '⛏️', roof: '#7d8894' },
  farm: { icon: '🌾', roof: '#b08d2f' },
  'crystal-mine': { icon: '💎', roof: '#7d5ba6' },
  market: { icon: '🏪', roof: '#3f7d4e' },
  barracks: { icon: '⚔️', roof: '#a0281c' },
  tavern: { icon: '🍺', roof: '#b06c2f' },
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

/** 캔버스 클릭 좌표(타일)로 건물 id를 찾는다 */
export function buildingAt(tileX: number, tileY: number): string | null {
  for (const [id, [x, y]] of Object.entries(PLOT_POS)) {
    if (x === tileX && y === tileY) return id;
  }
  return null;
}

export function drawCity(
  canvas: HTMLCanvasElement,
  state: GameState,
  defs: Map<string, BuildingDef>,
  selectedId: string | null,
  now: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // ── 지면 (두 톤 격자) ──
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#4a7c3a' : '#508340';
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }

  // ── 팔각 성벽 ──
  const m = TILE * 1.2; // 여백
  const c = TILE * 3.2; // 모서리 절단
  const S = CITY_SIZE;
  const octagon: [number, number][] = [
    [m + c, m], [S - m - c, m], [S - m, m + c], [S - m, S - m - c],
    [S - m - c, S - m], [m + c, S - m], [m, S - m - c], [m, m + c],
  ];
  ctx.beginPath();
  octagon.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.strokeStyle = '#6e7680';
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.strokeStyle = '#9aa0a8';
  ctx.lineWidth = 10;
  ctx.stroke();
  // 망루 (꼭짓점)
  for (const [x, y] of octagon) {
    ctx.fillStyle = '#b7bcc4';
    ctx.fillRect(x - 12, y - 12, 24, 24);
    ctx.strokeStyle = '#5b636d';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 12, y - 12, 24, 24);
    ctx.fillStyle = '#2f6db3';
    ctx.fillRect(x - 6, y - 6, 12, 12);
  }

  // ── 부지 + 건물 ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const b of state.buildings) {
    const pos = PLOT_POS[b.defId];
    if (!pos) continue;
    const [tx, ty] = pos;
    const px = tx * TILE;
    const py = ty * TILE;

    // 부지 (빈 터는 흙바닥만)
    ctx.fillStyle = '#6b4f30';
    ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
    ctx.fillStyle = '#7a5c3a';
    ctx.fillRect(px + 6, py + 6, TILE - 12, TILE - 12);

    if (b.level >= 1) {
      const img = sprite(b.defId);
      if (img.complete && img.naturalWidth > 0) {
        // 교체용 아트가 있으면 그대로 사용
        ctx.drawImage(img, px, py - TILE * 0.4, TILE, TILE * 1.4);
      } else {
        // 플레이스홀더: 몸체 + 지붕 + 아이콘
        const look = LOOK[b.defId] ?? { icon: '❓', roof: '#666' };
        ctx.fillStyle = '#d8c49a';
        ctx.fillRect(px + 8, py + 14, TILE - 16, TILE - 22);
        ctx.fillStyle = look.roof;
        ctx.beginPath();
        ctx.moveTo(px + 4, py + 16);
        ctx.lineTo(px + TILE / 2, py - 2);
        ctx.lineTo(px + TILE - 4, py + 16);
        ctx.closePath();
        ctx.fill();
        ctx.font = '17px serif';
        ctx.fillText(look.icon, px + TILE / 2, py + TILE / 2 + 6);
      }
      // 레벨 배지
      ctx.fillStyle = '#e0b568';
      ctx.beginPath();
      ctx.arc(px + TILE - 9, py + 9, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1614';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(String(b.level), px + TILE - 9, py + 10);
    }

    // 건설 중 표시
    if (state.upgradeQueue?.defId === b.defId) {
      const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
      ctx.font = '14px serif';
      ctx.fillText('🔨', px + TILE / 2, py - 8);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(`${remain}s`, px + TILE / 2, py + TILE + 8);
    }

    // 선택 표시
    if (selectedId === b.defId) {
      ctx.strokeStyle = '#e0b568';
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
    }
  }

  // 빈 터 이름표 (미건설 건물)
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '10px sans-serif';
  for (const b of state.buildings) {
    const pos = PLOT_POS[b.defId];
    if (!pos || b.level >= 1) continue;
    const def = defs.get(b.defId);
    ctx.fillText(def?.name ?? b.defId, pos[0] * TILE + TILE / 2, pos[1] * TILE + TILE / 2);
  }
}

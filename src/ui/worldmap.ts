import type { CampDef, GameState, NodeDef } from '../core/types';

/**
 * 월드맵: 대륙 타일 위에 내 도시·사냥터·자원지를 배치한다.
 * 지형·아이콘은 플레이스홀더. 도시맵과 마찬가지로 추후 아트 교체 전제.
 */

export const WTILE = 48;
export const WGRID = 11;
export const WORLD_SIZE = WTILE * WGRID; // 528

export const CITY_POS: [number, number] = [5, 5];

const NODE_ICON: Record<string, string> = {
  wood: '🪵',
  stone: '🪨',
  food: '🌾',
  crystal: '💎',
  gold: '🪙',
};

/** 결정적 의사 난수 — 렌더마다 지형이 바뀌지 않도록 좌표 해시 사용 */
function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export interface WorldSite {
  id: string;
  kind: 'camp' | 'node';
  pos: [number, number];
}

export function siteAt(
  sites: WorldSite[],
  tileX: number,
  tileY: number,
): WorldSite | null {
  // 정확한 타일 우선, 없으면 인접 타일까지 허용 (모바일 터치 오차 보정)
  let near: WorldSite | null = null;
  for (const s of sites) {
    const dx = Math.abs(s.pos[0] - tileX);
    const dy = Math.abs(s.pos[1] - tileY);
    if (dx === 0 && dy === 0) return s;
    if (dx <= 1 && dy <= 1 && !near) near = s;
  }
  return near;
}

export function drawWorld(
  canvas: HTMLCanvasElement,
  state: GameState,
  camps: CampDef[],
  nodes: NodeDef[],
  selectedSiteId: string | null,
  now: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // ── 지형 ──
  for (let y = 0; y < WGRID; y++) {
    for (let x = 0; x < WGRID; x++) {
      const r = hash(x, y);
      ctx.fillStyle = r < 0.12 ? '#3c6631' : r < 0.5 ? '#4a7c3a' : '#508340';
      ctx.fillRect(x * WTILE, y * WTILE, WTILE, WTILE);
      // 듬성듬성 숲/바위 장식
      if (r > 0.86) {
        ctx.font = '13px serif';
        ctx.textAlign = 'left';
        ctx.fillText(r > 0.94 ? '⛰️' : '🌲', x * WTILE + 4, y * WTILE + 16);
      }
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const drawSite = (
    pos: [number, number],
    icon: string,
    label: string,
    opts: { owned?: boolean; selected?: boolean; marching?: boolean } = {},
  ) => {
    const px = pos[0] * WTILE;
    const py = pos[1] * WTILE;
    // 바닥판
    ctx.fillStyle = opts.owned ? 'rgba(224,181,104,0.28)' : 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(px + WTILE / 2, py + WTILE / 2, WTILE / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    if (opts.owned) {
      ctx.strokeStyle = '#e0b568';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.font = '20px serif';
    ctx.fillText(icon, px + WTILE / 2, py + WTILE / 2 - 4);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(label, px + WTILE / 2, py + WTILE - 7);
    if (opts.marching) {
      ctx.font = '12px serif';
      ctx.fillText('🚩', px + WTILE - 9, py + 9);
    }
    if (opts.selected) {
      ctx.strokeStyle = '#e0b568';
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 1, py + 1, WTILE - 2, WTILE - 2);
    }
  };

  for (const c of camps) {
    drawSite(c.pos, '💀', c.name, {
      selected: selectedSiteId === c.id,
      marching: state.march.some((m) => m.campId === c.id),
    });
  }
  for (const n of nodes) {
    drawSite(n.pos, NODE_ICON[n.produces] ?? '❓', n.name, {
      owned: state.heldNodes.some((h) => h.nodeId === n.id),
      selected: selectedSiteId === n.id,
      marching: state.march.some((m) => m.campId === n.id),
    });
  }

  // 내 도시
  const [cx, cy] = CITY_POS;
  ctx.fillStyle = 'rgba(160,40,28,0.35)';
  ctx.beginPath();
  ctx.arc(cx * WTILE + WTILE / 2, cy * WTILE + WTILE / 2, WTILE / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '22px serif';
  ctx.fillText('🏰', cx * WTILE + WTILE / 2, cy * WTILE + WTILE / 2 - 3);
  ctx.font = '9px sans-serif';
  ctx.fillStyle = '#ffe9c9';
  ctx.fillText('내 도시', cx * WTILE + WTILE / 2, cy * WTILE + WTILE - 6);

  // 나가 있는 부대마다 도시→목표 경로 표시
  for (const march of state.march) {
    const target =
      camps.find((c) => c.id === march.campId) ?? nodes.find((n) => n.id === march.campId);
    if (!target) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.setLineDash([6, 6]);
    // 시간이 흐르면 점선이 흘러가는 느낌만 준다
    ctx.lineDashOffset = -((now / 200) % 12);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx * WTILE + WTILE / 2, cy * WTILE + WTILE / 2);
    ctx.lineTo(target.pos[0] * WTILE + WTILE / 2, target.pos[1] * WTILE + WTILE / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

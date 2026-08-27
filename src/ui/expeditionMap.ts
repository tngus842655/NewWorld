/**
 * 원정 지도·현황 — 캠프에서 각 지역으로 떠나는 원정의 시각화(전용 시트)와 요약 행 (2026-08-27 사용자).
 * 지도는 앱바 🗺️로 여는 전용 뷰(mapSheet)이고, 요약 행(expeditionRow)은 홈과 지도 시트가 공유한다.
 *
 * 원리: 원정이 절대 시각(startedAt·endsAt) 기반이라 마커 위치는 현재 시각의 순수 함수다 —
 * 별도 상태 없이 새로고침·오프라인 복귀·가속(시간축 이동)이 전부 자동으로 맞아떨어진다.
 * 소요 시간은 티어 고정(지역 무관)이므로 지도는 시간을 거리감으로 '번역'해 보여줄 뿐 밸런스에 관여하지 않는다.
 *
 * 구조: SVG(권역 띠·길·노드·안개)는 렌더마다 다시 그리는 정적 그림이고, 파견 마커만 HTML
 * 오버레이로 얹어 scopedEffect(nowTick)가 left/top만 갱신한다 — 홈 진행바와 같은
 * '구조 고정, 시간 표시만 부분 갱신' 관례 (시트의 스코프 이펙트는 app.ts가 오버레이 전환 시 수거한다).
 * 마커 좌표는 활성 경로 <path>의 getPointAtLength로 뽑는다.
 *
 * 여정 3막: 이동(앞 22%) → 탐사(지역 주변 선회) → 귀환(뒤 22%). 요약 행 상태 줄도 같은 판정을 쓴다.
 */
import { content } from '../content';
import type { Region } from '../content/schema';
import { TRAVEL_FRACTION, isExpeditionOut, recallReturnEndsAt } from '../core/expedition';
import { isRegionUnlocked } from '../core/progression';
import type { ActiveExpedition } from '../core/types';
import * as clock from '../state/clock';
import { signal } from '../state/signal';
import { claim, nowTick, recall, save } from '../state/store';
import { askConfirm } from './dialog';
import { ELEMENT_EMOJI, TIER_LABEL, TRIBE_EMOJI, el, fmtClock, fmtRemain, fmtRemainShort, scopedEffect } from './kit';
import { regionTiers, tierShortName } from './regionTiers';
import { closeOverlay, overlay, tab } from './router';

// ── 여정 단계 ────────────────────────────────────────────────────────────────
// 이동/귀환 구간 비율의 정본은 core(TRAVEL_FRACTION) — 회군 복귀 소요 계산과 같은 값이어야 한다
const OUT_END = TRAVEL_FRACTION; // 여정 앞 22% — 캠프→지역 이동
const BACK_START = 1 - TRAVEL_FRACTION; // 뒤 22% — 귀환길
const ORBIT_MS = 150_000; // 탐사 선회 한 바퀴 — 느긋한 표류감 (시간 기반이라 재접속해도 이어진다)
const ORBIT_R = 9;

export type JourneyPhase = 'out' | 'explore' | 'back' | 'done';

/** 진행률(0~1) → 여정 단계 — 지도 마커와 홈 상태 줄이 같은 판정을 쓴다 */
export function journeyPhase(progress: number): JourneyPhase {
  if (progress >= 1) return 'done';
  if (progress < OUT_END) return 'out';
  if (progress < BACK_START) return 'explore';
  return 'back';
}

export const JOURNEY_EMOJI: Record<JourneyPhase, string> = { out: '🥾', explore: '🔍', back: '🏕️', done: '📜' };
export const JOURNEY_LABEL: Record<JourneyPhase, string> = {
  out: `${JOURNEY_EMOJI.out} 이동 중`,
  explore: `${JOURNEY_EMOJI.explore} 탐사 중`,
  back: `${JOURNEY_EMOJI.back} 귀환 중`,
  done: `${JOURNEY_EMOJI.done} 귀환 완료`,
};

// ── 지형 레이아웃 ────────────────────────────────────────────────────────────
// 좌표는 콘텐츠가 아니라 연출이므로 UI에만 둔다 (regions.json은 밸런스 정본 — 좌표 필드 없음).
// 세로 등반 구도: 캠프(아래)에서 권역 1→4로 오를수록 위. 본길이 각 권역 진입 지역을 지그재그로 지난다.
const VIEW_W = 360;
const VIEW_H = 500;
const CAMP = { x: 180, y: 471 };

interface Pt { x: number; y: number }

interface RealmLayout {
  band: { y0: number; y1: number };
  tint: string; // 권역 띠 배경의 주조색
  /** 이전 권역 진입 지역(1권역은 캠프)에서 이 권역 진입 지역으로 가는 본길 경유점 */
  approach: Pt[];
  /** 소지역 노드 좌표 — regionTiers의 order 순서(진입→2→3)와 1:1 */
  nodes: Pt[];
  /** 권역 안 샛길 경유점 — chain[i] = nodes[i]에서 nodes[i+1] 사이 */
  chain: Pt[][];
}

const REALM_LAYOUT: Record<number, RealmLayout> = {
  1: { // 해안 — 물결
    band: { y0: 372, y1: 470 }, tint: '#3d7ea6',
    approach: [{ x: 132, y: 446 }],
    nodes: [{ x: 96, y: 408 }, { x: 204, y: 430 }, { x: 300, y: 390 }],
    chain: [[{ x: 150, y: 428 }], [{ x: 256, y: 420 }]],
  },
  2: { // 숲 — 침엽수
    band: { y0: 250, y1: 372 }, tint: '#4d8a4f',
    approach: [{ x: 150, y: 376 }, { x: 206, y: 348 }],
    nodes: [{ x: 252, y: 318 }, { x: 150, y: 344 }, { x: 76, y: 292 }],
    chain: [[{ x: 200, y: 338 }], [{ x: 110, y: 326 }]],
  },
  3: { // 늪 — 물안개
    band: { y0: 128, y1: 250 }, tint: '#557eb8',
    approach: [{ x: 200, y: 268 }, { x: 148, y: 232 }],
    nodes: [{ x: 106, y: 196 }, { x: 218, y: 226 }, { x: 300, y: 168 }],
    chain: [[{ x: 162, y: 218 }], [{ x: 264, y: 204 }]],
  },
  4: { // 화산 — 분화구가 정상
    band: { y0: 8, y1: 128 }, tint: '#b0533d',
    approach: [{ x: 148, y: 160 }, { x: 188, y: 128 }],
    nodes: [{ x: 226, y: 96 }, { x: 116, y: 116 }, { x: 180, y: 40 }],
    chain: [[{ x: 170, y: 112 }], [{ x: 138, y: 76 }]],
  },
};

/** regionId → 지도 자리 — 콘텐츠와 레이아웃의 접합부. 자리가 없는 지역은 경고 후 지도에서 뺀다 */
const regionSlot = new Map<string, { tier: number; index: number }>();
for (const { tier, regions } of regionTiers) {
  const layout = REALM_LAYOUT[tier];
  regions.forEach((region, index) => {
    if (layout && index < layout.nodes.length) regionSlot.set(region.id, { tier, index });
    else console.warn(`[map] 레이아웃에 자리가 없는 지역: ${region.id} (tier ${tier})`);
  });
}

/** 캠프→지역 여정 경유점 — 본길은 앞 권역 진입 지역들을 지나고, 권역 안에서는 샛길로 잇는다 */
function routePoints(tier: number, index: number): Pt[] {
  const points: Pt[] = [CAMP];
  for (let t = 1; t < tier; t++) {
    const realm = REALM_LAYOUT[t]!;
    points.push(...realm.approach, realm.nodes[0]!);
  }
  const realm = REALM_LAYOUT[tier]!;
  points.push(...realm.approach);
  for (let i = 0; i <= index; i++) {
    if (i > 0) points.push(...realm.chain[i - 1]!);
    points.push(realm.nodes[i]!);
  }
  return points;
}

/** 경유점을 지나는 매끈한 길 — 각 경유점을 제어점 삼아 이웃 중점을 잇는 이차 베지어 연결 */
function smoothPath(points: Pt[]): string {
  const first = points[0]!;
  let d = `M ${first.x} ${first.y}`;
  if (points.length === 2) return `${d} L ${points[1]!.x} ${points[1]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i]!;
    const next = points[i + 1]!;
    const target = i === points.length - 2 ? next : { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    d += ` Q ${control.x} ${control.y} ${target.x} ${target.y}`;
  }
  return d;
}

// ── SVG 헬퍼 ─────────────────────────────────────────────────────────────────
// el()은 HTML 전용(createElement) — SVG는 네임스페이스가 달라 여기서만 따로 만든다.
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: (Node | string | null)[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

function mapDefs(): SVGDefsElement {
  const defs = svg('defs');
  for (const [tier, layout] of Object.entries(REALM_LAYOUT)) {
    defs.append(svg('linearGradient', { id: `map-band-${tier}`, x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: 0, 'stop-color': layout.tint, 'stop-opacity': 0.2 }),
      svg('stop', { offset: 1, 'stop-color': layout.tint, 'stop-opacity': 0.04 }),
    ));
  }
  // 잠긴 권역의 안개 — 위(더 깊은 곳)로 갈수록 짙다
  defs.append(svg('linearGradient', { id: 'map-fog', x1: 0, y1: 0, x2: 0, y2: 1 },
    svg('stop', { offset: 0, 'stop-color': '#0d101a', 'stop-opacity': 0.85 }),
    svg('stop', { offset: 1, 'stop-color': '#0d101a', 'stop-opacity': 0.58 }),
  ));
  return defs;
}

/** 권역별 배경 장식 — 고정 좌표의 작은 실루엣 몇 개 (마커가 돋보이게 저채도·저투명) */
function decorations(tier: number): SVGGElement {
  const g = svg('g');
  if (tier === 1) {
    for (const [x, y] of [[34, 442], [258, 454], [316, 428], [148, 394]] as const) {
      g.append(svg('path', { d: `M ${x} ${y} q 5 -4 10 0 t 10 0`, class: 'map-deco-wave' }));
    }
  } else if (tier === 2) {
    for (const [x, y, s] of [[34, 316, 1], [208, 296, 0.8], [298, 344, 1.1], [120, 286, 0.7]] as const) {
      g.append(svg('path', { d: `M ${x} ${y} l ${5 * s} ${-11 * s} l ${5 * s} ${11 * s} z`, class: 'map-deco-tree' }));
    }
  } else if (tier === 3) {
    for (const [cx, cy, rx] of [[70, 152, 26], [252, 246, 30], [170, 166, 22]] as const) {
      g.append(svg('ellipse', { cx, cy, rx, ry: 6, class: 'map-deco-mist' }));
    }
  } else if (tier === 4) {
    g.append(svg('path', { d: 'M 146 88 L 180 16 L 214 88 Z', class: 'map-deco-peak' }));
    for (const [cx, cy] of [[252, 58], [206, 50], [140, 96], [94, 130]] as const) {
      g.append(svg('circle', { cx, cy, r: 1.6, class: 'map-deco-ember' }));
    }
  }
  return g;
}

function regionNode(region: Region, pos: Pt, opts: { locked: boolean; target: boolean }): SVGGElement {
  return svg('g', { class: `map-node${opts.locked ? ' locked' : ''}${opts.target ? ' target' : ''}` },
    svg('title', {}, opts.locked ? `${region.name} · 잠김` : `${region.name} · 권장 CP ${region.recommendedCp}`),
    svg('circle', { cx: pos.x, cy: pos.y, r: 15, class: 'map-node-plate' }),
    svg('text', { x: pos.x, y: pos.y + 5, 'text-anchor': 'middle', class: 'map-node-icon' }, region.icon),
    svg('text', { x: pos.x, y: pos.y + 27, 'text-anchor': 'middle', class: 'map-node-name' }, region.name),
    opts.locked ? svg('text', { x: pos.x + 10, y: pos.y - 8, class: 'map-node-lock' }, '🔒') : null,
  );
}

// ── 마커 ─────────────────────────────────────────────────────────────────────
// getTotalLength는 브라우저가 기하를 못 세우면(비표준 환경) 0이 나올 수 있다 — 0이면 다음 틱에 재측정
const lengthCache = new WeakMap<SVGPathElement, number>();
function routeLength(path: SVGPathElement): number {
  let length = lengthCache.get(path);
  if (length === undefined || length <= 0) {
    try { length = path.getTotalLength(); } catch { length = 0; }
    lengthCache.set(path, length);
  }
  return length;
}

// 귀환 완료 마커의 캠프 주변 가로 분산 — 전 경로가 캠프 한 점에서 시작하므로
// 오프셋이 없으면 밤새 돌아온 3~4군이 픽셀 단위로 포개져 맨 위 하나만 탭된다 (리뷰 2026-08-27)
const DONE_SPREAD = [0, -24, 24, -48] as const;

/** 여정 진행률 → 지도 좌표. 측정 실패 폴백은 목적지(진행 중)/캠프(완료) 고정 */
function markerPoint(
  route: SVGPathElement, waypoints: Pt[], progress: number, elapsedMs: number, slot: number, campSlot: number,
): Pt {
  const destination = waypoints[waypoints.length - 1]!;
  const phase = journeyPhase(progress);
  const doneSpread = DONE_SPREAD[campSlot % DONE_SPREAD.length]!;
  const length = routeLength(route);
  if (length <= 0) {
    const base = phase === 'done' ? waypoints[0]! : destination;
    return phase === 'done' ? { x: base.x + doneSpread, y: base.y } : base;
  }
  const at = (len: number): Pt => {
    const p = route.getPointAtLength(Math.max(0, Math.min(length, len)));
    return { x: p.x, y: p.y };
  };
  if (phase === 'done') {
    const camp = at(0);
    return { x: camp.x + doneSpread, y: camp.y };
  }
  if (phase === 'out') return at((progress / OUT_END) * length);
  if (phase === 'back') return at((1 - (progress - BACK_START) / (1 - BACK_START)) * length);
  // 탐사 — 지역 주변을 천천히 선회. slot으로 같은 지역의 여러 원정대 위상을 벌린다
  const angle = (elapsedMs / ORBIT_MS) * Math.PI * 2 + slot * 2.1;
  return { x: destination.x + Math.cos(angle) * ORBIT_R, y: destination.y + Math.sin(angle) * ORBIT_R * 0.65 };
}

/** 회군 귀로 위치 — 회군 시점 위치에서 같은 걸음 속도로 캠프까지 되짚어 온다. 복귀 완료면 null(숨김) */
function recallPoint(route: SVGPathElement, waypoints: Pt[], expedition: ActiveExpedition, now: number): Pt | null {
  const returnEnds = recallReturnEndsAt(expedition)!;
  if (now >= returnEnds) return null;
  const length = routeLength(route);
  if (length <= 0) return waypoints[0]!; // 측정 불가 폴백 — 캠프 고정
  const total = Math.max(1, expedition.endsAt - expedition.startedAt);
  const outLeg = total * TRAVEL_FRACTION;
  // 회군 시점의 경로상 위치 — 이동 중이면 온 만큼, 탐사 중이면 목적지(경로 끝)
  const lenAtRecall = Math.min(1, (expedition.recallAt! - expedition.startedAt) / outLeg) * length;
  const t = Math.min(1, Math.max(0, (now - expedition.recallAt!) / Math.max(1, returnEnds - expedition.recallAt!)));
  const p = route.getPointAtLength(Math.max(0, lenAtRecall * (1 - t)));
  return { x: p.x, y: p.y };
}

function markerEl(
  expedition: ActiveExpedition,
  route: SVGPathElement,
  waypoints: Pt[],
  slot: number,
  campSlot: number,
  label: string,
  onTap?: (expeditionId: string) => void,
): HTMLElement {
  const marker = el('button.map-marker.map-snap', {
    title: label,
    onclick: onTap ? () => onTap(expedition.id) : undefined,
  });
  // 귀환 완료 바운스의 위상도 벌린다 — 나란히 선 마커들이 한 몸처럼 뛰지 않게
  marker.style.animationDelay = `${(campSlot % DONE_SPREAD.length) * 0.18}s`;
  // 마커 얼굴은 파티 선두 — micon(52px·등급 연출)은 지도에 과해서 소형 전용으로 만든다
  const leader = expedition.partyIds[0] ? content.monsters.get(expedition.partyIds[0]!) : undefined;
  if (leader) {
    const img = el('img');
    img.src = `/assets/monsters/${leader.asset}.webp`;
    img.alt = leader.name;
    img.onerror = () => {
      img.remove();
      marker.prepend(el('span.map-marker-fallback', {}, TRIBE_EMOJI[leader.tribe]));
    };
    marker.append(img);
  } else {
    marker.append(el('span.map-marker-fallback', {}, '🧭'));
  }
  const teamNo = expedition.teamId ? save().teams.findIndex((t) => t.id === expedition.teamId) + 1 : 0;
  if (teamNo > 0) marker.append(el('span.map-marker-team', {}, String(teamNo)));
  const recalled = expedition.recallAt !== undefined;
  if (recalled) marker.classList.add('recalled');
  const pending = !recalled && expedition.choices.some((choice) => choice === null);
  const choiceBadge = pending ? el('span.map-marker-q', {}, '🔀') : null;
  if (choiceBadge) marker.append(choiceBadge);
  if (recalled) marker.append(el('span.map-marker-q', {}, '🏳️'));

  const total = Math.max(1, expedition.endsAt - expedition.startedAt);
  let last: Pt | null = null;
  scopedEffect(() => {
    const now = nowTick();
    let pos: Pt | null;
    let done = false;
    if (recalled) {
      pos = recallPoint(route, waypoints, expedition, now); // null = 복귀 완료 — 다음 렌더 전까지 숨김
    } else {
      const progress = Math.min(1, Math.max(0, (now - expedition.startedAt) / total));
      done = progress >= 1;
      pos = markerPoint(route, waypoints, progress, now - expedition.startedAt, slot, campSlot);
    }
    marker.classList.toggle('hidden', pos === null);
    if (pos === null) return;
    // 첫 배치와 큰 점프(가속·재접속)는 스냅 — 지도를 가로지르는 순간이동 스윕을 막는다
    const jump = last === null || Math.hypot(pos.x - last.x, pos.y - last.y) > 30;
    marker.classList.toggle('map-snap', jump);
    marker.classList.toggle('done', done);
    choiceBadge?.classList.toggle('hidden', done);
    marker.style.left = `${((pos.x / VIEW_W) * 100).toFixed(2)}%`;
    marker.style.top = `${((pos.y / VIEW_H) * 100).toFixed(2)}%`;
    last = pos;
  });
  return marker;
}

// ── 지도 본체 ────────────────────────────────────────────────────────────────
function expeditionMap(opts: { onMarkerTap?: (expeditionId: string) => void } = {}): HTMLElement {
  const state = save();
  // 비추적 시계 — 복귀 완료된 회군 기록은 렌더 시점에 걸러진다 (마커·행은 scopedEffect로 스스로도 숨는다)
  const running = state.expeditions.filter((e) => isExpeditionOut(e, clock.now()));
  const targetRegions = new Set(running.filter((e) => e.recallAt === undefined).map((e) => e.regionId));

  const root = svg('svg', { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: 'img', 'aria-label': '원정 지도' });
  root.append(mapDefs());
  root.append(svg('rect', { x: 0, y: 0, width: VIEW_W, height: VIEW_H, class: 'map-ground' }));

  // 1) 권역 띠 + 장식 + 경계선 (아래→위 = 얕은→깊은 권역)
  for (const { tier } of regionTiers) {
    const layout = REALM_LAYOUT[tier];
    if (!layout) continue;
    const { y0, y1 } = layout.band;
    root.append(svg('rect', { x: 0, y: y0, width: VIEW_W, height: y1 - y0, fill: `url(#map-band-${tier})` }));
    root.append(svg('path', { d: `M 0 ${y1} q 90 -7 180 0 t 180 0`, class: 'map-ridge' }));
    root.append(decorations(tier));
  }

  // 2) 길 — 본길(캠프→권역 진입들)과 권역 샛길 전부 연한 점선. 잠긴 권역 구간은 어차피 안개에 덮인다
  const trunk: Pt[] = [CAMP];
  for (const { tier } of regionTiers) {
    const layout = REALM_LAYOUT[tier];
    if (!layout) continue;
    trunk.push(...layout.approach, layout.nodes[0]!);
  }
  root.append(svg('path', { d: smoothPath(trunk), class: 'map-trail' }));
  for (const { tier, regions } of regionTiers) {
    const layout = REALM_LAYOUT[tier];
    if (!layout) continue;
    const branch: Pt[] = [layout.nodes[0]!];
    regions.slice(1).forEach((_, i) => {
      branch.push(...layout.chain[i]!, layout.nodes[i + 1]!);
    });
    if (branch.length > 1) root.append(svg('path', { d: smoothPath(branch), class: 'map-trail' }));
  }

  // 3) 활성 경로 — 파견 중인 지역까지 강조 점선. 마커 좌표 측정에도 이 path를 그대로 쓴다.
  // 같은 지역 중복 파견은 두 번째부터 투명 — 같은 선이 겹쳐 그려지면 글로우만 두 배로 진해진다
  const routes = new Map<string, { route: SVGPathElement; waypoints: Pt[] }>();
  const drawnRegions = new Set<string>();
  for (const expedition of running) {
    const slot = regionSlot.get(expedition.regionId);
    if (!slot) continue;
    const waypoints = routePoints(slot.tier, slot.index);
    const dup = drawnRegions.has(expedition.regionId);
    drawnRegions.add(expedition.regionId);
    const recalledCls = expedition.recallAt !== undefined ? ' recalled' : '';
    const route = svg('path', { d: smoothPath(waypoints), class: `map-route${dup ? ' map-route-dup' : ''}${recalledCls}` });
    root.append(route);
    routes.set(expedition.id, { route, waypoints });
  }

  // 4) 노드 — 지역·캠프. 파견 목적지는 강조 테두리
  for (const { tier, regions } of regionTiers) {
    const layout = REALM_LAYOUT[tier];
    if (!layout) continue;
    regions.forEach((region, index) => {
      const pos = layout.nodes[index];
      if (!pos) return;
      root.append(regionNode(region, pos, {
        locked: !isRegionUnlocked(content, state, region.id),
        target: targetRegions.has(region.id),
      }));
    });
  }
  root.append(svg('g', { class: 'map-camp' },
    svg('circle', { cx: CAMP.x, cy: CAMP.y, r: 16, class: 'map-node-plate map-camp-plate' }),
    svg('text', { x: CAMP.x, y: CAMP.y + 6, 'text-anchor': 'middle', class: 'map-camp-icon' }, '⛺'),
    svg('text', { x: CAMP.x, y: CAMP.y + 26, 'text-anchor': 'middle', class: 'map-node-name' }, '캠프'),
  ));

  // 5) 안개 — 진입 지역이 잠긴 권역은 통째로 덮는다. 지도가 곧 진행 티저 (도감 ?와 같은 원리)
  for (const { tier, regions } of regionTiers) {
    const layout = REALM_LAYOUT[tier];
    if (!layout) continue;
    const entry = regions[0]!;
    const { y0, y1 } = layout.band;
    if (!isRegionUnlocked(content, state, entry.id)) {
      root.append(svg('rect', { x: 0, y: y0, width: VIEW_W, height: y1 - y0, fill: 'url(#map-fog)' }));
      root.append(svg('text', {
        x: VIEW_W / 2, y: (y0 + y1) / 2 + 4, 'text-anchor': 'middle', class: 'map-fog-label',
      }, `🔒 ${tierShortName(regions)}`));
    } else {
      root.append(svg('text', { x: 12, y: y0 + 16, class: 'map-band-label' },
        `${tierShortName(regions)} ${ELEMENT_EMOJI[entry.element]}`));
    }
  }

  // 6) 마커 — HTML 오버레이 (viewBox 비율 좌표라 리사이즈에도 맞는다)
  const wrap = el('div.map-wrap', {}, root);
  const slotByRegion = new Map<string, number>();
  let campSlot = 0;
  for (const expedition of running) {
    const entry = routes.get(expedition.id);
    if (!entry) continue;
    const orbitSlot = slotByRegion.get(expedition.regionId) ?? 0;
    slotByRegion.set(expedition.regionId, orbitSlot + 1);
    const teamName = expedition.teamId ? state.teams.find((t) => t.id === expedition.teamId)?.name : null;
    const regionName = content.regions.get(expedition.regionId)?.name ?? expedition.regionId;
    wrap.append(markerEl(expedition, entry.route, entry.waypoints, orbitSlot, campSlot++,
      `${teamName ?? '원정대'} · ${regionName}`, opts.onMarkerTap));
  }

  return wrap; // 카드 포장은 호출부 몫 — 홈 카드는 한 줄 요약을, 시트는 지도만 담는다
}

/** 정산 진입 — 미선택 갈림길이 있으면 일괄 선택 시트부터 (TECH §4). 시트 행·홈 한 줄이 공유 */
function openClaimFlow(expeditionId: string): void {
  const current = save().expeditions.find((e) => e.id === expeditionId && !e.claimed);
  if (!current) return;
  if (current.choices.some((choice) => choice === null)) {
    overlay.set({ kind: 'crossroads', expeditionId });
    return;
  }
  const result = claim(expeditionId);
  if (result) overlay.set({ kind: 'journal', ...result });
}

/**
 * 진행 중 원정의 액션 버튼 3종 (가속·갈림길·회군) — 지도 시트 상세 행과 홈 펼침 줄이 공유.
 * done·귀환 단계에 따른 표시 토글은 호출부의 scopedEffect 몫이다.
 */
function expeditionActionButtons(expedition: ActiveExpedition, region: Region, tutorialDone: boolean): {
  accelBtn: HTMLElement;
  crossroadBtn: HTMLElement | null;
  recallBtn: HTMLElement | null;
} {
  const total = Math.max(1, expedition.endsAt - expedition.startedAt);
  const pendingChoices = expedition.choices.filter((c) => c === null).length;
  const accelBtn = el('button.btn.btn-ghost.exp-accel', {
    onclick: () => overlay.set({ kind: 'accelerate', expeditionId: expedition.id }),
  }, '⏳ 가속');
  const crossroadBtn =
    expedition.choices.length > 0
      ? el('button.btn.btn-ghost.exp-accel', { onclick: () => overlay.set({ kind: 'crossroads', expeditionId: expedition.id }) },
          pendingChoices > 0 ? `🔀 갈림길 ${pendingChoices}` : '🔀 선택 완료')
      : null;
  // 회군 — 현 위치에서 캠프까지 걸어서 복귀, 보상 없음·적재 미끼 환급 (2026-08-27 사용자).
  // 30초짜리 튜토리얼 정찰에는 뺀다. 귀환 단계에서는 무의미해 호출부 scopedEffect가 숨긴다
  const recallBtn = tutorialDone
    ? el('button.btn.btn-ghost.exp-accel', {
        onclick: async () => {
          // 복귀 소요는 누르는 시점 기준으로 계산해 안내한다 (비추적 시계)
          const elapsed = Math.max(0, clock.now() - expedition.startedAt);
          const returnMs = Math.min(elapsed, Math.round(total * TRAVEL_FRACTION));
          const lureNote = expedition.luresLoaded > 0 ? ` 적재한 미끼 ${expedition.luresLoaded}개는 돌려받습니다.` : '';
          const ok = await askConfirm({
            title: '회군',
            message: `${region.name} 원정을 중단하고 회군할까요? 복귀까지 ${fmtRemain(returnMs)} 걸리며, 이번 여정의 보상을 잃습니다.${lureNote}`,
            confirmLabel: '🏳️ 회군',
            danger: true,
          });
          if (ok) recall(expedition.id); // 다이얼로그 사이에 귀환 단계로 넘어갔으면 코어가 막고 토스트로 알린다
        },
      }, '🏳️ 회군')
    : null;
  return { accelBtn, crossroadBtn, recallBtn };
}

// ── 원정 요약 행 — 지도 시트 전용 (홈은 아래 expeditionLine 한 줄 요약) ──────
/** 상태 한 줄(여정 단계·귀환 시각)·진행바·액션(가속/갈림길/회군/정산). 구조 고정, 시간 표시만 scopedEffect */
export function expeditionRow(expeditionId: string): HTMLElement {
  const state = save();
  const expedition = state.expeditions.find((e) => e.id === expeditionId && !e.claimed)!;
  const region = content.regions.get(expedition.regionId)!;
  const total = Math.max(1, expedition.endsAt - expedition.startedAt);
  const teamName = expedition.teamId ? state.teams.find((t) => t.id === expedition.teamId)?.name : null;
  const tags = el('div.row-gap', {},
    teamName ? el('span.tag', {}, teamName) : null,
    el('span.tag', {}, TIER_LABEL[expedition.tier]),
  );
  const status = el('span.exp-status.muted');
  const fill = el('div.progress-fill');

  // 회군 중 — 액션 없이 복귀 카운트다운만. 진행바는 온 만큼에서 0으로 줄어든다 (여정이 되감기는 그림)
  if (expedition.recallAt !== undefined) {
    const returnEnds = recallReturnEndsAt(expedition)!;
    const progressAtRecall = Math.min(1, (expedition.recallAt - expedition.startedAt) / total);
    const row = el('div.exp-row.exp-row-recalled', {},
      el('div.exp-row-head', {}, el('div.exp-row-title', {}, `${region.icon} ${region.name}`), tags),
      el('div.progress', {}, fill),
      el('div.exp-row-foot', {}, status),
    );
    scopedEffect(() => {
      const now = nowTick();
      row.classList.toggle('hidden', now >= returnEnds); // 복귀 완료 — 다음 렌더 전까지 자리만 숨김
      const t = Math.min(1, Math.max(0, (now - expedition.recallAt!) / Math.max(1, returnEnds - expedition.recallAt!)));
      fill.style.width = `${Math.round(progressAtRecall * (1 - t) * 100)}%`;
      status.textContent = `🏳️ 회군 중 · ${fmtClock(returnEnds)} 복귀 (${fmtRemain(returnEnds - now)})`;
    });
    return row;
  }

  const { accelBtn, crossroadBtn, recallBtn } = expeditionActionButtons(expedition, region, state.profile.tutorialDone);
  const claimBtn = el('button.btn.btn-primary.hidden', {
    onclick: () => openClaimFlow(expedition.id),
  }, '📜 원정 일지 열기');

  // 시간 흐름에 따른 갱신 — 구조는 그대로, 텍스트·클래스만 바뀐다. 여정 단계 판정은 지도 마커와 공유
  scopedEffect(() => {
    const now = nowTick();
    const progress = Math.min(1, (now - expedition.startedAt) / total);
    const done = now >= expedition.endsAt;
    fill.style.width = `${Math.round(progress * 100)}%`;
    status.textContent = done
      ? '원정대가 돌아왔습니다!'
      : `${JOURNEY_LABEL[journeyPhase(progress)]} · ${fmtClock(expedition.endsAt)} 귀환 (${fmtRemain(expedition.endsAt - now)})`;
    claimBtn.classList.toggle('hidden', !done);
    crossroadBtn?.classList.toggle('hidden', done);
    accelBtn.classList.toggle('hidden', done);
    // 귀환 단계부터는 회군이 무의미하다 (도착 시간 동일·보상만 손실) — 코어 규칙과 함께 숨긴다
    recallBtn?.classList.toggle('hidden', done || progress >= BACK_START);
  });

  return el('div.exp-row', {},
    el('div.exp-row-head', {}, el('div.exp-row-title', {}, `${region.icon} ${region.name}`), tags),
    el('div.progress', {}, fill),
    el('div.exp-row-foot', {}, status, el('div.row-gap', {}, accelBtn, crossroadBtn, recallBtn, claimBtn)),
  );
}

// ── 홈 원정 현황 — 원정별 한 줄 요약 + 아코디언 액션 (2026-08-27 사용자) ─────
/** 펼쳐진 요약 줄 id — 한 번에 하나만. 탭 이동·재렌더에도 유지 (화면 로컬 시그널 관례) */
const expandedLineId = signal<string | null>(null);

/**
 * 한 줄 요약 — 지역·군 번호·상태(귀환/복귀 시각). 정산은 줄 안의 📜 버튼으로 바로,
 * 탭하면 아래로 펼쳐져 가속·갈림길·회군·지도 액션이 나온다 (회군 중에는 지도만).
 */
function expeditionLine(expeditionId: string, onOpenMap: () => void): HTMLElement {
  const state = save();
  const expedition = state.expeditions.find((e) => e.id === expeditionId && !e.claimed)!;
  const region = content.regions.get(expedition.regionId)!;
  const total = Math.max(1, expedition.endsAt - expedition.startedAt);
  const teamNo = expedition.teamId ? state.teams.findIndex((t) => t.id === expedition.teamId) + 1 : 0;
  const recalled = expedition.recallAt !== undefined;
  const pending = !recalled && expedition.choices.some((c) => c === null);
  const expanded = expandedLineId() === expeditionId; // 토글은 시그널 → 화면 재렌더로 반영

  const status = el('span.map-line-status.muted');
  const journalBtn = el('button.btn.btn-primary.map-line-claim.hidden', {
    onclick: (event) => {
      event.stopPropagation(); // 줄 탭(펼침 토글)과 분리
      openClaimFlow(expedition.id);
    },
  }, '📜 일지');

  const head = el(`div.map-line${recalled ? '.map-line-recalled' : ''}`, {
    onclick: () => expandedLineId.set(expanded ? null : expeditionId),
  },
    el('span.map-line-name', {}, `${region.icon} ${region.name}${pending ? ' 🔀' : ''}`),
    teamNo > 0 ? el('span.map-line-team', {}, String(teamNo)) : null,
    status,
    journalBtn,
    el('span.map-line-chev', {}, expanded ? '∧' : '∨'),
  );

  // 펼친 줄에만 액션 행 — 접힌 줄은 버튼·이펙트를 만들지 않는다
  const buttons = expanded && !recalled
    ? expeditionActionButtons(expedition, region, state.profile.tutorialDone)
    : null;
  const actions = expanded
    ? el('div.map-line-actions', {},
        buttons?.accelBtn, buttons?.crossroadBtn, buttons?.recallBtn,
        el('button.btn.btn-ghost.exp-accel', { onclick: onOpenMap }, '🗺️ 지도'),
      )
    : null;

  const item = el('div.map-line-item', {}, head, actions);
  scopedEffect(() => {
    const now = nowTick();
    if (recalled) {
      const returnEnds = recallReturnEndsAt(expedition)!;
      item.classList.toggle('hidden', now >= returnEnds); // 복귀 완료 — 다음 렌더 전까지 숨김
      status.textContent = `🏳️ ${fmtClock(returnEnds)} 복귀 (${fmtRemainShort(returnEnds - now)})`;
      return;
    }
    const progress = Math.min(1, (now - expedition.startedAt) / total);
    const done = now >= expedition.endsAt;
    journalBtn.classList.toggle('hidden', !done);
    status.classList.toggle('hidden', done);
    if (!done) {
      status.textContent =
        `${JOURNEY_EMOJI[journeyPhase(progress)]} ${fmtClock(expedition.endsAt)} 귀환 (${fmtRemainShort(expedition.endsAt - now)})`;
    }
    if (buttons) {
      buttons.accelBtn.classList.toggle('hidden', done);
      buttons.crossroadBtn?.classList.toggle('hidden', done);
      // 귀환 단계부터는 회군이 무의미하다 — 시트 상세 행과 같은 규칙
      buttons.recallBtn?.classList.toggle('hidden', done || progress >= BACK_START);
    }
  });
  return item;
}

/** 홈 '원정 현황' 카드 — 원정별 한 줄 요약만 (지도는 전용 시트). 줄 탭은 지도 시트로 */
export function expeditionLinesCard(): HTMLElement {
  const state = save();
  const running = state.expeditions.filter((e) => isExpeditionOut(e, clock.now()));
  const openMap = () => overlay.set({ kind: 'map' });
  return el('div.card.map-lines-card', {},
    el('div.map-lines', {},
      ...running.map((e) => expeditionLine(e.id, openMap)),
      running.length === 0
        ? el('div.map-line.map-line-empty', {},
            el('span.muted.small', {}, '지금은 모두 캠프에서 쉬고 있습니다'),
            el('button.btn.btn-primary.map-line-claim', { onclick: () => tab.set('expedition') }, '원정 보내기'),
          )
        : null,
    ),
  );
}

/** 지도 시트 진입 아이콘 — '원정 현황' 타이틀 우측 (2026-08-27 사용자). 에셋 실패 시 이모지 폴백 */
export function mapEntryButton(): HTMLElement {
  const img = el<'img'>('img');
  img.src = '/assets/ui/expedition-map.webp';
  img.alt = '원정 지도';
  const button = el('button.map-entry-btn', {
    title: '원정 지도',
    onclick: () => overlay.set({ kind: 'map' }),
  }, img);
  img.onerror = () => {
    img.remove();
    button.prepend('🗺️');
  };
  return button;
}

// ── 지도 전용 시트 — 앱바 🗺️ 진입 (2026-08-27 사용자: 상세 행·액션은 여기) ──
export function mapSheet(): HTMLElement {
  const state = save();
  const running = state.expeditions.filter((e) => isExpeditionOut(e, clock.now()));

  // 마커 탭 → 시트 안의 해당 요약 행으로
  const rowEls = new Map<string, HTMLElement>();
  const rows = running.map((e) => {
    const row = expeditionRow(e.id);
    rowEls.set(e.id, row);
    return row;
  });

  return el('div.sheet.sheet-full.sheet-map', {},
    el('div.sheet-head', {},
      el('div.sheet-title', {}, '🗺️ 원정 지도'),
      el('button.btn.btn-ghost', { onclick: closeOverlay }, '🏕️ 돌아가기'),
    ),
    el('div.card.map-card', {}, expeditionMap({
      onMarkerTap: (expeditionId) => {
        const row = rowEls.get(expeditionId);
        if (!row) return;
        // CSS 미디어쿼리는 JS 스크롤에 안 닿는다 — 모션 최소화면 즉시 점프 (styles.css 가드와 같은 원칙)
        const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
        row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        row.classList.remove('exp-flash');
        void row.offsetWidth; // 연속 탭에도 플래시가 다시 재생되게 리셋
        row.classList.add('exp-flash');
      },
    })),
    running.length === 0
      ? el('div.card.empty', {},
          el('div', {}, '지금은 모두 캠프에서 쉬고 있습니다.'),
          el('button.btn.btn-primary', {
            onclick: () => {
              closeOverlay();
              tab.set('expedition');
            },
          }, '원정 보내기'),
        )
      : el('div.card.exp-list', {}, ...rows),
  );
}

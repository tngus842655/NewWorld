import type {
  BuildingCategory,
  BuildingDef,
  CampDef,
  EquipItem,
  EquipSlot,
  GameState,
  HeroStats,
  NodeDef,
  RaceId,
  ResourceKind,
  UnitCount,
  UnitDef,
} from '../core/types';
import { HERO_STAT_LABELS, RACE_LABELS, RESOURCE_LABELS } from '../core/types';
import {
  ACADEMY_ID,
  BARRACKS_ID,
  canAfford,
  MAX_UNIT_LEVEL,
  maxResearchableLevel,
  researchCost,
  researchSeconds,
} from '../core/actions';
import { selectArmyForMarch } from '../core/combat';
import { drawWorld, siteAt, WORLD_SIZE, WTILE, type WorldSite } from './worldmap';
import {
  commandLimit,
  critChance,
  FREE_RESTOCK_SECONDS,
  MANUAL_REFRESH_GOLD,
  statTotal,
  TAVERN_ID,
} from '../core/heroes';
import { equipTotals, RARITIES, SLOT_LABELS, SLOTS } from '../core/equipment';
import {
  buildingAt,
  cellAt,
  cellLabel,
  CITY_H,
  CITY_W,
  drawCity,
  setDragGhost,
  toCanvasPoint,
} from './cityview';
import {
  buildingAtCell,
  buildSlots,
  hasFreeBuildSlot,
  isBuilding,
  isGridBuilding,
  requirementText,
  unmetRequirements,
  unplacedBuildings,
  type Cell,
} from '../core/city';

/**
 * 원작 메뉴 구성(도시 / 영웅 / 맵 / 길드 / 시장 / 랭킹 / 정보)을 따른다.
 * 길드·시장·랭킹은 아직 시스템이 없어 넣지 않았다.
 */
export type Tab = 'city' | 'hero' | 'map' | 'info';

export interface RenderCallbacks {
  onUpgrade(defId: string): void;
  onTrain(unitId: string, count: number): void;
  onSelectRace(raceId: RaceId): void;
  onHire(candidateIndex: number): void;
  onRefreshTavern(): void;
  /** 도시 뷰에서 건물(또는 빈 곳) 선택 — 리렌더 트리거용 */
  onSelectBuilding(defId: string | null): void;
  /** 빈 부지에 새 건물을 짓는다 */
  onPlaceBuilding(defId: string, c: number, r: number): void;
  /** 건물을 다른 칸으로 옮긴다 (드래그 앤 드롭) */
  onMoveBuilding(defId: string, c: number, r: number): void;
  /** 하단 탭 전환 */
  onSelectTab(tab: Tab): void;
  /** 교전지/자원지 출정 */
  onDispatch(targetId: string, kind: 'hunt' | 'capture', heroId: string): void;
  /** 출정 보낼 지휘관 선택 */
  onSelectHero(heroId: string): void;
  /** 월드맵 장소 선택 — 리렌더 트리거용 */
  onSelectSite(siteId: string | null): void;
  /** 점령한 자원지 포기 */
  onAbandon(nodeId: string): void;
  /** 병종 연구 시작 */
  onResearch(unitId: string): void;
  /** 창고 장비 착용 */
  onEquip(itemId: string): void;
  /** 착용 장비 해제 */
  onUnequip(heroId: string, slot: EquipSlot): void;
  /** 창고 장비 버리기 */
  onDiscard(itemId: string): void;
  /** 전투 기록 삭제 */
  onDeleteReport(reportId: string): void;
  /** 전투 기록 전체 삭제 */
  onClearReports(): void;
  /** 전투 기록 열람 (읽음 처리) */
  onOpenReport(reportId: string): void;
  /** 테스트용: 진행 중인 건설/훈련 큐 즉시 완료 (dev 전용) */
  onInstantFinish(): void;
}

// UI 전용 상태
let selectedBuilding: string | null = null;
/** 선택한 빈 부지 — 여기에 건설 목록이 붙는다 */
let selectedCell: Cell | null = null;
/** 선택 직후 한 번, 캔버스 아래 패널이 보이도록 스크롤한다 */
let scrollToPanel = false;
let activeTab: Tab = 'city';
let message = '';
let selectedHeroId: string | null = null;
let selectedSiteId: string | null = null;
/** 펼쳐 둔 전투 기록 — DOM을 다시 그려도 열린 채로 유지한다 */
const openReports = new Set<string>();
/** 기지 화면 애니메이션 루프 (조명 점멸·에너지 장막) */
let cityAnimId = 0;
/** 마지막으로 그린 DOM의 구조 지문 — 바뀔 때만 다시 그린다 */
let lastStructureKey = '';


export function setSelectedHero(id: string): void {
  selectedHeroId = id;
}

export function setMessage(text: string): void {
  message = text;
}
export function setTab(tab: Tab): void {
  activeTab = tab;
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height: 100%; }
  body {
    font-family: 'Malgun Gothic', -apple-system, sans-serif;
    background: #1b1614; color: #ece5df; margin: 0;
    -webkit-text-size-adjust: 100%; overscroll-behavior: none;
  }
  #app { display: flex; flex-direction: column; height: 100dvh; max-width: 560px; margin: 0 auto; }

  /* 상단 고정: 자원 + 큐 */
  .topbar { flex: 0 0 auto; background: #241e1b; border-bottom: 1px solid #3a322c;
    padding: calc(env(safe-area-inset-top) + 8px) 10px 8px; }
  .resources { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
  .resources div { text-align: center; font-size: 11px; color: #b5a99f; line-height: 1.35;
    min-width: 0; overflow: hidden; }
  .resources b { display: block; color: #e0b568; font-size: 14px; font-variant-numeric: tabular-nums; }
  .queue { margin-top: 6px; font-size: 12px; color: #7db4e0; display: flex;
    align-items: center; gap: 8px; justify-content: space-between; }
  .queue .bar { flex: 1; height: 4px; background: #3a322c; border-radius: 2px; overflow: hidden; }
  .queue .bar i { display: block; height: 100%; background: #7db4e0; }
  .msg { margin-top: 6px; font-size: 12px; color: #e08a7e; }

  /* 스크롤 본문 */
  .content { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 10px; }
  h2 { font-size: 14px; margin: 16px 0 8px; color: #e0b568; }
  h2:first-child { margin-top: 0; }

  .card { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    background: #241e1b; border: 1px solid #3a322c; border-radius: 10px;
    padding: 12px 14px; margin-bottom: 8px; }
  .card small { color: #b5a99f; display: block; font-size: 12px; line-height: 1.45; }
  .card .actions { display: flex; gap: 6px; flex-shrink: 0; }
  .card b { font-size: 15px; }

  button { background: #a0281c; color: #fff; border: 0; border-radius: 8px;
    padding: 0 14px; min-height: 44px; font-size: 14px; font-family: inherit; cursor: pointer; }
  button:disabled { background: #322b26; color: #7d7168; }
  button:focus-visible { outline: 2px solid #e0b568; outline-offset: 2px; }
  button.small { min-height: 32px; padding: 0 10px; font-size: 12px; background: #3a322c; }

  .army { display: flex; gap: 8px; flex-wrap: wrap; }
  .army span { background: #241e1b; border: 1px solid #3a322c; border-radius: 8px;
    padding: 6px 10px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
  .army b { color: #7fd39a; font-variant-numeric: tabular-nums; }
  .tier { color: #8a7d73; font-size: 11px; }

  /* 원작 유닛 초상화 */
  .uicon { object-fit: contain; background: #1b1614; border-radius: 6px;
    border: 1px solid #3a322c; flex: 0 0 auto; vertical-align: middle; }
  .unitrow { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .unitrow > div { min-width: 0; }

  canvas { width: 100%; display: block; border-radius: 12px; touch-action: manipulation; }
  /* 기지 캔버스는 건물을 끌어 옮기므로 터치를 스크롤에 뺏기면 안 된다.
     대신 목록은 캔버스 아래를 잡고 스크롤한다. */
  #cityview { touch-action: none; user-select: none; -webkit-user-select: none; }

  .card small.faint { color: #7d7168; }
  .card small.locked { color: #e0b568; }
  .card.dim { opacity: 0.62; }
  h2.sub { font-size: 12px; color: #8a7d73; margin: 14px 0 6px;
    text-transform: none; letter-spacing: 0.04em; }
  h2 .tier { font-weight: 400; }

  /* 하단 탭 — 탭 개수가 늘어도 자동으로 한 줄에 나눠 담는다 */
  .tabs { flex: 0 0 auto; display: grid;
    grid-auto-flow: column; grid-auto-columns: 1fr;
    background: #241e1b; border-top: 1px solid #3a322c;
    padding-bottom: env(safe-area-inset-bottom); }
  .tabs button { background: none; color: #8a7d73; border-radius: 0; min-height: 56px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; font-size: 11px; padding: 0; }
  .tabs button i { font-style: normal; font-size: 19px; line-height: 1; }
  .tabs button[aria-current="true"] { color: #e0b568; box-shadow: inset 0 2px 0 #a0281c; }

  /* 종족 선택 */
  .race-select { padding: 32px 16px; text-align: center; }
  .race-card { display: block; width: 100%; background: #241e1b; border: 1px solid #3a322c;
    border-radius: 12px; padding: 18px; margin-bottom: 10px; color: inherit;
    text-align: left; min-height: 0; }
  .race-card b { font-size: 17px; display: block; margin-bottom: 6px; color: #e0b568; }
  .race-card small { color: #b5a99f; font-size: 13px; line-height: 1.5; }

  /* 지휘관 선택 칩 */
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .chip { background: #241e1b; border: 1px solid #3a322c; color: #b5a99f;
    min-height: 38px; font-size: 13px; }
  .chip.on { border-color: #a0281c; color: #e0b568; }

  /* 전투 기록 — 편지함 */
  .mail-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .mail-head h2 { margin: 16px 0 8px; }
  .mail-head h2 em { font-style: normal; background: #a0281c; color: #fff;
    border-radius: 99px; padding: 1px 7px; font-size: 11px; vertical-align: middle; }
  .mail { background: #241e1b; border: 1px solid #3a322c; border-radius: 10px; overflow: hidden; }
  .mailrow + .mailrow { border-top: 1px solid #3a322c; }
  .mailrow summary { padding: 11px 12px; cursor: pointer; font-size: 13px;
    list-style: none; display: flex; align-items: center; gap: 8px; }
  .mailrow summary::-webkit-details-marker { display: none; }
  .mailrow .dot { width: 7px; height: 7px; border-radius: 50%; background: transparent; flex: 0 0 auto; }
  .mailrow.unread .dot { background: #e0b568; }
  .mailrow.unread .mtitle { font-weight: 700; }
  .mtitle { flex: 1 1 auto; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; color: #ece5df; }
  .mtitle .win { color: #7fd39a; }
  .mtitle .lose { color: #e08a7e; }
  .mtime { flex: 0 0 auto; color: #8a7d73; font-size: 11px; }
  .mailrow .del { flex: 0 0 auto; background: none; color: #6b625b;
    min-height: 28px; padding: 0 6px; font-size: 14px; }
  .mailrow .del:hover, .mailrow .del:focus-visible { color: #e08a7e; }
  .report-body { padding: 2px 14px 12px; border-top: 1px solid #3a322c; background: #1f1917; }
  .report-body small { display: block; color: #b5a99f; font-size: 12px;
    line-height: 1.6; margin-top: 6px; }
  .log { margin-top: 10px; max-height: 220px; overflow-y: auto;
    background: #1b1614; border-radius: 8px; padding: 8px 10px; }
  .logline { font-size: 11.5px; line-height: 1.7; color: #8a7d73;
    border-left: 2px solid #3a322c; padding-left: 8px; }
  .logline.attacker { color: #b5c9d8; border-left-color: #2f6db3; }
  .logline.defender { color: #d8b5b5; border-left-color: #a0281c; }
  .logline b { color: #e0b568; }
  .logline span { color: #6b625b; margin-right: 4px; }

  /* 장비 슬롯 */
  .slots { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
  .slot { background: #1b1614; border: 1px solid #3a322c; border-radius: 8px;
    padding: 8px 10px; font-size: 12px; position: relative; }
  .slot span { display: block; font-weight: 700; }
  .slot small { display: block; color: #8a7d73; font-size: 11px; line-height: 1.45; }
  .slot.empty span { color: #6b625b; font-weight: 400; }
  .slot button { margin-top: 6px; min-height: 28px; font-size: 11px; }

  /* 도감 표 */
  .statwrap { overflow-x: auto; margin-top: 6px; }
  table { border-collapse: collapse; font-size: 12px; width: 100%; }
  th, td { padding: 5px 8px; text-align: right; white-space: nowrap;
    border-bottom: 1px solid #3a322c; font-variant-numeric: tabular-nums; }
  th { color: #8a7d73; font-weight: 600; }
  th:first-child, td:first-child { text-align: left; }
`;

const RACE_FLAVOR: Record<RaceId, string> = {
  coalition: '균형 잡힌 인류 연합군. 보병과 기갑, 항공 전력을 두루 운용한다.',
  cluster: '고등 문명의 정예 병기. 개체는 비싸지만 하나하나가 압도적이다.',
  swarm: '값싼 개체를 대량으로 쏟아내는 유기 생명체. 수로 전선을 무너뜨린다.',
};

/** 건설 목록에서 묶어 보여줄 순서 */
const CATEGORY_ORDER: BuildingCategory[] = ['자원', '군사', '방어', '지휘', '특수'];

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'city', icon: '🛰️', label: '기지' },
  { id: 'hero', icon: '🎖️', label: '지휘관' },
  { id: 'map', icon: '🗺️', label: '맵' },
  { id: 'info', icon: '📖', label: '정보' },
];

function ensureStyle(): void {
  if (document.getElementById('newworld-style')) return;
  const style = document.createElement('style');
  style.id = 'newworld-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

/**
 * 큰 수를 k/M/B 약어로 줄인다. 자원이 억 단위까지 가면 상단 바가 넘치므로
 * 유효숫자 3자리 정도만 보여주고, 정확한 값은 title 속성으로 남긴다.
 */
export function formatNumber(n: number): string {
  const v = Math.floor(n);
  if (v < 1000) return String(v);
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [limit, suffix] of units) {
    if (v < limit) continue;
    const scaled = v / limit;
    const dec = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    let s = scaled.toFixed(dec);
    if (s.includes('.')) s = s.replace(/\.?0+$/, ''); // 1.00 → 1, 12.30 → 12.3
    return s + suffix;
  }
  return String(v);
}

function costText(cost: Partial<Record<ResourceKind, number>>): string {
  return Object.entries(cost)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${RESOURCE_LABELS[k as ResourceKind]} ${formatNumber(v ?? 0)}`)
    .join(' · ');
}

/**
 * 버튼에 비용을 실어두면 매 틱 자원만 다시 검사해 활성/비활성을 갱신할 수 있다
 * (DOM을 새로 그리지 않고). blocked는 자원과 무관한 차단 사유(큐 사용 중, 잠김 등).
 */
function costAttrs(cost: Partial<Record<ResourceKind, number>>, blocked: boolean): string {
  return `data-cost='${JSON.stringify(cost)}' data-blocked="${blocked ? 1 : 0}"`;
}

/**
 * 원작 유닛 초상화. scripts/fetch-unit-images.mjs로 받아둔 파일을 쓰고,
 * 없으면(저장소에는 포함하지 않으므로) 조용히 숨긴다.
 */
function unitIcon(unitId: string, size = 34): string {
  return `<img class="uicon" style="width:${size}px;height:${size}px"
    src="/assets/units/${unitId}.gif" alt="" loading="lazy"
    onerror="this.style.display='none'">`;
}

function statLine(s: HeroStats): string {
  return (Object.keys(HERO_STAT_LABELS) as (keyof HeroStats)[])
    .map((k) => `${HERO_STAT_LABELS[k]} ${s[k]}`)
    .join(' · ');
}

function renderRaceSelect(root: HTMLElement, cb: RenderCallbacks): void {
  const cards = (Object.keys(RACE_LABELS) as RaceId[])
    .map(
      (r) => `<button class="race-card" data-race="${r}">
        <b>${RACE_LABELS[r]}</b><small>${RACE_FLAVOR[r]}</small>
      </button>`,
    )
    .join('');
  root.innerHTML = `<div class="race-select">
    <h1 style="font-size:22px;margin:0 0 6px;">NewWorld</h1>
    <p style="color:#b5a99f;font-size:14px;margin:0 0 24px;">영지를 다스릴 종족을 선택하세요.</p>
    ${cards}
  </div>`;
  root.querySelectorAll<HTMLButtonElement>('button[data-race]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onSelectRace(btn.dataset.race as RaceId));
  });
}

// ── 탭별 본문 ────────────────────────────────────────────────

/**
 * 도시 화면. 원작처럼 건물을 눌러 그 건물의 기능을 연다:
 * 병영 → 병력·생산, 연구소 → 병종 연구, 용병 사무소 → 지휘관 영입.
 * 빈 터를 누르면 그 자리에 지을 수 있는 건물 목록이 아래에 뜬다.
 */
function cityTab(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  now: number,
): string {
  const canvas = `<canvas id="cityview" width="${CITY_W}" height="${CITY_H}"></canvas>`;
  const hint = `<div class="card"><small>건물을 끌어다 놓아 자리를 바꾸고(놓는 자리에 건물이 있으면 서로 맞바꾼다),
    빈 터 <b>+</b>를 눌러 새 건물을 짓는다.</small></div>`;

  if (selectedCell) return `${canvas}${buildPanel(state, buildingDefs, selectedCell)}`;

  const sel = selectedBuilding ? state.buildings.find((b) => b.defId === selectedBuilding) : null;
  const def = sel ? buildingDefs.get(sel.defId) : null;
  if (!sel || !def) return `${canvas}${hint}`;

  // ── 건물 공통: 건설/확장 ──
  const next = def.levels[sel.level];
  const unmet = sel.level === 0 ? unmetRequirements(state, def) : [];
  let action = '<small>최대 레벨</small>';
  const constructing = isBuilding(state, def.id);
  if (next) {
    const blocked = constructing || !hasFreeBuildSlot(state) || unmet.length > 0;
    const verb = sel.level === 0 ? '건설' : `Lv.${sel.level + 1}`;
    action = `<button data-upgrade="${def.id}" ${costAttrs(next.upgradeCost, blocked)}>${verb}</button>`;
  }
  const produce =
    def.produces && sel.level >= 1
      ? `<small>생산 ${RESOURCE_LABELS[def.produces]} ${def.levels[sel.level - 1]?.productionPerHour ?? 0}/시간</small>`
      : '';
  const boost = def.boosts
    ? `<small>${boostText(def)}${sel.level >= 1 ? ` (현재 +${def.boosts.percentPerLevel * sel.level}%)` : ''}</small>`
    : '';
  const costLine = next
    ? `<small>${costText(next.upgradeCost)} · ${next.upgradeSeconds}초</small>`
    : '';
  const lockLine = unmet.length
    ? `<small class="locked">🔒 ${requirementText(unmet, buildingDefs)}</small>`
    : '';
  const levelText =
    sel.level >= 1
      ? `Lv.${sel.level}`
      : `<span class="tier">${constructing ? '건설 중' : '미건설'}</span>`;
  const moveHint = isGridBuilding(def)
    ? '<small class="faint">끌어서 자리를 옮길 수 있다.</small>'
    : '<small class="faint">자리가 정해진 구조물이라 옮길 수 없다.</small>';

  const header = `<div class="card">
    <div><b>${def.name}</b> ${levelText}${def.planned ? ' <span class="tier">효과 미구현</span>' : ''}
      <small>${def.description}</small>${produce}${boost}${costLine}${lockLine}
      ${moveHint}
    </div>
    <div class="actions">${action}</div>
  </div>`;

  // ── 건물별 기능 ──
  let body = '';
  if (def.id === BARRACKS_ID) body = barracksPanel(state, unitDefs, sel.level);
  else if (def.id === ACADEMY_ID) body = academyPanel(state, unitDefs, sel.level);
  else if (def.id === TAVERN_ID) body = tavernPanel(state, sel.level, now);

  return `${canvas}${header}${body}`;
}

/**
 * 빈 부지 패널: 그 자리에 지을 수 있는 건물 목록.
 * 아직 짓지 않은 건물만 후보고, 선행 조건(건축 트리)을 못 채운 건물은 잠긴 채로
 * 무엇이 필요한지 보여준다 — 원작처럼 다음 목표가 화면에 남아 있어야 한다.
 */
function buildPanel(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  cell: Cell,
): string {
  const candidates = unplacedBuildings(state, buildingDefs)
    .map((b) => buildingDefs.get(b.defId))
    .filter((d): d is BuildingDef => d !== undefined)
    .map((def) => ({ def, unmet: unmetRequirements(state, def) }));

  if (!candidates.length) {
    return `<h2>건설 — ${cellLabel(cell)}</h2>
      <div class="card"><small>부지 36칸에 들어갈 건물을 모두 지었다.
        건물을 이 자리로 끌어와 배치를 정리할 수 있다.</small></div>`;
  }

  const ready = candidates.filter((c) => !c.unmet.length).length;
  const sections = CATEGORY_ORDER.map((category) => {
    const group = candidates
      .filter((c) => c.def.category === category)
      // 지을 수 있는 것부터, 그다음 잠긴 것
      .sort((a, b) => a.unmet.length - b.unmet.length);
    if (!group.length) return '';
    return `<h2 class="sub">${category} <span class="tier">${group.length}</span></h2>
      ${group.map(({ def, unmet }) => buildRow(state, buildingDefs, def, unmet)).join('')}`;
  }).join('');

  return `<h2>건설 — ${cellLabel(cell)}
      <span class="tier">가능 ${ready} / 남은 건물 ${candidates.length}</span></h2>
    ${buildSlotLine(state)}${sections}`;
}

/** 건설 슬롯 사용 현황 — 버튼이 왜 꺼져 있는지 알 수 있게 */
function buildSlotLine(state: GameState): string {
  const slots = buildSlots(state);
  const used = state.upgradeQueue.length;
  if (!used) return '';
  const tail = used >= slots ? ' · 하나가 끝나야 새로 지을 수 있다' : ' · 동시에 진행된다';
  return `<div class="card"><small class="locked">건설 슬롯 ${used}/${slots} 사용 중${tail}</small></div>`;
}

/** 건설 목록 한 줄 */
function buildRow(
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  def: BuildingDef,
  unmet: ReturnType<typeof unmetRequirements>,
): string {
  const lv1 = def.levels[0];
  const locked = unmet.length > 0;
  const blocked = locked || !hasFreeBuildSlot(state);
  const effect = def.produces
    ? `<small>생산 ${RESOURCE_LABELS[def.produces]} ${lv1.productionPerHour ?? 0}/시간</small>`
    : def.boosts
      ? `<small>${boostText(def)}</small>`
      : '';
  const info = locked
    ? `<small class="locked">🔒 ${requirementText(unmet, buildingDefs)}</small>`
    : `<small>${costText(lv1.upgradeCost)} · ${lv1.upgradeSeconds}초</small>`;
  return `<div class="card${locked ? ' dim' : ''}">
    <div><b>${def.name}</b>${def.planned ? ' <span class="tier">효과 미구현</span>' : ''}
      <small>${def.description}</small>${effect}${info}
    </div>
    <div class="actions">
      <button data-place="${def.id}" ${costAttrs(lv1.upgradeCost, blocked)}>건설</button>
    </div>
  </div>`;
}

function boostText(def: BuildingDef): string {
  const b = def.boosts!;
  const what = b.resource === 'all' ? '모든 자원' : RESOURCE_LABELS[b.resource];
  return `${what} 산출 +${b.percentPerLevel}%/레벨`;
}

/** 병영 패널: 보유 병력 + 훈련 */
function barracksPanel(state: GameState, unitDefs: Map<string, UnitDef>, level: number): string {
  const entries = Object.entries(state.army).filter(([, n]) => n > 0);
  const army = entries.length
    ? `<div class="army">${entries
        .map(([id, n]) => {
          const lv = state.unitLevels[id] ?? 1;
          return `<span>${unitIcon(id, 26)}${unitDefs.get(id)?.nameKo ?? id} <b>${formatNumber(n)}</b>
            ${lv > 1 ? `<span class="tier">Lv.${lv}</span>` : ''}</span>`;
        })
        .join('')}</div>`
    : '<div class="card"><small>아직 병력이 없다.</small></div>';

  const raceUnits = [...unitDefs.values()]
    .filter((u) => u.raceId === state.raceId)
    .sort((a, b) => a.tier - b.tier);

  let training: string;
  if (level < 1) {
    training = '<div class="card"><small>병영을 지으면 유닛을 훈련할 수 있다.</small></div>';
  } else {
    training = raceUnits
      .map((u) => {
        const locked = u.tier > level;
        const cost5 = Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, (v ?? 0) * 5]));
        const blocked = locked || state.trainQueue !== null;
        const info = locked
          ? `🔒 병영 Lv.${u.tier} 필요`
          : `${costText(u.cost)}<br>${u.trainSeconds ?? '?'}초/기 · 식량 ${u.foodUpkeepPerHour ?? 0}/시간`;
        return `<div class="card">
          <div class="unitrow">${unitIcon(u.id)}
            <div><span class="tier">${u.tier}계</span> <b>${u.nameKo}</b><small>${info}</small></div>
          </div>
          <div class="actions">
            <button data-train="${u.id}" data-count="1" ${costAttrs(u.cost, blocked)}>×1</button>
            <button data-train="${u.id}" data-count="5" ${costAttrs(cost5, blocked)}>×5</button>
          </div>
        </div>`;
      })
      .join('');
  }

  return `<h2>보유 병력</h2>${army}<h2>병력 생산</h2>${training}`;
}

/** 연구소 패널: 병종 연구 */
function academyPanel(
  state: GameState,
  unitDefs: Map<string, UnitDef>,
  academyLevel: number,
): string {
  const raceUnits = [...unitDefs.values()]
    .filter((u) => u.raceId === state.raceId)
    .sort((a, b) => a.tier - b.tier);

  let research: string;
  if (academyLevel < 1) {
    research = '<div class="card"><small>연구소를 지으면 병종 능력치를 올릴 수 있다.</small></div>';
  } else {
    const cap = maxResearchableLevel(academyLevel);
    research = raceUnits
      .map((u) => {
        const cur = state.unitLevels[u.id] ?? 1;
        const next = cur + 1;
        const s1 = u.stats.find((s) => s.level === cur);
        const s2 = u.stats.find((s) => s.level === next);
        const statNow = s1 ? `생명 ${s1.hp} · 공격 ${Math.max(s1.patk, s1.matk)} · 방어 ${s1.pdef}` : '';

        if (cur >= MAX_UNIT_LEVEL) {
          return `<div class="card">
            <div class="unitrow">${unitIcon(u.id)}
              <div><span class="tier">${u.tier}계</span> <b>${u.nameKo}</b> Lv.${cur}
                <small>${statNow}</small><small>최대 연구 완료</small></div>
            </div>
          </div>`;
        }
        const overCap = next > cap;
        const cost = researchCost(u, next);
        const secs = researchSeconds(u, next);
        const gain = s2
          ? `→ 생명 ${s2.hp} · 공격 ${Math.max(s2.patk, s2.matk)} · 방어 ${s2.pdef}`
          : '';
        const info = overCap
          ? `🔒 연구소 Lv.${Math.ceil(next / 2)} 필요`
          : `${statNow}<br>${gain}<br>${costText(cost)} · ${Math.round(secs / 60)}분`;
        return `<div class="card">
          <div class="unitrow">${unitIcon(u.id)}
            <div><span class="tier">${u.tier}계</span> <b>${u.nameKo}</b> Lv.${cur}
              <small>${info}</small></div>
          </div>
          <div class="actions">
            <button data-research="${u.id}"
              ${costAttrs(cost, overCap || state.researchQueue !== null)}>Lv.${next}</button>
          </div>
        </div>`;
      })
      .join('');
  }

  return `<h2>병종 연구</h2>${research}`;
}

function itemLine(it: EquipItem): string {
  const parts: string[] = [];
  if (it.patk) parts.push(`물공 +${it.patk}`);
  if (it.matk) parts.push(`마공 +${it.matk}`);
  if (it.pdef) parts.push(`물방 +${it.pdef}`);
  if (it.mdef) parts.push(`마방 +${it.mdef}`);
  if (it.effect && it.effectValue) {
    parts.push(`${it.effectKo} +${it.effectValue}${it.effectUnit === 'multiplier' ? '배' : '%'}`);
  }
  return parts.join(' · ');
}

function rarityColor(r: string): string {
  return RARITIES.find((x) => x.id === r)?.color ?? '#9a9a9a';
}

function heroEquipBlock(hero: GameState['heroes'][number]): string {
  const t = equipTotals(hero);
  const worn = SLOTS.map((s) => {
    const it = hero.equipment?.[s.id];
    if (!it) {
      return `<div class="slot empty"><span>${s.ko}</span><small>비어 있음</small></div>`;
    }
    return `<div class="slot">
      <span style="color:${rarityColor(it.rarity)}">${it.nameKo}</span>
      <small>${s.ko} · ${itemLine(it)}</small>
      <button class="small" data-unequip="${hero.id}:${s.id}">해제</button>
    </div>`;
  }).join('');

  const setLine = t.completedSets.length
    ? `<small>세트 완성: ${t.completedSets.join(', ')} (세트 보너스 적용)</small>`
    : '';
  const totalLine = `<small>장비 합계 물공 +${t.patk} · 마공 +${t.matk} · 물방 +${t.pdef} · 마방 +${t.mdef}</small>`;

  return `<div class="card" style="display:block;">
    <div><b>${hero.name}</b> Lv.${hero.level}
      <small>${statLine(hero.stats)}</small>
      <small>지휘 ${commandLimit(hero)}명 · 치명타 ${(critChance(hero) * 100).toFixed(1)}%</small>
      ${totalLine}${setLine}
    </div>
    <div class="slots">${worn}</div>
  </div>`;
}

/** 용병 사무소 패널: 지휘관 영입 후보 */
function tavernPanel(state: GameState, level: number, now: number): string {
  if (level < 1) {
    return '<div class="card"><small>용병 사무소를 지으면 지휘관을 영입할 수 있다.</small></div>';
  }

  const nextRestock = Math.max(
    0,
    Math.ceil((state.tavern.refreshedAt + FREE_RESTOCK_SECONDS * 1000 - now) / 1000),
  );
  const canHire = state.heroes.length < level;
  const candidates = state.tavern.candidates
    .map(
      (c, i) => `<div class="card">
        <div><b>${c.name}</b> <span class="tier">속성합 ${statTotal(c.stats)}</span>
          <small>${statLine(c.stats)}</small></div>
        <div class="actions">
          <button data-hire="${i}" ${costAttrs({ gold: c.price }, !canHire)}>금화 ${c.price}</button>
        </div>
      </div>`,
    )
    .join('');

  return `<h2>지휘관 영입 (${state.heroes.length}/${level})</h2>
    <div class="card">
      <div><small>무료 갱신까지 <span id="tavern-countdown">${nextRestock}</span>초</small></div>
      <div class="actions">
        <button class="small" data-refresh-tavern ${costAttrs({ gold: MANUAL_REFRESH_GOLD }, false)}>
          즉시 갱신 (${MANUAL_REFRESH_GOLD})</button>
      </div>
    </div>
    ${candidates}`;
}

/** 지휘관 탭: 보유 지휘관 + 장비 + 창고 */
function heroTab(state: GameState): string {
  const heroes = state.heroes.length
    ? state.heroes.map((h) => heroEquipBlock(h)).join('')
    : `<div class="card"><small>영입한 지휘관이 없다. 기지의 용병 사무소에서 영입할 수 있다.</small></div>`;

  // ── 창고 ──
  const inventory = state.inventory.length
    ? state.inventory
        .map((it) => {
          const target = state.heroes.find((h) => h.level >= it.heroLevel);
          return `<div class="card">
            <div><b style="color:${rarityColor(it.rarity)}">${it.nameKo}</b>
              <small>${SLOT_LABELS[it.slot]}${it.setNameKo ? ` · ${it.setNameKo}` : ''} · 요구 Lv.${it.heroLevel}</small>
              <small>${itemLine(it)}</small></div>
            <div class="actions">
              <button data-equip="${it.id}" ${target ? '' : 'disabled'}>착용</button>
              <button class="small" data-discard="${it.id}">버림</button>
            </div>
          </div>`;
        })
        .join('')
    : '<div class="card"><small>창고가 비어 있다. 교전지에서 승리하면 장비를 얻는다.</small></div>';

  return `<h2>지휘관</h2>${heroes}
    <h2>창고 (${state.inventory.length})</h2>${inventory}`;
}

function unitCountText(list: UnitCount[], unitDefs: Map<string, UnitDef>): string {
  if (!list.length) return '없음';
  return list.map((u) => `${unitDefs.get(u.unitId)?.nameKo ?? u.unitId} ${u.count}기`).join(', ');
}

function worldTab(
  state: GameState,
  camps: CampDef[],
  nodes: NodeDef[],
  unitDefs: Map<string, UnitDef>,
  maxHeld: number,
  now: number,
): string {
  const hero = state.heroes.find((h) => h.id === selectedHeroId) ?? state.heroes[0];
  const marchArmy = hero ? selectArmyForMarch(state.army, hero, unitDefs) : [];
  const hasArmy = marchArmy.length > 0;

  // ── 선택한 장소 패널 ──
  let sitePanel = `<div class="card"><small>지도의 장소를 눌러 정보를 확인하세요.
    💀 교전지는 전리품을, 자원 아이콘은 점령 시 시간당 생산을 준다.</small></div>`;
  const camp = camps.find((c) => c.id === selectedSiteId);
  const node = nodes.find((n) => n.id === selectedSiteId);
  const target = camp ?? node;

  if (target) {
    const enemies = target.monsters
      .map((m) => `${unitDefs.get(m.unitId)?.nameKo ?? m.unitId} ${m.count}기`)
      .join(', ');
    const held = node && state.heldNodes.some((h) => h.nodeId === node.id);
    let rewardLine: string;
    let action: string;

    if (camp) {
      const lootText = Object.entries(camp.loot)
        .map(([k, v]) => `${RESOURCE_LABELS[k as ResourceKind]} ${formatNumber(v)}`)
        .join(' · ');
      rewardLine = `보상: ${lootText}`;
      action = `<button data-dispatch="${camp.id}" data-kind="hunt"
        ${hasArmy && !state.march ? '' : 'disabled'}>출정</button>`;
    } else if (held) {
      rewardLine = `생산 중: ${RESOURCE_LABELS[node!.produces]} ${node!.perHour}/시간`;
      action = `<button class="small" data-abandon="${node!.id}">점령 포기</button>`;
    } else {
      rewardLine = `점령 시: ${RESOURCE_LABELS[node!.produces]} ${node!.perHour}/시간`;
      const capped = state.heldNodes.length >= maxHeld;
      action = `<button data-dispatch="${node!.id}" data-kind="capture"
        ${hasArmy && !state.march && !capped ? '' : 'disabled'}>${capped ? '한도 초과' : '점령'}</button>`;
    }

    sitePanel = `<div class="card">
      <div><b>${target.name}</b>${held ? ' <span class="tier">점령 중</span>' : ''}
        <small>${target.description}</small>
        <small>수비: ${enemies}</small>
        <small>${rewardLine} · 왕복 ${Math.round(target.marchSeconds / 60)}분</small>
      </div>
      <div class="actions">${action}</div>
    </div>`;
  }

  // ── 부대 상태 ──
  let armyPanel: string;
  if (state.march) {
    const remain = Math.max(0, Math.ceil((state.march.returnsAt - now) / 1000));
    armyPanel = `<div class="card">
      <div><b>${state.march.campName}</b> ${state.march.kind === 'capture' ? '점령전' : '사냥'} 출정 중
        <small>귀환까지 <span id="march-countdown">${remain}</span>초</small>
      </div>
    </div>`;
  } else if (!hero) {
    armyPanel = '<div class="card"><small>용병 사무소에서 지휘관을 영입해야 부대를 이끌 수 있다.</small></div>';
  } else {
    const heroPicker =
      state.heroes.length > 1
        ? `<div class="chips">${state.heroes
            .map(
              (h) =>
                `<button class="chip ${h.id === hero.id ? 'on' : ''}" data-hero="${h.id}">${h.name} Lv.${h.level}</button>`,
            )
            .join('')}</div>`
        : '';
    armyPanel = `${heroPicker}
      <div class="card">
        <div><b>${hero.name}</b> Lv.${hero.level}
          <small>지휘 한도 ${commandLimit(hero)}명 · 치명타 ${(critChance(hero) * 100).toFixed(1)}%</small>
          <small>출정 병력: ${unitCountText(marchArmy, unitDefs)}</small>
        </div>
      </div>`;
  }

  // ── 보유 자원지 ──
  const holdings = state.heldNodes.length
    ? state.heldNodes
        .map((h) => {
          const def = nodes.find((n) => n.id === h.nodeId);
          if (!def) return '';
          return `<div class="card">
            <div><b>${def.name}</b>
              <small>${RESOURCE_LABELS[def.produces]} ${def.perHour}/시간</small></div>
            <div class="actions"><button class="small" data-abandon="${def.id}">포기</button></div>
          </div>`;
        })
        .join('')
    : '<div class="card"><small>점령한 자원지가 없다. 지도에서 자원지를 골라 점령해보자.</small></div>';

  return `<canvas id="worldmap" width="${WORLD_SIZE}" height="${WORLD_SIZE}"></canvas>
    ${sitePanel}
    <h2>부대</h2>
    ${armyPanel}
    <h2>보유 자원지 (${state.heldNodes.length}/${maxHeld})</h2>
    ${holdings}
    ${reportsSection(state, unitDefs, now)}`;
}

function reportsSection(
  state: GameState,
  unitDefs: Map<string, UnitDef>,
  now: number,
): string {
  if (!state.reports.length) {
    return `<h2>전투 기록</h2>
      <div class="card"><small>아직 전투 기록이 없다.</small></div>`;
  }
  const unread = state.reports.filter((r) => !r.read).length;
  const rows = state.reports
    .map((r) => {
      const mins = Math.max(0, Math.round((now - r.at) / 60000));
      const when = mins < 1 ? '방금' : mins < 60 ? `${mins}분 전` : `${Math.round(mins / 60)}시간 전`;
      const lootText = Object.entries(r.loot)
        .map(([k, v]) => `${RESOURCE_LABELS[k as ResourceKind]} ${formatNumber(v)}`)
        .join(' · ');
      const logLines = r.log
        .map(
          (l) =>
            `<div class="logline ${l.side}">
              <span>${l.round}R</span> ${l.attacker} → ${l.target}
              <b>${l.damage}</b> 피해${l.killed > 0 ? ` · ${l.killed}기 처치` : ''}${l.crit ? ' 💥' : ''}
            </div>`,
        )
        .join('');
      return `<details class="mailrow ${r.read ? '' : 'unread'}" data-report="${r.id}"
        ${openReports.has(r.id) ? 'open' : ''}>
        <summary>
          <i class="dot"></i>
          <span class="mtitle">
            <b class="${r.victory ? 'win' : 'lose'}">${r.victory ? '승리' : '패배'}</b>
            ${r.campName}${r.captured ? ' 🚩' : ''}${r.drops?.length ? ' 🎁' : ''}
          </span>
          <span class="mtime">${when}</span>
          <button class="del" data-del-report="${r.id}" aria-label="삭제">✕</button>
        </summary>
        <div class="report-body">
          <small>지휘: ${r.heroName} · ${r.rounds}라운드</small>
          <small>적 처치: ${unitCountText(r.defenderLosses, unitDefs)}</small>
          <small>아군 손실: ${unitCountText(r.attackerLosses, unitDefs)}</small>
          <small>생환: ${unitCountText(r.survivors, unitDefs)}</small>
          ${lootText ? `<small>전리품: ${lootText}</small>` : ''}
          ${
            r.drops?.length
              ? `<small>획득 장비: ${r.drops
                  .map(
                    (d) =>
                      `<b style="color:${rarityColor(d.rarity)}">${d.nameKo}</b>` +
                      ` <span class="tier">${SLOT_LABELS[d.slot]}</span>`,
                  )
                  .join(', ')}</small>`
              : ''
          }
          <small>경험치 +${r.xpGained}</small>
          <div class="log">${logLines}</div>
        </div>
      </details>`;
    })
    .join('');

  return `<div class="mail-head">
      <h2>전투 기록 ${unread ? `<em>${unread}</em>` : ''}</h2>
      <button class="small" data-clear-reports>전체 삭제</button>
    </div>
    <div class="mail">${rows}</div>`;
}

/** 정보 탭: 병종 자료 + 프로젝트 출처 */
function infoTab(state: GameState, unitDefs: Map<string, UnitDef>): string {
  const groups: { title: string; race: string }[] = [
    { title: `${RACE_LABELS[state.raceId!]} 병종`, race: state.raceId! },
    { title: '중립 몬스터', race: 'neutral' },
    { title: '악마', race: 'devil' },
  ];
  const codex = groups
    .map(({ title, race }) => {
      const units = [...unitDefs.values()]
        .filter((u) => u.raceId === race)
        .sort((a, b) => a.tier - b.tier);
      if (!units.length) return '';
      const rows = units
        .map((u) => {
          const at = (lv: number) => u.stats.find((s) => s.level === lv);
          const s1 = at(1);
          const s20 = at(20);
          return `<tr>
            <td><span class="unitrow">${unitIcon(u.id, 28)}
              <div>${u.tier}계 ${u.nameKo}</div></span></td>
            <td>${s1?.hp ?? '-'} → ${s20?.hp ?? '-'}</td>
            <td>${s1?.patk ?? '-'} → ${s20?.patk ?? '-'}</td>
            <td>${s1?.pdef ?? '-'} → ${s20?.pdef ?? '-'}</td>
            <td>${u.speed ?? '-'}</td>
          </tr>`;
        })
        .join('');
      return `<h2>${title}</h2>
        <div class="card" style="display:block;">
          <div class="statwrap"><table>
            <thead><tr><th>유닛</th><th>생명 1→20</th><th>물공</th><th>물방</th><th>속도</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          <small style="margin-top:8px;">출처: 4399 공식 가이드 실측</small>
        </div>`;
    })
    .join('');

  return `${codex}
    <h2>이 게임에 대해</h2>
    <div class="card" style="display:block;">
      <small>2008~2013년 서비스된 웹게임 <b>칠용전설</b>(중국 원작 七龙纪)을 남아 있는
        자료를 근거로 재현한 개인 프로젝트입니다.</small>
      <small>유닛 스탯·장비 수치·영웅 공식은 원작 공식 가이드(4399)와 바이두백과에서
        수집한 실측값이고, 자료가 없는 부분(건설 비용·전투 판정식·드롭 확률 등)은
        추정치로 표시해 두었습니다.</small>
      <small>원작 메뉴는 도시·영웅·맵·길드·시장·랭킹·정보 구성이었습니다.
        길드·시장·랭킹은 아직 구현하지 않았습니다.</small>
    </div>`;
}

// ── 기지 캔버스 조작 ─────────────────────────────────────────

/**
 * 탭하면 선택, 끌면 이동.
 *
 * 포인터 이벤트 하나로 마우스·터치를 함께 받는다. 임계값(캔버스 좌표 10px)을
 * 넘겨야 끌기로 보기 때문에 손가락이 조금 흔들려도 탭은 탭으로 남는다.
 * 캔버스에 touch-action:none 을 줘서 끌기 도중 화면이 딸려 스크롤되지 않는다.
 */
function wireCityCanvas(
  canvas: HTMLCanvasElement,
  buildingDefs: Map<string, BuildingDef>,
  cb: RenderCallbacks,
): void {
  const DRAG_THRESHOLD = 10;
  let origin: { x: number; y: number; defId: string | null } | null = null;
  let dragging = false;

  const clear = () => {
    origin = null;
    dragging = false;
    setDragGhost(null);
  };
  /** 성벽·성문은 자리가 정해져 있어 끌 수 없다 */
  const draggable = (id: string | null) =>
    id !== null && isGridBuilding(buildingDefs.get(id)) ? id : null;

  canvas.addEventListener('pointerdown', (e) => {
    const p = toCanvasPoint(canvas, e.clientX, e.clientY);
    origin = { x: p.x, y: p.y, defId: draggable(buildingAt(p.x, p.y)) };
    dragging = false;
    if (origin.defId) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!origin?.defId) return;
    const p = toCanvasPoint(canvas, e.clientX, e.clientY);
    if (!dragging && Math.hypot(p.x - origin.x, p.y - origin.y) < DRAG_THRESHOLD) return;
    dragging = true;
    const cell = cellAt(p.x, p.y);
    setDragGhost({
      defId: origin.defId,
      px: p.x,
      py: p.y,
      cell,
      valid: cell !== null,
    });
  });

  canvas.addEventListener('pointerup', (e) => {
    const start = origin;
    const wasDrag = dragging;
    clear();
    if (!start) return;

    const p = toCanvasPoint(canvas, e.clientX, e.clientY);
    const cell = cellAt(p.x, p.y);

    if (wasDrag && start.defId) {
      // 격자 밖에 놓으면 제자리로 돌아간다
      if (cell) cb.onMoveBuilding(start.defId, cell.c, cell.r);
      return;
    }

    const id = buildingAt(p.x, p.y);
    if (id) {
      selectedBuilding = id;
      selectedCell = null;
    } else if (cell) {
      selectedCell = cell;
      selectedBuilding = null;
    } else {
      selectedBuilding = null;
      selectedCell = null;
    }
    scrollToPanel = true;
    cb.onSelectBuilding(selectedBuilding);
  });

  canvas.addEventListener('pointercancel', clear);
}

// ── 메인 렌더 ────────────────────────────────────────────────

export function render(
  root: HTMLElement,
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  camps: CampDef[],
  nodes: NodeDef[],
  maxHeld: number,
  now: number,
  cb: RenderCallbacks,
): void {
  ensureStyle();

  if (!state.raceId) {
    renderRaceSelect(root, cb);
    return;
  }

  // 골라 둔 빈 터에 건물이 들어섰으면(건설 완료·이동) 그 건물 패널로 넘어간다
  if (selectedCell) {
    const occupant = buildingAtCell(state, selectedCell.c, selectedCell.r);
    if (occupant) {
      selectedBuilding = occupant.defId;
      selectedCell = null;
    }
  }

  const resources = (Object.keys(RESOURCE_LABELS) as ResourceKind[])
    .map((k) => `<div data-res-cell="${k}">${RESOURCE_LABELS[k]}<b data-res="${k}"></b></div>`)
    .join('');

  const instant = import.meta.env.DEV ? '<button class="small" data-instant>⚡</button>' : '';
  const queues: string[] = [];
  // 건설은 슬롯마다 한 줄씩 동시에 돈다. 열 칸이 다 차면 상단을 다 잡아먹으므로
  // 곧 끝나는 것부터 세 줄만 펼치고 나머지는 한 줄로 접는다.
  const TOP_QUEUE_ROWS = 3;
  const running = state.upgradeQueue
    .map((job, i) => ({ job, i }))
    .sort((a, b) => a.job.finishesAt - b.job.finishesAt);
  running.slice(0, TOP_QUEUE_ROWS).forEach(({ job, i }) => {
    const def = buildingDefs.get(job.defId);
    queues.push(`<div class="queue"><span>🔨 ${def?.name ?? '?'} Lv.${job.targetLevel}</span>
      <span class="bar"><i id="q-build-${i}-bar"></i></span>
      <span id="q-build-${i}-remain"></span>${instant}</div>`);
  });
  if (running.length > TOP_QUEUE_ROWS) {
    queues.push(`<div class="queue"><span>🔨 외 ${running.length - TOP_QUEUE_ROWS}건 동시 건설 중
      <span class="tier">${running.length}/${buildSlots(state)}</span></span></div>`);
  }
  if (state.trainQueue) {
    const def = unitDefs.get(state.trainQueue.unitId);
    queues.push(`<div class="queue"><span>⚔️ ${def?.nameKo ?? '?'} ×${state.trainQueue.count}</span>
      <span class="bar"><i id="q-train-bar"></i></span>
      <span id="q-train-remain"></span>${instant}</div>`);
  }
  if (state.researchQueue) {
    const def = unitDefs.get(state.researchQueue.unitId);
    queues.push(`<div class="queue"><span>📜 ${def?.nameKo ?? '?'} Lv.${state.researchQueue.targetLevel}</span>
      <span class="bar"><i id="q-research-bar"></i></span>
      <span id="q-research-remain"></span>${instant}</div>`);
  }
  if (state.march) {
    queues.push(`<div class="queue"><span>🗡️ ${state.march.campName} 출정</span>
      <span class="bar"><i id="q-march-bar"></i></span>
      <span id="q-march-remain"></span>${instant}</div>`);
  }

  let body: string;
  if (activeTab === 'city') body = cityTab(state, buildingDefs, unitDefs, now);
  else if (activeTab === 'hero') body = heroTab(state);
  else if (activeTab === 'map') body = worldTab(state, camps, nodes, unitDefs, maxHeld, now);
  else body = infoTab(state, unitDefs);

  const tabs = TABS.map(
    (t) => `<button data-tab="${t.id}" aria-current="${t.id === activeTab}">
      <i>${t.icon}</i>${t.label}</button>`,
  ).join('');

  // 구조가 바뀌었을 때만 DOM을 새로 만든다. 매초 innerHTML을 갈아치우면
  // 모바일에서 탭이 씹히고 스크롤이 끊긴다.
  const key = JSON.stringify([
    activeTab,
    selectedBuilding,
    selectedCell && `${selectedCell.c},${selectedCell.r}`,
    message,
    state.raceId,
    state.buildings.map((b) => `${b.defId}:${b.level}:${b.col ?? '-'},${b.row ?? '-'}`),
    Object.entries(state.army).filter(([, n]) => n > 0),
    state.heroes.map((h) => h.id),
    state.tavern.candidates.map((c) => `${c.name}:${c.price}`),
    state.upgradeQueue.map((j) => `${j.defId}:${j.targetLevel}`),
    buildSlots(state),
    state.trainQueue && `${state.trainQueue.unitId}:${state.trainQueue.count}`,
    state.researchQueue && `${state.researchQueue.unitId}:${state.researchQueue.targetLevel}`,
    Object.entries(state.unitLevels),
    state.march?.campId ?? '',
    state.reports.map((r) => `${r.id}:${r.read ? 1 : 0}`),
    selectedHeroId,
    selectedSiteId,
    state.heroes.map(
      (h) =>
        `${h.id}:${h.level}:${Object.values(h.equipment ?? {})
          .map((i) => i?.id)
          .join('|')}`,
    ),
    state.heldNodes.map((h) => h.nodeId),
    state.inventory.map((i) => i.id),
  ]);

  if (key !== lastStructureKey) {
    lastStructureKey = key;
    const prevScroll = root.querySelector('.content')?.scrollTop ?? 0;

    root.innerHTML = `
      <div class="topbar">
        <div class="resources">${resources}</div>
        ${queues.join('')}
        ${message ? `<div class="msg">${message}</div>` : ''}
      </div>
      <div class="content">${body}</div>
      <nav class="tabs">${tabs}</nav>
    `;

    const content = root.querySelector<HTMLElement>('.content');
    if (content) content.scrollTop = prevScroll;

    // 부지를 고른 직후에는 캔버스 아래 패널이 화면에 걸치도록 살짝 끌어올린다.
    // (기지 캔버스가 세로 화면을 거의 다 먹어서, 안 그러면 목록이 안 보인다)
    if (content && scrollToPanel) {
      const cv = content.querySelector<HTMLCanvasElement>('#cityview');
      if (cv) {
        const visibleBelow = content.getBoundingClientRect().bottom - cv.getBoundingClientRect().bottom;
        if (visibleBelow < 160) content.scrollTop += 160 - visibleBelow;
      }
    }
    scrollToPanel = false;

    const canvas = root.querySelector<HTMLCanvasElement>('#cityview');
    if (canvas) wireCityCanvas(canvas, buildingDefs, cb);

    root.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onSelectTab(btn.dataset.tab as Tab));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-upgrade]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onUpgrade(btn.dataset.upgrade!));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-place]').forEach((btn) => {
      const cell = selectedCell;
      if (!cell) return;
      btn.addEventListener('click', () => cb.onPlaceBuilding(btn.dataset.place!, cell.c, cell.r));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-train]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onTrain(btn.dataset.train!, Number(btn.dataset.count)));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-hire]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onHire(Number(btn.dataset.hire)));
    });
    root
      .querySelector<HTMLButtonElement>('button[data-refresh-tavern]')
      ?.addEventListener('click', () => cb.onRefreshTavern());
    root.querySelectorAll<HTMLButtonElement>('button[data-instant]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onInstantFinish());
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-dispatch]').forEach((btn) => {
      const hero = state.heroes.find((h) => h.id === selectedHeroId) ?? state.heroes[0];
      btn.addEventListener('click', () =>
        cb.onDispatch(
          btn.dataset.dispatch!,
          btn.dataset.kind as 'hunt' | 'capture',
          hero?.id ?? '',
        ),
      );
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-hero]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onSelectHero(btn.dataset.hero!));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-research]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onResearch(btn.dataset.research!));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-equip]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onEquip(btn.dataset.equip!));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-unequip]').forEach((btn) => {
      const [heroId, slot] = btn.dataset.unequip!.split(':');
      btn.addEventListener('click', () => cb.onUnequip(heroId, slot as EquipSlot));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-discard]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onDiscard(btn.dataset.discard!));
    });
    // 삭제 버튼은 summary 안에 있으므로 펼침 토글을 막아야 한다
    root.querySelectorAll<HTMLButtonElement>('button[data-del-report]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cb.onDeleteReport(btn.dataset.delReport!);
      });
    });
    root
      .querySelector<HTMLButtonElement>('button[data-clear-reports]')
      ?.addEventListener('click', () => cb.onClearReports());
    root.querySelectorAll<HTMLDetailsElement>('details[data-report]').forEach((el) => {
      el.addEventListener('toggle', () => {
        const id = el.dataset.report!;
        if (el.open) {
          openReports.add(id);
          cb.onOpenReport(id);
        } else {
          openReports.delete(id);
        }
      });
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-abandon]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onAbandon(btn.dataset.abandon!));
    });

    const worldCanvas = root.querySelector<HTMLCanvasElement>('#worldmap');
    if (worldCanvas) {
      const sites: WorldSite[] = [
        ...camps.map((c) => ({ id: c.id, kind: 'camp' as const, pos: c.pos })),
        ...nodes.map((n) => ({ id: n.id, kind: 'node' as const, pos: n.pos })),
      ];
      worldCanvas.addEventListener('click', (e) => {
        const rect = worldCanvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) * worldCanvas.width) / rect.width;
        const y = ((e.clientY - rect.top) * worldCanvas.height) / rect.height;
        const site = siteAt(sites, Math.floor(x / WTILE), Math.floor(y / WTILE));
        selectedSiteId = site?.id ?? null;
        cb.onSelectSite(selectedSiteId);
      });
    }
  }

  updateDynamic(root, state, buildingDefs, unitDefs, camps, nodes, now);
}

/** 매 틱 갱신: 숫자·타이머·캔버스·버튼 활성 상태만 손댄다 (DOM 구조는 그대로) */
function updateDynamic(
  root: HTMLElement,
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  camps: CampDef[],
  nodes: NodeDef[],
  now: number,
): void {
  root.querySelectorAll<HTMLElement>('b[data-res]').forEach((el) => {
    const value = state.resources[el.dataset.res as ResourceKind];
    el.textContent = formatNumber(value);
    // 정확한 값은 길게 눌렀을 때(데스크톱은 마우스 오버) 확인
    el.parentElement?.setAttribute('title', Math.floor(value).toLocaleString());
  });

  const setQueue = (prefix: string, finishesAt: number, totalSeconds: number) => {
    const remain = Math.max(0, Math.ceil((finishesAt - now) / 1000));
    const remainEl = root.querySelector(`#q-${prefix}-remain`);
    if (remainEl) remainEl.textContent = `${remain}초`;
    const bar = root.querySelector<HTMLElement>(`#q-${prefix}-bar`);
    if (bar && totalSeconds > 0) {
      const done = Math.min(100, Math.max(0, (1 - remain / totalSeconds) * 100));
      bar.style.width = `${done}%`;
    }
  };
  state.upgradeQueue.forEach((job, i) => {
    const def = buildingDefs.get(job.defId);
    const secs = def?.levels[job.targetLevel - 1]?.upgradeSeconds ?? 0;
    setQueue(`build-${i}`, job.finishesAt, secs);
  });
  if (state.trainQueue) {
    const def = unitDefs.get(state.trainQueue.unitId);
    setQueue('train', state.trainQueue.finishesAt, (def?.trainSeconds ?? 0) * state.trainQueue.count);
  }
  if (state.researchQueue) {
    const def = unitDefs.get(state.researchQueue.unitId);
    setQueue(
      'research',
      state.researchQueue.finishesAt,
      def ? researchSeconds(def, state.researchQueue.targetLevel) : 0,
    );
  }
  if (state.march) {
    const camp = camps.find((c) => c.id === state.march!.campId);
    setQueue('march', state.march.returnsAt, camp?.marchSeconds ?? 0);
    const el = root.querySelector('#march-countdown');
    if (el) {
      el.textContent = String(Math.max(0, Math.ceil((state.march.returnsAt - now) / 1000)));
    }
  }

  const countdown = root.querySelector('#tavern-countdown');
  if (countdown) {
    countdown.textContent = String(
      Math.max(0, Math.ceil((state.tavern.refreshedAt + FREE_RESTOCK_SECONDS * 1000 - now) / 1000)),
    );
  }

  // 자원이 늘거나 줄면 버튼 활성 상태만 다시 계산
  root.querySelectorAll<HTMLButtonElement>('button[data-cost]').forEach((btn) => {
    if (btn.dataset.blocked === '1') {
      btn.disabled = true;
      return;
    }
    btn.disabled = !canAfford(state.resources, JSON.parse(btn.dataset.cost!));
  });

  const canvas = root.querySelector<HTMLCanvasElement>('#cityview');
  if (canvas) {
    drawCity(canvas, state, selectedBuilding, selectedCell, now);
    // 조명·드래그 미리보기가 부드럽게 따라오도록 프레임 단위로 다시 그린다.
    // 캔버스가 사라지면(탭 이동) 스스로 멈춘다.
    cancelAnimationFrame(cityAnimId);
    const loop = () => {
      if (!canvas.isConnected) return;
      drawCity(canvas, state, selectedBuilding, selectedCell, Date.now());
      cityAnimId = requestAnimationFrame(loop);
    };
    cityAnimId = requestAnimationFrame(loop);
  }

  const worldCanvas = root.querySelector<HTMLCanvasElement>('#worldmap');
  if (worldCanvas) drawWorld(worldCanvas, state, camps, nodes, selectedSiteId, now);
}

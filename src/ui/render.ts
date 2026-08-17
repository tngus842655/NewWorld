import type {
  BuildingDef,
  GameState,
  HeroStats,
  RaceId,
  ResourceKind,
  UnitCount,
  UnitDef,
} from '../core/types';
import { HERO_STAT_LABELS, RACE_LABELS, RESOURCE_LABELS } from '../core/types';
import { BARRACKS_ID, canAfford, type CampDef } from '../core/actions';
import { selectArmyForMarch } from '../core/combat';
import {
  commandLimit,
  critChance,
  FREE_RESTOCK_SECONDS,
  MANUAL_REFRESH_GOLD,
  statTotal,
  TAVERN_ID,
} from '../core/heroes';
import { buildingAt, CITY_SIZE, drawCity, TILE } from './cityview';

export type Tab = 'city' | 'barracks' | 'tavern' | 'battle' | 'codex';

export interface RenderCallbacks {
  onUpgrade(defId: string): void;
  onTrain(unitId: string, count: number): void;
  onSelectRace(raceId: RaceId): void;
  onHire(candidateIndex: number): void;
  onRefreshTavern(): void;
  /** 도시 뷰에서 건물(또는 빈 곳) 선택 — 리렌더 트리거용 */
  onSelectBuilding(defId: string | null): void;
  /** 하단 탭 전환 */
  onSelectTab(tab: Tab): void;
  /** 사냥터 출정 */
  onDispatch(campId: string, heroId: string): void;
  /** 출정 보낼 영웅 선택 */
  onSelectHero(heroId: string): void;
  /** 테스트용: 진행 중인 건설/훈련 큐 즉시 완료 (dev 전용) */
  onInstantFinish(): void;
}

// UI 전용 상태
let selectedBuilding: string | null = null;
let activeTab: Tab = 'city';
let message = '';
let selectedHeroId: string | null = null;
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
  .resources div { text-align: center; font-size: 11px; color: #b5a99f; line-height: 1.35; }
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
    padding: 8px 12px; font-size: 13px; }
  .army b { color: #7fd39a; font-variant-numeric: tabular-nums; }
  .tier { color: #8a7d73; font-size: 11px; }

  canvas { width: 100%; display: block; border-radius: 12px; touch-action: manipulation; }

  /* 하단 탭 */
  .tabs { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4, 1fr);
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

  /* 영웅 선택 칩 */
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .chip { background: #241e1b; border: 1px solid #3a322c; color: #b5a99f;
    min-height: 38px; font-size: 13px; }
  .chip.on { border-color: #a0281c; color: #e0b568; }

  /* 전투 리포트 */
  .report { background: #241e1b; border: 1px solid #3a322c; border-radius: 10px;
    margin-bottom: 8px; overflow: hidden; }
  .report summary { padding: 13px 14px; cursor: pointer; font-size: 14px;
    list-style: none; display: flex; align-items: center; gap: 8px; }
  .report summary::-webkit-details-marker { display: none; }
  .report summary::after { content: '▾'; margin-left: auto; color: #8a7d73; }
  .report[open] summary::after { content: '▴'; }
  .report summary .win { color: #7fd39a; font-weight: 700; }
  .report summary .lose { color: #e08a7e; font-weight: 700; }
  .report-body { padding: 0 14px 12px; border-top: 1px solid #3a322c; }
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

  /* 도감 표 */
  .statwrap { overflow-x: auto; margin-top: 6px; }
  table { border-collapse: collapse; font-size: 12px; width: 100%; }
  th, td { padding: 5px 8px; text-align: right; white-space: nowrap;
    border-bottom: 1px solid #3a322c; font-variant-numeric: tabular-nums; }
  th { color: #8a7d73; font-weight: 600; }
  th:first-child, td:first-child { text-align: left; }
`;

const RACE_FLAVOR: Record<RaceId, string> = {
  human: '빛을 숭배하는 종족. 법과 질서보다 인간적인 도덕성을 중시한다.',
  elf: '자연을 숭배하는 종족. 숲을 사랑하며 자연과의 공존을 우선한다.',
  undead: '죽음을 숭배하는 종족. 죽음은 평온함이며, 질서 없음이 아름다움이다.',
};

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'city', icon: '🏰', label: '도시' },
  { id: 'barracks', icon: '⚔️', label: '병영' },
  { id: 'tavern', icon: '🍺', label: '주점' },
  { id: 'battle', icon: '🗡️', label: '전투' },
  { id: 'codex', icon: '📖', label: '도감' },
];

function ensureStyle(): void {
  if (document.getElementById('newworld-style')) return;
  const style = document.createElement('style');
  style.id = 'newworld-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function costText(cost: Partial<Record<ResourceKind, number>>): string {
  return Object.entries(cost)
    .filter(([, v]) => (v ?? 0) > 0)
    .map(([k, v]) => `${RESOURCE_LABELS[k as ResourceKind]} ${v}`)
    .join(' · ');
}

/**
 * 버튼에 비용을 실어두면 매 틱 자원만 다시 검사해 활성/비활성을 갱신할 수 있다
 * (DOM을 새로 그리지 않고). blocked는 자원과 무관한 차단 사유(큐 사용 중, 잠김 등).
 */
function costAttrs(cost: Partial<Record<ResourceKind, number>>, blocked: boolean): string {
  return `data-cost='${JSON.stringify(cost)}' data-blocked="${blocked ? 1 : 0}"`;
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

function cityTab(state: GameState, buildingDefs: Map<string, BuildingDef>): string {
  let panel = '<div class="card"><small>도시의 건물이나 빈 터를 눌러 관리하세요.</small></div>';
  const sel = selectedBuilding ? state.buildings.find((b) => b.defId === selectedBuilding) : null;
  const def = sel ? buildingDefs.get(sel.defId) : null;
  if (sel && def) {
    const next = def.levels[sel.level];
    let action = '<small>최대 레벨</small>';
    if (next) {
      const blocked = state.upgradeQueue !== null;
      const verb = sel.level === 0 ? '건설' : `Lv.${sel.level + 1}`;
      action = `<button data-upgrade="${def.id}" ${costAttrs(next.upgradeCost, blocked)}>${verb}</button>`;
    }
    const produce =
      def.produces && sel.level >= 1
        ? `<small>생산 ${RESOURCE_LABELS[def.produces]} ${def.levels[sel.level - 1]?.productionPerHour ?? 0}/시간</small>`
        : '';
    const costLine = next
      ? `<small>${costText(next.upgradeCost)} · ${next.upgradeSeconds}초</small>`
      : '';
    panel = `<div class="card">
      <div><b>${def.name}</b> ${sel.level === 0 ? '<span class="tier">공터</span>' : `Lv.${sel.level}`}
        <small>${def.description}</small>${produce}${costLine}
      </div>
      <div class="actions">${action}</div>
    </div>`;
  }
  return `<canvas id="cityview" width="${CITY_SIZE}" height="${CITY_SIZE}"></canvas>
    <h2>건물 관리</h2>${panel}`;
}

function barracksTab(
  state: GameState,
  unitDefs: Map<string, UnitDef>,
): string {
  const entries = Object.entries(state.army).filter(([, n]) => n > 0);
  const army = entries.length
    ? `<div class="army">${entries
        .map(([id, n]) => `<span>${unitDefs.get(id)?.nameKo ?? id} <b>${n}</b></span>`)
        .join('')}</div>`
    : '<div class="card"><small>아직 병력이 없다.</small></div>';

  const level = state.buildings.find((b) => b.defId === BARRACKS_ID)?.level ?? 0;
  let training: string;
  if (level < 1) {
    training = '<div class="card"><small>도시에서 병영을 지으면 유닛을 훈련할 수 있다.</small></div>';
  } else {
    training = [...unitDefs.values()]
      .filter((u) => u.raceId === state.raceId)
      .sort((a, b) => a.tier - b.tier)
      .map((u) => {
        const locked = u.tier > level;
        const cost5 = Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, (v ?? 0) * 5]));
        const blocked = locked || state.trainQueue !== null;
        const info = locked
          ? `🔒 병영 Lv.${u.tier} 필요`
          : `${costText(u.cost)}<br>${u.trainSeconds ?? '?'}초/기 · 식량 ${u.foodUpkeepPerHour ?? 0}/시간`;
        return `<div class="card">
          <div><span class="tier">${u.tier}계</span> <b>${u.nameKo}</b><small>${info}</small></div>
          <div class="actions">
            <button data-train="${u.id}" data-count="1" ${costAttrs(u.cost, blocked)}>×1</button>
            <button data-train="${u.id}" data-count="5" ${costAttrs(cost5, blocked)}>×5</button>
          </div>
        </div>`;
      })
      .join('');
  }
  return `<h2>보유 병력</h2>${army}<h2>훈련 (병영 Lv.${level})</h2>${training}`;
}

function tavernTab(state: GameState, now: number): string {
  const heroes = state.heroes.length
    ? state.heroes
        .map(
          (h) => `<div class="card">
            <div><b>${h.name}</b> Lv.${h.level}
              <small>${statLine(h.stats)}</small>
              <small>지휘 ${commandLimit(h)}명 · 치명타 ${(critChance(h) * 100).toFixed(1)}%</small>
            </div>
          </div>`,
        )
        .join('')
    : '<div class="card"><small>고용한 영웅이 없다.</small></div>';

  const level = state.buildings.find((b) => b.defId === TAVERN_ID)?.level ?? 0;
  if (level < 1) {
    return `<h2>영웅</h2>${heroes}<h2>주점</h2>
      <div class="card"><small>도시에서 주점을 지으면 영웅을 고용할 수 있다.</small></div>`;
  }

  const nextRestock = Math.max(
    0,
    Math.ceil((state.tavern.refreshedAt + FREE_RESTOCK_SECONDS * 1000 - now) / 1000),
  );
  const canHire = state.heroes.length < level;
  const candidates = state.tavern.candidates
    .map((c, i) => {
      return `<div class="card">
        <div><b>${c.name}</b> <span class="tier">속성합 ${statTotal(c.stats)}</span>
          <small>${statLine(c.stats)}</small></div>
        <div class="actions">
          <button data-hire="${i}" ${costAttrs({ gold: c.price }, !canHire)}>금화 ${c.price}</button>
        </div>
      </div>`;
    })
    .join('');

  return `<h2>영웅 (${state.heroes.length}/${level})</h2>${heroes}
    <h2>주점 후보</h2>
    <div class="card">
      <div><small>무료 갱신까지 <span id="tavern-countdown">${nextRestock}</span>초</small></div>
      <div class="actions">
        <button class="small" data-refresh-tavern ${costAttrs({ gold: MANUAL_REFRESH_GOLD }, false)}>
          즉시 갱신 (${MANUAL_REFRESH_GOLD})</button>
      </div>
    </div>
    ${candidates}`;
}

function unitCountText(list: UnitCount[], unitDefs: Map<string, UnitDef>): string {
  if (!list.length) return '없음';
  return list.map((u) => `${unitDefs.get(u.unitId)?.nameKo ?? u.unitId} ${u.count}기`).join(', ');
}

function battleTab(
  state: GameState,
  camps: CampDef[],
  unitDefs: Map<string, UnitDef>,
  now: number,
): string {
  // 출정 중 상태
  if (state.march) {
    const remain = Math.max(0, Math.ceil((state.march.returnsAt - now) / 1000));
    return `<h2>출정 중</h2>
      <div class="card">
        <div><b>${state.march.campName}</b>
          <small>부대가 이동 중입니다. 귀환하면 전투 결과가 표시됩니다.</small>
          <small>귀환까지 <span id="march-countdown">${remain}</span>초</small>
        </div>
      </div>
      ${reportsSection(state, unitDefs, now)}`;
  }

  const hero = state.heroes.find((h) => h.id === selectedHeroId) ?? state.heroes[0];
  if (!hero) {
    return `<h2>출정</h2>
      <div class="card"><small>주점에서 영웅을 고용해야 부대를 이끌 수 있다.</small></div>
      ${reportsSection(state, unitDefs, now)}`;
  }

  const heroPicker =
    state.heroes.length > 1
      ? `<div class="chips">${state.heroes
          .map(
            (h) =>
              `<button class="chip ${h.id === hero.id ? 'on' : ''}" data-hero="${h.id}">${h.name} Lv.${h.level}</button>`,
          )
          .join('')}</div>`
      : '';

  const marchArmy = selectArmyForMarch(state.army, hero, unitDefs);
  const armyText = unitCountText(marchArmy, unitDefs);
  const hasArmy = marchArmy.length > 0;

  const campCards = camps
    .map((c) => {
      const enemies = c.monsters
        .map((m) => `${unitDefs.get(m.unitId)?.nameKo ?? m.unitId} ${m.count}기`)
        .join(', ');
      const lootText = Object.entries(c.loot)
        .map(([k, v]) => `${RESOURCE_LABELS[k as ResourceKind]} ${v}`)
        .join(' · ');
      return `<div class="card">
        <div><b>${c.name}</b>
          <small>${c.description}</small>
          <small>적: ${enemies}</small>
          <small>보상: ${lootText} · 왕복 ${Math.round(c.marchSeconds / 60)}분</small>
        </div>
        <div class="actions">
          <button data-dispatch="${c.id}" ${hasArmy ? '' : 'disabled'}>출정</button>
        </div>
      </div>`;
    })
    .join('');

  return `<h2>부대 편성</h2>
    ${heroPicker}
    <div class="card">
      <div><b>${hero.name}</b> Lv.${hero.level}
        <small>지휘 한도 ${commandLimit(hero)}명 · 치명타 ${(critChance(hero) * 100).toFixed(1)}%</small>
        <small>출정 병력: ${armyText}</small>
      </div>
    </div>
    <h2>사냥터</h2>
    ${campCards}
    ${reportsSection(state, unitDefs, now)}`;
}

function reportsSection(
  state: GameState,
  unitDefs: Map<string, UnitDef>,
  now: number,
): string {
  if (!state.reports.length) return '';
  const cards = state.reports
    .map((r) => {
      const mins = Math.max(0, Math.round((now - r.at) / 60000));
      const when = mins < 1 ? '방금' : mins < 60 ? `${mins}분 전` : `${Math.round(mins / 60)}시간 전`;
      const lootText = Object.entries(r.loot)
        .map(([k, v]) => `${RESOURCE_LABELS[k as ResourceKind]} ${v}`)
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
      return `<details class="report">
        <summary>
          <span class="${r.victory ? 'win' : 'lose'}">${r.victory ? '승리' : '패배'}</span>
          ${r.campName} · ${when}
        </summary>
        <div class="report-body">
          <small>지휘: ${r.heroName} · ${r.rounds}라운드</small>
          <small>적 처치: ${unitCountText(r.defenderLosses, unitDefs)}</small>
          <small>아군 손실: ${unitCountText(r.attackerLosses, unitDefs)}</small>
          <small>생환: ${unitCountText(r.survivors, unitDefs)}</small>
          ${lootText ? `<small>전리품: ${lootText}</small>` : ''}
          <small>경험치 +${r.xpGained}</small>
          <div class="log">${logLines}</div>
        </div>
      </details>`;
    })
    .join('');
  return `<h2>전투 기록</h2>${cards}`;
}

function codexTab(state: GameState, unitDefs: Map<string, UnitDef>): string {
  const groups: { title: string; race: string }[] = [
    { title: `${RACE_LABELS[state.raceId!]} 병종`, race: state.raceId! },
    { title: '중립 몬스터', race: 'neutral' },
    { title: '악마', race: 'devil' },
  ];
  return groups
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
            <td>${u.tier}계 ${u.nameKo}</td>
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
}

// ── 메인 렌더 ────────────────────────────────────────────────

export function render(
  root: HTMLElement,
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  camps: CampDef[],
  now: number,
  cb: RenderCallbacks,
): void {
  ensureStyle();

  if (!state.raceId) {
    renderRaceSelect(root, cb);
    return;
  }

  const resources = (Object.keys(RESOURCE_LABELS) as ResourceKind[])
    .map((k) => `<div>${RESOURCE_LABELS[k]}<b data-res="${k}"></b></div>`)
    .join('');

  const instant = import.meta.env.DEV ? '<button class="small" data-instant>⚡</button>' : '';
  const queues: string[] = [];
  if (state.upgradeQueue) {
    const def = buildingDefs.get(state.upgradeQueue.defId);
    queues.push(`<div class="queue"><span>🔨 ${def?.name ?? '?'} Lv.${state.upgradeQueue.targetLevel}</span>
      <span class="bar"><i id="q-build-bar"></i></span>
      <span id="q-build-remain"></span>${instant}</div>`);
  }
  if (state.trainQueue) {
    const def = unitDefs.get(state.trainQueue.unitId);
    queues.push(`<div class="queue"><span>⚔️ ${def?.nameKo ?? '?'} ×${state.trainQueue.count}</span>
      <span class="bar"><i id="q-train-bar"></i></span>
      <span id="q-train-remain"></span>${instant}</div>`);
  }
  if (state.march) {
    queues.push(`<div class="queue"><span>🗡️ ${state.march.campName} 출정</span>
      <span class="bar"><i id="q-march-bar"></i></span>
      <span id="q-march-remain"></span>${instant}</div>`);
  }

  let body: string;
  if (activeTab === 'city') body = cityTab(state, buildingDefs);
  else if (activeTab === 'barracks') body = barracksTab(state, unitDefs);
  else if (activeTab === 'tavern') body = tavernTab(state, now);
  else if (activeTab === 'battle') body = battleTab(state, camps, unitDefs, now);
  else body = codexTab(state, unitDefs);

  const tabs = TABS.map(
    (t) => `<button data-tab="${t.id}" aria-current="${t.id === activeTab}">
      <i>${t.icon}</i>${t.label}</button>`,
  ).join('');

  // 구조가 바뀌었을 때만 DOM을 새로 만든다. 매초 innerHTML을 갈아치우면
  // 모바일에서 탭이 씹히고 스크롤이 끊긴다.
  const key = JSON.stringify([
    activeTab,
    selectedBuilding,
    message,
    state.raceId,
    state.buildings.map((b) => `${b.defId}:${b.level}`),
    Object.entries(state.army).filter(([, n]) => n > 0),
    state.heroes.map((h) => h.id),
    state.tavern.candidates.map((c) => `${c.name}:${c.price}`),
    state.upgradeQueue && `${state.upgradeQueue.defId}:${state.upgradeQueue.targetLevel}`,
    state.trainQueue && `${state.trainQueue.unitId}:${state.trainQueue.count}`,
    state.march?.campId ?? '',
    state.reports.map((r) => r.id),
    selectedHeroId,
    state.heroes.map((h) => `${h.id}:${h.level}`),
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

    const content = root.querySelector('.content');
    if (content) content.scrollTop = prevScroll;

    const canvas = root.querySelector<HTMLCanvasElement>('#cityview');
    canvas?.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) * canvas.width) / rect.width;
      const y = ((e.clientY - rect.top) * canvas.height) / rect.height;
      selectedBuilding = buildingAt(Math.floor(x / TILE), Math.floor(y / TILE));
      cb.onSelectBuilding(selectedBuilding);
    });

    root.querySelectorAll<HTMLButtonElement>('button[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onSelectTab(btn.dataset.tab as Tab));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-upgrade]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onUpgrade(btn.dataset.upgrade!));
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
      btn.addEventListener('click', () => cb.onDispatch(btn.dataset.dispatch!, hero?.id ?? ''));
    });
    root.querySelectorAll<HTMLButtonElement>('button[data-hero]').forEach((btn) => {
      btn.addEventListener('click', () => cb.onSelectHero(btn.dataset.hero!));
    });
  }

  updateDynamic(root, state, buildingDefs, unitDefs, camps, now);
}

/** 매 틱 갱신: 숫자·타이머·캔버스·버튼 활성 상태만 손댄다 (DOM 구조는 그대로) */
function updateDynamic(
  root: HTMLElement,
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  camps: CampDef[],
  now: number,
): void {
  root.querySelectorAll<HTMLElement>('b[data-res]').forEach((el) => {
    el.textContent = Math.floor(state.resources[el.dataset.res as ResourceKind]).toLocaleString();
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
  if (state.upgradeQueue) {
    const def = buildingDefs.get(state.upgradeQueue.defId);
    const secs = def?.levels[state.upgradeQueue.targetLevel - 1]?.upgradeSeconds ?? 0;
    setQueue('build', state.upgradeQueue.finishesAt, secs);
  }
  if (state.trainQueue) {
    const def = unitDefs.get(state.trainQueue.unitId);
    setQueue('train', state.trainQueue.finishesAt, (def?.trainSeconds ?? 0) * state.trainQueue.count);
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
  if (canvas) drawCity(canvas, state, buildingDefs, selectedBuilding, now);
}

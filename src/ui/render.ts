import type { BuildingDef, GameState, HeroStats, RaceId, ResourceKind, UnitDef } from '../core/types';
import { HERO_STAT_LABELS, RACE_LABELS, RESOURCE_LABELS } from '../core/types';
import { BARRACKS_ID, canAfford } from '../core/actions';
import {
  commandLimit,
  critChance,
  FREE_RESTOCK_SECONDS,
  MANUAL_REFRESH_GOLD,
  statTotal,
  TAVERN_ID,
} from '../core/heroes';

export interface RenderCallbacks {
  onUpgrade(defId: string): void;
  onTrain(unitId: string, count: number): void;
  onSelectRace(raceId: RaceId): void;
  onHire(candidateIndex: number): void;
  onRefreshTavern(): void;
}

const STYLE = `
  body { font-family: 'Malgun Gothic', sans-serif; background: #1b1614; color: #ece5df; margin: 0; }
  #app { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 20px; }
  h2 { font-size: 16px; margin: 28px 0 8px; color: #e0b568; }
  .resources { display: flex; gap: 16px; flex-wrap: wrap; background: #2c2521; border-radius: 8px; padding: 12px 16px; position: sticky; top: 0; }
  .resources span b { color: #e0b568; font-variant-numeric: tabular-nums; }
  .card { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    border: 1px solid #3a322c; border-radius: 8px; padding: 12px 16px; margin-top: 10px; }
  .card small { color: #b5a99f; display: block; }
  .card .actions { display: flex; gap: 6px; flex-shrink: 0; }
  button { background: #a0281c; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; }
  button:disabled { background: #3a322c; color: #8a7d73; cursor: default; }
  button:focus-visible { outline: 2px solid #e0b568; outline-offset: 2px; }
  .queue { margin-top: 8px; color: #7db4e0; }
  .msg { margin-top: 10px; color: #e08a7e; min-height: 1.2em; }
  .army { display: flex; gap: 14px; flex-wrap: wrap; background: #241e1b; border: 1px solid #3a322c; border-radius: 8px; padding: 10px 14px; }
  .army span b { color: #7fd39a; font-variant-numeric: tabular-nums; }
  .tier { color: #8a7d73; font-size: 12px; margin-right: 6px; }
  .race-select { text-align: center; padding: 40px 0; }
  .race-select .races { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
  .race-card { background: #241e1b; border: 1px solid #3a322c; border-radius: 10px; padding: 24px 20px; width: 180px; cursor: pointer; color: inherit; }
  .race-card:hover { border-color: #a0281c; }
  .race-card b { font-size: 17px; display: block; margin-bottom: 8px; }
  .race-card small { color: #b5a99f; }
`;

// 종족 소개 문구는 한국 서비스 공식 종족소개 요약 (자료집 참고)
const RACE_FLAVOR: Record<RaceId, string> = {
  human: '빛을 숭배하는 종족. 법과 질서보다 인간적인 도덕성을 중시한다.',
  elf: '자연을 숭배하는 종족. 숲을 사랑하며 자연과의 공존을 우선한다.',
  undead: '죽음을 숭배하는 종족. 죽음은 평온함이며, 질서 없음이 아름다움이다.',
};

let message = '';
export function setMessage(text: string): void {
  message = text;
}

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
    .join(', ');
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
    <h1>NewWorld</h1>
    <p>영지를 다스릴 종족을 선택하세요.</p>
    <div class="races">${cards}</div>
  </div>`;
  root.querySelectorAll<HTMLButtonElement>('button[data-race]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onSelectRace(btn.dataset.race as RaceId));
  });
}

export function render(
  root: HTMLElement,
  state: GameState,
  buildingDefs: Map<string, BuildingDef>,
  unitDefs: Map<string, UnitDef>,
  now: number,
  cb: RenderCallbacks,
): void {
  ensureStyle();

  if (!state.raceId) {
    renderRaceSelect(root, cb);
    return;
  }

  const resources = (Object.keys(RESOURCE_LABELS) as ResourceKind[])
    .map((k) => `<span>${RESOURCE_LABELS[k]} <b>${Math.floor(state.resources[k])}</b></span>`)
    .join('');

  // ── 건물 ──
  const buildings = state.buildings
    .map((b) => {
      const def = buildingDefs.get(b.defId);
      if (!def) return '';
      const nextLevel = def.levels[b.level];
      let action = '<small>최대 레벨</small>';
      if (nextLevel) {
        const disabled =
          state.upgradeQueue !== null || !canAfford(state.resources, nextLevel.upgradeCost);
        action = `<button data-upgrade="${def.id}" ${disabled ? 'disabled' : ''}>
          Lv.${b.level + 1} (${costText(nextLevel.upgradeCost)})</button>`;
      }
      return `<div class="card">
        <div><b>${def.name}</b> Lv.${b.level}<small>${def.description}</small></div>
        <div class="actions">${action}</div>
      </div>`;
    })
    .join('');

  let buildQueue = '';
  if (state.upgradeQueue) {
    const def = buildingDefs.get(state.upgradeQueue.defId);
    const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
    buildQueue = `<div class="queue">🔨 ${def?.name ?? '?'} → Lv.${state.upgradeQueue.targetLevel} (${remain}초 남음)</div>`;
  }

  // ── 병력 ──
  const armyEntries = Object.entries(state.army).filter(([, n]) => n > 0);
  const army = armyEntries.length
    ? armyEntries
        .map(([id, n]) => {
          const def = unitDefs.get(id);
          return `<span>${def?.nameKo ?? id} <b>${n}</b></span>`;
        })
        .join('')
    : '<small>아직 병력이 없다.</small>';

  // ── 영웅 / 주점 ──
  const statLine = (s: HeroStats) =>
    (Object.keys(HERO_STAT_LABELS) as (keyof HeroStats)[])
      .map((k) => `${HERO_STAT_LABELS[k]} ${s[k]}`)
      .join(' · ');

  const heroList = state.heroes.length
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

  const tavernLevel = state.buildings.find((b) => b.defId === TAVERN_ID)?.level ?? 0;
  let tavernHtml: string;
  if (tavernLevel < 1) {
    tavernHtml = '<div class="card"><small>주점을 지으면 영웅을 고용할 수 있다.</small></div>';
  } else {
    const nextRestock = Math.max(
      0,
      Math.ceil((state.tavern.refreshedAt + FREE_RESTOCK_SECONDS * 1000 - now) / 1000),
    );
    const canHireMore = state.heroes.length < tavernLevel;
    const candidates = state.tavern.candidates
      .map((c, i) => {
        const affordable = canHireMore && state.resources.gold >= c.price;
        return `<div class="card">
          <div><b>${c.name}</b> <span class="tier">속성합 ${statTotal(c.stats)}</span>
            <small>${statLine(c.stats)}</small>
          </div>
          <div class="actions">
            <button data-hire="${i}" ${affordable ? '' : 'disabled'}>고용 (금화 ${c.price})</button>
          </div>
        </div>`;
      })
      .join('');
    tavernHtml = `
      <div class="card">
        <div><small>보유 ${state.heroes.length}/${tavernLevel}명 · 무료 갱신까지 ${nextRestock}초</small></div>
        <div class="actions">
          <button data-refresh-tavern ${state.resources.gold >= MANUAL_REFRESH_GOLD ? '' : 'disabled'}>
            즉시 갱신 (금화 ${MANUAL_REFRESH_GOLD})</button>
        </div>
      </div>
      ${candidates}`;
  }

  // ── 병영 / 훈련 ──
  const barracksLevel = state.buildings.find((b) => b.defId === BARRACKS_ID)?.level ?? 0;
  const raceUnits = [...unitDefs.values()]
    .filter((u) => u.raceId === state.raceId)
    .sort((a, b) => a.tier - b.tier);

  let training: string;
  if (barracksLevel < 1) {
    training = '<div class="card"><small>병영을 지으면 유닛을 훈련할 수 있다.</small></div>';
  } else {
    training = raceUnits
      .map((u) => {
        const locked = u.tier > barracksLevel;
        const one = !locked && !state.trainQueue && canAfford(state.resources, u.cost);
        const fiveCost = Object.fromEntries(
          Object.entries(u.cost).map(([k, v]) => [k, (v ?? 0) * 5]),
        );
        const five = !locked && !state.trainQueue && canAfford(state.resources, fiveCost);
        const info = locked
          ? `병영 Lv.${u.tier} 필요`
          : `${costText(u.cost)} · ${u.trainSeconds ?? '?'}초/기`;
        return `<div class="card">
          <div><span class="tier">${u.tier}계</span><b>${u.nameKo}</b><small>${info}</small></div>
          <div class="actions">
            <button data-train="${u.id}" data-count="1" ${one ? '' : 'disabled'}>×1</button>
            <button data-train="${u.id}" data-count="5" ${five ? '' : 'disabled'}>×5</button>
          </div>
        </div>`;
      })
      .join('');
  }

  let trainQueue = '';
  if (state.trainQueue) {
    const def = unitDefs.get(state.trainQueue.unitId);
    const remain = Math.max(0, Math.ceil((state.trainQueue.finishesAt - now) / 1000));
    trainQueue = `<div class="queue">⚔️ ${def?.nameKo ?? '?'} ×${state.trainQueue.count} 훈련 중 (${remain}초 남음)</div>`;
  }

  root.innerHTML = `
    <h1>NewWorld — ${RACE_LABELS[state.raceId]} 영지</h1>
    <div class="resources">${resources}</div>
    ${buildQueue}${trainQueue}
    <div class="msg">${message}</div>
    <h2>병력</h2>
    <div class="army">${army}</div>
    <h2>영웅</h2>
    ${heroList}
    <h2>주점 (Lv.${tavernLevel})</h2>
    ${tavernHtml}
    <h2>건물</h2>
    ${buildings}
    <h2>훈련 (병영 Lv.${barracksLevel})</h2>
    ${training}
  `;

  root.querySelectorAll<HTMLButtonElement>('button[data-upgrade]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onUpgrade(btn.dataset.upgrade!));
  });
  root.querySelectorAll<HTMLButtonElement>('button[data-train]').forEach((btn) => {
    btn.addEventListener('click', () =>
      cb.onTrain(btn.dataset.train!, Number(btn.dataset.count)),
    );
  });
  root.querySelectorAll<HTMLButtonElement>('button[data-hire]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onHire(Number(btn.dataset.hire)));
  });
  root
    .querySelector<HTMLButtonElement>('button[data-refresh-tavern]')
    ?.addEventListener('click', () => cb.onRefreshTavern());
}

import type { BuildingDef, GameState, ResourceKind } from '../core/types';
import { RESOURCE_LABELS } from '../core/types';
import { canAfford } from '../core/actions';

export interface RenderCallbacks {
  onUpgrade(defId: string): void;
}

const STYLE = `
  body { font-family: 'Malgun Gothic', sans-serif; background: #1b1614; color: #ece5df; margin: 0; }
  #app { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 20px; }
  .resources { display: flex; gap: 16px; flex-wrap: wrap; background: #2c2521; border-radius: 8px; padding: 12px 16px; }
  .resources span b { color: #e0b568; font-variant-numeric: tabular-nums; }
  .building { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    border: 1px solid #3a322c; border-radius: 8px; padding: 12px 16px; margin-top: 10px; }
  .building small { color: #b5a99f; display: block; }
  button { background: #a0281c; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; }
  button:disabled { background: #3a322c; color: #8a7d73; cursor: default; }
  .queue { margin-top: 14px; color: #7db4e0; }
  .msg { margin-top: 10px; color: #e08a7e; min-height: 1.2em; }
`;

let message = '';
export function setMessage(text: string): void {
  message = text;
}

export function render(
  root: HTMLElement,
  state: GameState,
  defs: Map<string, BuildingDef>,
  now: number,
  cb: RenderCallbacks,
): void {
  if (!document.getElementById('newworld-style')) {
    const style = document.createElement('style');
    style.id = 'newworld-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const resources = (Object.keys(RESOURCE_LABELS) as ResourceKind[])
    .map((k) => `<span>${RESOURCE_LABELS[k]} <b>${Math.floor(state.resources[k])}</b></span>`)
    .join('');

  const buildings = state.buildings
    .map((b) => {
      const def = defs.get(b.defId);
      if (!def) return '';
      const nextLevel = def.levels[b.level];
      const upgrading = state.upgradeQueue?.defId === b.defId;
      let action = '<small>최대 레벨</small>';
      if (nextLevel) {
        const cost = Object.entries(nextLevel.upgradeCost)
          .map(([k, v]) => `${RESOURCE_LABELS[k as ResourceKind]} ${v}`)
          .join(', ');
        const disabled =
          upgrading || state.upgradeQueue !== null || !canAfford(state.resources, nextLevel.upgradeCost);
        action = `<button data-upgrade="${def.id}" ${disabled ? 'disabled' : ''}>
          Lv.${b.level + 1} (${cost})</button>`;
      }
      return `<div class="building">
        <div><b>${def.name}</b> Lv.${b.level}<small>${def.description}</small></div>
        <div>${action}</div>
      </div>`;
    })
    .join('');

  let queue = '';
  if (state.upgradeQueue) {
    const def = defs.get(state.upgradeQueue.defId);
    const remain = Math.max(0, Math.ceil((state.upgradeQueue.finishesAt - now) / 1000));
    queue = `<div class="queue">🔨 ${def?.name ?? '?'} → Lv.${state.upgradeQueue.targetLevel} (${remain}초 남음)</div>`;
  }

  root.innerHTML = `
    <h1>NewWorld — 도시 프로토타입</h1>
    <div class="resources">${resources}</div>
    ${queue}
    <div class="msg">${message}</div>
    ${buildings}
  `;

  root.querySelectorAll<HTMLButtonElement>('button[data-upgrade]').forEach((btn) => {
    btn.addEventListener('click', () => cb.onUpgrade(btn.dataset.upgrade!));
  });
}

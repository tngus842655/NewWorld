import buildingData from '../data/buildings/base.json';
import type { BuildingDef, GameState } from './core/types';
import { advance } from './core/tick';
import { startUpgrade } from './core/actions';
import { createStorage } from './db/storage';
import { render, setMessage } from './ui/render';

const defs = new Map<string, BuildingDef>(
  (buildingData.buildings as BuildingDef[]).map((d) => [d.id, d]),
);

function newGame(now: number): GameState {
  return {
    updatedAt: now,
    resources: { wood: 200, stone: 200, food: 200, crystal: 0, gold: 150 },
    buildings: [...defs.keys()].map((defId) => ({ defId, level: 0 })),
    upgradeQueue: null,
  };
}

async function main(): Promise<void> {
  const root = document.getElementById('app')!;
  const storage = await createStorage();

  let state = (await storage.load()) ?? newGame(Date.now());

  let dirty = false;
  const callbacks = {
    onUpgrade(defId: string) {
      const def = defs.get(defId);
      if (!def) return;
      const now = Date.now();
      state = advance(state, defs, now);
      const result = startUpgrade(state, def, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      render(root, state, defs, now, callbacks);
    },
  };

  // 1초 틱: 진행 반영 + 렌더. 저장은 변경이 있거나 30초마다.
  let lastSave = Date.now();
  setInterval(() => {
    const now = Date.now();
    const prevQueue = state.upgradeQueue;
    state = advance(state, defs, now);
    if (prevQueue && !state.upgradeQueue) dirty = true; // 건설 완료됨
    render(root, state, defs, now, callbacks);
    if (dirty || now - lastSave > 30_000) {
      void storage.save(state);
      dirty = false;
      lastSave = now;
    }
  }, 1000);

  render(root, state, defs, Date.now(), callbacks);
}

void main();

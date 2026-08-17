import buildingData from '../data/buildings/base.json';
import humanUnits from '../data/units/human.json';
import elfUnits from '../data/units/elf.json';
import undeadUnits from '../data/units/undead.json';
import devilUnits from '../data/units/devil.json';
import neutralUnits from '../data/units/neutral.json';
import type { BuildingDef, GameState, RaceId, UnitDef } from './core/types';
import campData from '../data/combat/camps.json';
import { advance } from './core/tick';
import {
  dispatchMarch,
  hireHero,
  refreshTavern,
  startTraining,
  startUpgrade,
  type CampDef,
} from './core/actions';
import { maybeRestockTavern, TAVERN_ID } from './core/heroes';
import { simulateBattle } from './core/combat';
import { createStorage } from './db/storage';
import { render, setMessage, setSelectedHero, setTab, type Tab } from './ui/render';

const camps = campData.camps as CampDef[];

const buildingDefs = new Map<string, BuildingDef>(
  (buildingData.buildings as BuildingDef[]).map((d) => [d.id, d]),
);

// 악마·중립은 훈련 대상이 아니지만 도감·전투(M3)에 필요해 함께 싣는다.
// 훈련 목록은 raceId로 걸러지므로 섞이지 않는다.
const unitDefs = new Map<string, UnitDef>(
  [humanUnits, elfUnits, undeadUnits, devilUnits, neutralUnits]
    .flatMap((r) => r.units as unknown as UnitDef[])
    .map((u) => [u.id, u]),
);

const STATE_VERSION = 2;

function newGame(now: number): GameState {
  return {
    stateVersion: STATE_VERSION,
    updatedAt: now,
    raceId: null,
    // 시작 자원은 추정치. 수정 50은 1계 유닛(수정 10/기) 초반 훈련용
    resources: { wood: 200, stone: 200, food: 200, crystal: 50, gold: 150 },
    buildings: [...buildingDefs.keys()].map((defId) => ({ defId, level: 0 })),
    army: {},
    heroes: [],
    tavern: { candidates: [], refreshedAt: 0 },
    upgradeQueue: null,
    trainQueue: null,
    march: null,
    reports: [],
  };
}

/** 이전 버전 저장 데이터에 새 필드를 채워 넣는다 */
function migrate(state: GameState): GameState {
  state.raceId ??= null;
  state.army ??= {};
  state.heroes ??= [];
  state.tavern ??= { candidates: [], refreshedAt: 0 };
  state.trainQueue ??= null;
  state.march ??= null;
  state.reports ??= [];
  // v2: 시작 자원에 수정 50이 추가되기 전에 만들어진 저장분 보정
  if ((state.stateVersion ?? 1) < 2) {
    state.resources.crystal = Math.max(state.resources.crystal, 50);
    state.stateVersion = 2;
  }
  // 이후 추가된 건물(병영 등)을 기존 도시에 등록
  for (const defId of buildingDefs.keys()) {
    if (!state.buildings.some((b) => b.defId === defId)) {
      state.buildings.push({ defId, level: 0 });
    }
  }
  return state;
}

async function main(): Promise<void> {
  const root = document.getElementById('app')!;
  const storage = await createStorage();

  let state = migrate((await storage.load()) ?? newGame(Date.now()));

  let dirty = false;
  const rerender = (now: number) =>
    render(root, state, buildingDefs, unitDefs, camps, now, callbacks);

  const callbacks = {
    onSelectRace(raceId: RaceId) {
      state.raceId = raceId;
      dirty = true;
      rerender(Date.now());
    },
    onUpgrade(defId: string) {
      const def = buildingDefs.get(defId);
      if (!def) return;
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, now);
      const result = startUpgrade(state, def, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onTrain(unitId: string, count: number) {
      const def = unitDefs.get(unitId);
      if (!def) return;
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, now);
      const result = startTraining(state, def, count, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onHire(candidateIndex: number) {
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, now);
      const result = hireHero(state, candidateIndex);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onRefreshTavern() {
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, now);
      const result = refreshTavern(state, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onSelectBuilding() {
      rerender(Date.now());
    },
    onSelectTab(tab: Tab) {
      setTab(tab);
      setMessage('');
      rerender(Date.now());
    },
    onSelectHero(heroId: string) {
      setSelectedHero(heroId);
      rerender(Date.now());
    },
    onDispatch(campId: string, heroId: string) {
      const camp = camps.find((c) => c.id === campId);
      if (!camp) return;
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, now);
      const result = dispatchMarch(state, camp, heroId, unitDefs, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onInstantFinish() {
      // 테스트 전용: 큐 완료 시각을 현재로 당기고 advance로 정산
      const now = Date.now();
      if (state.upgradeQueue) state.upgradeQueue.finishesAt = now;
      if (state.trainQueue) state.trainQueue.finishesAt = now;
      if (state.march) state.march.returnsAt = now;
      state = advance(state, buildingDefs, unitDefs, now);
      dirty = true;
      rerender(now);
    },
  };

  // 1초 틱: 진행 반영 + 렌더. 저장은 변경이 있거나 30초마다.
  let lastSave = Date.now();
  setInterval(() => {
    const now = Date.now();
    const had = {
      build: !!state.upgradeQueue,
      train: !!state.trainQueue,
      march: !!state.march,
    };
    state = advance(state, buildingDefs, unitDefs, now);
    if (
      (had.build && !state.upgradeQueue) ||
      (had.train && !state.trainQueue) ||
      (had.march && !state.march)
    ) {
      dirty = true; // 큐 완료됨
    }
    const tavernLevel = state.buildings.find((b) => b.defId === TAVERN_ID)?.level ?? 0;
    if (maybeRestockTavern(state, tavernLevel, now)) dirty = true;
    rerender(now);
    if (dirty || now - lastSave > 30_000) {
      void storage.save(state);
      dirty = false;
      lastSave = now;
    }
  }, 1000);

  // 개발용 콘솔 핸들: window.nw 로 상태·데이터·전투 시뮬레이터에 접근
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).nw = {
      get state() {
        return state;
      },
      camps,
      unitDefs,
      buildingDefs,
      simulateBattle,
      save: () => storage.save(state),
      rerender: () => rerender(Date.now()),
    };
  }

  rerender(Date.now());
}

void main();

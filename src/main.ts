import buildingData from '../data/buildings/base.json';
import coalitionUnits from '../data/units/coalition.json';
import clusterUnits from '../data/units/cluster.json';
import swarmUnits from '../data/units/swarm.json';
import invaderUnits from '../data/units/invader.json';
import wildUnits from '../data/units/wild.json';
import type { BuildingDef, EquipSlot, GameState, RaceId, UnitDef, UpgradeJob } from './core/types';
import { MAX_BUILD_SLOTS } from './core/types';
import campData from '../data/combat/camps.json';
import nodeData from '../data/world/nodes.json';
import { advance } from './core/tick';
import {
  abandonNode,
  clearReports,
  constructBuilding,
  deleteReport,
  discardItem,
  dispatchMarch,
  equipItem,
  markReportRead,
  hireHero,
  moveBuilding,
  refreshTavern,
  startResearch,
  startTraining,
  startUpgrade,
  unequipItem,
} from './core/actions';
import { DEFAULT_SLOTS, repairLayout } from './core/city';
import { maybeRestockTavern, TAVERN_ID } from './core/heroes';
import { simulateBattle } from './core/combat';
import { createStorage, StaleStateError } from './db/storage';
import { render, setMessage, setSelectedHero, setTab, type Tab } from './ui/render';
import type { CampDef, NodeDef } from './core/types';

const camps = campData.camps as unknown as CampDef[];
const nodes = nodeData.nodes as unknown as NodeDef[];
const MAX_HELD_NODES: number = nodeData.maxHeld;
const nodeDefs = new Map<string, NodeDef>(nodes.map((n) => [n.id, n]));

const buildingDefs = new Map<string, BuildingDef>(
  (buildingData.buildings as BuildingDef[]).map((d) => [d.id, d]),
);

// 침략군·야생종은 생산 대상이 아니지만 도감·전투에 필요해 함께 싣는다.
// 생산 목록은 raceId로 걸러지므로 섞이지 않는다.
const unitDefs = new Map<string, UnitDef>(
  [coalitionUnits, clusterUnits, swarmUnits, invaderUnits, wildUnits]
    .flatMap((r) => r.units as unknown as UnitDef[])
    .map((u) => [u.id, u]),
);

const STATE_VERSION = 5;

/** 판타지 → SF 컨셉 전환 시 옛 식별자를 새 것으로 옮긴다 */
const RACE_MIGRATION: Record<string, RaceId> = {
  human: 'coalition',
  elf: 'cluster',
  undead: 'swarm',
};
const UNIT_PREFIX_MIGRATION: Record<string, string> = {
  human: 'coalition',
  elf: 'cluster',
  undead: 'swarm',
  neutral: 'wild',
  devil: 'invader',
};

function migrateUnitId(id: string): string {
  const idx = id.lastIndexOf('-t');
  if (idx < 0) return id;
  const race = id.slice(0, idx);
  const next = UNIT_PREFIX_MIGRATION[race];
  return next ? `${next}${id.slice(idx)}` : id;
}

function migrateUnitMap(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) out[migrateUnitId(k)] = v;
  return out;
}

function newGame(now: number): GameState {
  return {
    stateVersion: STATE_VERSION,
    updatedAt: now,
    raceId: null,
    // 시작 자원은 추정치. 수정 50은 1계 유닛(수정 10/기) 초반 훈련용
    resources: { wood: 200, stone: 200, food: 200, crystal: 50, gold: 150 },
    buildings: [...buildingDefs.keys()].map((defId) => ({ defId, level: 0 })),
    army: {},
    unitLevels: {},
    researchQueue: null,
    heroes: [],
    tavern: { candidates: [], refreshedAt: 0 },
    upgradeQueue: [],
    buildSlots: 1,
    trainQueue: null,
    march: null,
    reports: [],
    heldNodes: [],
    inventory: [],
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
  state.heldNodes ??= [];
  state.unitLevels ??= {};
  state.researchQueue ??= null;
  state.inventory ??= [];
  for (const h of state.heroes) h.equipment ??= {};
  // M4 이전 출정 데이터에는 kind가 없다
  if (state.march) state.march.kind ??= 'hunt';
  // v2: 시작 자원에 가스 50이 추가되기 전에 만들어진 저장분 보정
  if ((state.stateVersion ?? 1) < 2) {
    state.resources.crystal = Math.max(state.resources.crystal, 50);
    state.stateVersion = 2;
  }
  // v3: 판타지 → SF 컨셉 전환. 종족·유닛 식별자를 새 체계로 옮긴다
  if ((state.stateVersion ?? 1) < 3) {
    if (state.raceId && RACE_MIGRATION[state.raceId]) {
      state.raceId = RACE_MIGRATION[state.raceId];
    }
    state.army = migrateUnitMap(state.army);
    state.unitLevels = migrateUnitMap(state.unitLevels);
    if (state.trainQueue) state.trainQueue.unitId = migrateUnitId(state.trainQueue.unitId);
    if (state.researchQueue) {
      state.researchQueue.unitId = migrateUnitId(state.researchQueue.unitId);
    }
    // 진행 중이던 출정은 옛 유닛 정보를 담고 있어 취소한다
    state.march = null;
    state.stateVersion = 3;
  }
  // 이후 추가된 건물(병영 등)을 기존 도시에 등록
  for (const defId of buildingDefs.keys()) {
    if (!state.buildings.some((b) => b.defId === defId)) {
      state.buildings.push({ defId, level: 0 });
    }
  }
  // v4: 건물 배치가 코드 상수에서 저장 상태로 옮겨왔다(드래그 이동).
  // 이미 지은 건물은 예전 화면과 같은 자리에 그대로 두고,
  // 짓지 않은 건물은 좌표 없이 둬서 건설 목록으로 돌린다.
  if ((state.stateVersion ?? 1) < 4) {
    // 이 시점의 저장분은 아직 큐가 1칸짜리 객체다 (배열 전환은 v5)
    const queued = (state.upgradeQueue as unknown as UpgradeJob | null)?.defId;
    for (const b of state.buildings) {
      const slot = DEFAULT_SLOTS[b.defId];
      if (!slot) continue;
      if (b.level >= 1 || queued === b.defId) {
        b.col = slot.c;
        b.row = slot.r;
      }
    }
    state.stateVersion = 4;
  }
  // v5: 건설 큐가 1칸 고정에서 슬롯 배열로 바뀌었다
  if ((state.stateVersion ?? 1) < 5) {
    const old = state.upgradeQueue as unknown as UpgradeJob | UpgradeJob[] | null;
    state.upgradeQueue = old === null ? [] : Array.isArray(old) ? old : [old];
    state.stateVersion = 5;
  }
  state.upgradeQueue ??= [];
  state.buildSlots = Math.min(MAX_BUILD_SLOTS, Math.max(1, Math.floor(state.buildSlots ?? 1)));
  // 슬롯이 줄어든 저장분: 넘치는 작업은 잘라 낸다 (자원은 이미 냈으므로 앞쪽을 남긴다)
  state.upgradeQueue.length = Math.min(state.upgradeQueue.length, state.buildSlots);
  // 성벽·성문은 부지를 쓰지 않는다 — 방벽 시절 좌표가 남아 있으면 여기서 떨어진다
  repairLayout(state, buildingDefs);
  return state;
}

async function main(): Promise<void> {
  const root = document.getElementById('app')!;
  const storage = await createStorage();

  let state = migrate((await storage.load()) ?? newGame(Date.now()));

  let dirty = false;
  const rerender = (now: number) =>
    render(root, state, buildingDefs, unitDefs, camps, nodes, MAX_HELD_NODES, now, callbacks);

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
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      const result = startUpgrade(state, def, buildingDefs, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onPlaceBuilding(defId: string, c: number, r: number) {
      const def = buildingDefs.get(defId);
      if (!def) return;
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      const result = constructBuilding(state, def, buildingDefs, c, r, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onMoveBuilding(defId: string, c: number, r: number) {
      const result = moveBuilding(state, defId, c, r);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(Date.now());
    },
    onTrain(unitId: string, count: number) {
      const def = unitDefs.get(unitId);
      if (!def) return;
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      const result = startTraining(state, def, count, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onResearch(unitId: string) {
      const def = unitDefs.get(unitId);
      if (!def) return;
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      const result = startResearch(state, def, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onHire(candidateIndex: number) {
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      const result = hireHero(state, candidateIndex);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onRefreshTavern() {
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
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
    onDispatch(targetId: string, kind: 'hunt' | 'capture', heroId: string) {
      const target =
        kind === 'hunt'
          ? camps.find((c) => c.id === targetId)
          : nodes.find((n) => n.id === targetId);
      if (!target) return;
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      const result = dispatchMarch(state, target, kind, heroId, unitDefs, MAX_HELD_NODES, now);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onSelectSite() {
      rerender(Date.now());
    },
    onEquip(itemId: string) {
      // 착용 가능한 영웅 중 첫 번째에게 (여러 명이면 레벨 요건을 만족하는 영웅)
      const item = state.inventory.find((i) => i.id === itemId);
      const hero = state.heroes.find((h) => h.level >= (item?.heroLevel ?? 1));
      if (!item || !hero) return;
      const result = equipItem(state, hero.id, itemId);
      setMessage(result.ok ? `${hero.name}에게 ${item.nameKo} 착용` : result.reason);
      dirty = true;
      rerender(Date.now());
    },
    onUnequip(heroId: string, slot: EquipSlot) {
      const result = unequipItem(state, heroId, slot);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(Date.now());
    },
    onDiscard(itemId: string) {
      const result = discardItem(state, itemId);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(Date.now());
    },
    onDeleteReport(reportId: string) {
      deleteReport(state, reportId);
      dirty = true;
      rerender(Date.now());
    },
    onClearReports() {
      clearReports(state);
      dirty = true;
      rerender(Date.now());
    },
    onOpenReport(reportId: string) {
      markReportRead(state, reportId);
      dirty = true;
      rerender(Date.now());
    },
    onAbandon(nodeId: string) {
      const now = Date.now();
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      const result = abandonNode(state, nodeId);
      setMessage(result.ok ? '' : result.reason);
      dirty = true;
      rerender(now);
    },
    onInstantFinish() {
      // 테스트 전용: 큐 완료 시각을 현재로 당기고 advance로 정산
      const now = Date.now();
      for (const job of state.upgradeQueue) job.finishesAt = now;
      if (state.trainQueue) state.trainQueue.finishesAt = now;
      if (state.researchQueue) state.researchQueue.finishesAt = now;
      if (state.march) state.march.returnsAt = now;
      state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
      dirty = true;
      rerender(now);
    },
  };

  /**
   * 저장. 다른 세션(다른 탭·수동 SQL)이 더 최신 상태를 썼으면 덮어쓰지 않고
   * 그쪽 상태를 받아온다. 예전에는 오래된 탭이 최신 진행을 통째로 날렸다.
   */
  let saving = false;
  async function persist(): Promise<void> {
    if (saving) return;
    saving = true;
    try {
      await storage.save(state);
    } catch (e) {
      if (e instanceof StaleStateError) {
        const fresh = await storage.load();
        if (fresh) {
          state = migrate(fresh);
          setMessage('다른 창에서 저장된 최신 상태를 불러왔습니다.');
          rerender(Date.now());
        }
      } else {
        console.error(e);
      }
    } finally {
      saving = false;
    }
  }

  // 1초 틱: 진행 반영 + 렌더. 저장은 변경이 있거나 30초마다.
  let lastSave = Date.now();
  setInterval(() => {
    const now = Date.now();
    const had = {
      build: state.upgradeQueue.length,
      train: !!state.trainQueue,
      research: !!state.researchQueue,
      march: !!state.march,
    };
    state = advance(state, buildingDefs, unitDefs, nodeDefs, now);
    if (
      had.build > state.upgradeQueue.length ||
      (had.train && !state.trainQueue) ||
      (had.research && !state.researchQueue) ||
      (had.march && !state.march)
    ) {
      dirty = true; // 큐 완료됨
    }
    const tavernLevel = state.buildings.find((b) => b.defId === TAVERN_ID)?.level ?? 0;
    if (maybeRestockTavern(state, tavernLevel, now)) dirty = true;
    rerender(now);
    if (dirty || now - lastSave > 30_000) {
      void persist();
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
      nodes,
      nodeDefs,
      unitDefs,
      buildingDefs,
      simulateBattle,
      advance,
      startUpgrade,
      save: () => persist(),
      rerender: () => rerender(Date.now()),
    };
  }

  rerender(Date.now());
}

void main();

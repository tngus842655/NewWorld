/**
 * 원정 — 지역 선택 → 군(원정대) 카드 → 파견 길이 → 출발. (2026-08-23 군 시스템 개편)
 * 편성은 군 카드를 눌러 여는 편성 시트에서, 파견은 군 단위로.
 */
import { content } from '../../content';
import type { Tier } from '../../content/schema';
import { computePartyPower } from '../../core/combat';
import { collectTeamEffects, query } from '../../core/effects';
import { isExpeditionOut } from '../../core/expedition';
import * as clock from '../../state/clock';
import { canUnlockRegion, capturedCounts, deepestUnlockedRegion, isRegionUnlocked, teamCount } from '../../core/progression';
import { GameError, type SaveState, type TeamLoadout } from '../../core/types';
import { batch, signal } from '../../state/signal';
import { dispatchTeam, save, unlock } from '../../state/store';
import { artifactIcon, monsterIconBadged, ownedCp } from '../components';
import { ELEMENT_EMOJI, ELEMENT_LABEL, TIER_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, fmtGold, josaRo } from '../kit';
import { regionTiers, tierShortName } from '../regionTiers';
import { resetTeamSheet } from '../teamSheet';
import { tabBar } from '../panels';
import { overlay, tab } from '../router';
import { playSfx } from '../sfx';

// 12지역에서 첫 지역 고정 시작은 진행 유저에게 매번 스크롤 — 접속하면 가장 깊은 해금 지역에서 시작 (2026-08-27)
const selRegion = signal<string>(deepestUnlockedRegion(content, save()).id);
const selTierView = signal<number>(content.regions.get(selRegion())!.tier);
const selTier = signal<Tier>('scout');

/** 권역 탭 선택 — 해금 소지역이 있으면 그중 가장 깊은 곳을 출발 대상으로. 전부 잠긴 권역은 구경만 */
function pickTier(tier: number): void {
  const state = save();
  const bucket = regionTiers.find((t) => t.tier === tier);
  if (!bucket) return;
  const deepest = [...bucket.regions].reverse().find((r) => isRegionUnlocked(content, state, r.id));
  batch(() => {
    selTierView.set(tier);
    if (deepest) selRegion.set(deepest.id);
  });
}
const selTeamId = signal<string>('team-1');
// 하단 파견 패널 접힘 상태 — 접은 채로 종료해도 다음 접속에 유지 (세이브와 무관한 기기 UI 취향이라 localStorage 별도 키)
const PANEL_OPEN_KEY = 'newworld-ui-dispatch-open';
const panelOpen = signal(localStorage.getItem(PANEL_OPEN_KEY) !== '0');

function setPanelOpen(next: boolean): void {
  if (panelOpen() !== next) playSfx('tap');
  panelOpen.set(next);
  try { localStorage.setItem(PANEL_OPEN_KEY, next ? '1' : '0'); } catch { /* 저장 불가 환경이면 세션 한정 동작 */ }
}

/** 파견 중인 군 id 집합 — 회군 복귀 중도 밖에 있는 것 (비추적 시계, 렌더 시점 기준) */
function busyTeamIds(state: SaveState): Set<string> {
  return new Set(state.expeditions.filter((e) => isExpeditionOut(e, clock.now()) && e.teamId).map((e) => e.teamId!));
}

/** 유효한(존재하는) 편성만 남긴 군 파티 */
function teamParty(state: SaveState, team: TeamLoadout): string[] {
  return team.partyIds.filter((id) => state.roster.some((m) => m.monsterId === id));
}
function teamArtifacts(state: SaveState, team: TeamLoadout): string[] {
  return team.artifactIds.filter((itemId) => state.artifacts.some((a) => a.itemId === itemId));
}

interface Preview {
  power: number;
  tribes: { tribe: string; count: number }[];
  synergyAmp: number;
  encounterAdd: number; // 계정 보너스·유물 고유의 원정당 조우 추가 — 정보줄 표기용
}

/** 군 프리셋 기준 유효 전투력 미리보기 (artifactUids를 []로 주면 유물 제외) */
function teamPreview(team: TeamLoadout, regionId: string, tier: Tier, withArtifacts = true): Preview | null {
  const state = save();
  const region = content.regions.get(regionId);
  const partyIds = teamParty(state, team);
  if (!region || partyIds.length === 0) return null;
  try {
    const fx = collectTeamEffects(content, state, partyIds, withArtifacts ? teamArtifacts(state, team) : []);
    const party = partyIds.map((monsterId) => state.roster.find((m) => m.monsterId === monsterId)!).filter(Boolean);
    const power = computePartyPower(content, fx.effects, party, region, tier).total;
    const tribes = [...fx.tribeCounts.entries()]
      .map(([tribe, count]) => ({ tribe, count }))
      .sort((a, b) => b.count - a.count);
    const setupActions = query(fx.effects, 'expeditionSetup', { regionId: region.id, tier });
    let encounterAdd = 0;
    for (const action of setupActions) if (action.kind === 'encounterAdd') encounterAdd += action.count;
    return { power: Math.round(power), tribes, synergyAmp: fx.synergyAmp, encounterAdd };
  } catch (error) {
    if (error instanceof GameError) return null;
    throw error;
  }
}

/**
 * 파견 패널 상단 핸들 — 짧게 누르면 토글, 아래로 끌면 접기, 위로 끌면 펼치기.
 */
function panelHandle(open: boolean): HTMLElement {
  const handle = el('div.panel-handle', { title: open ? '내리거나 눌러서 접기' : '올리거나 눌러서 펼치기' },
    open ? el('span.handle-bar', {}) : el('span.handle-open', {}, '∧'),
  );
  let startY: number | null = null;
  handle.onpointerdown = (e) => {
    startY = e.clientY;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  handle.onpointerup = (e) => {
    if (startY === null) return;
    const delta = e.clientY - startY;
    startY = null;
    setPanelOpen(delta > 16 ? false : delta < -16 ? true : !panelOpen());
  };
  handle.onpointercancel = () => { startY = null; };
  return handle;
}

function regionRow(regionId: string, opts: { selected: boolean; compact: boolean }): HTMLElement {
  const state = save();
  const region = content.regions.get(regionId)!;
  const unlocked = isRegionUnlocked(content, state, regionId);
  const { selected, compact } = opts;
  if (unlocked) {
    return el(`button.region-row${selected ? '.selected' : ''}`, { onclick: () => selRegion.set(regionId) },
      el('div.region-name', {},
        `${region.icon} ${region.name}`,
        el('span.region-elem', { title: `우세 속성 ${ELEMENT_LABEL[region.element]} — 같거나 이기는 속성이 유리` }, ` ${ELEMENT_EMOJI[region.element]}`),
      ),
      el('div.muted.small', {}, `권장 CP ${fmtGold(region.recommendedCp)}`),
    );
  }
  // 다음 관문이 아닌 먼 잠김 지역은 이름만 — 12지역에서 잠김 조건 11줄이 목록을 덮는 것을 막는다 (2026-08-26)
  if (compact) {
    return el('div.region-row.locked', { title: '앞 지역을 해금하면 열립니다' },
      el('div.region-name.muted', {}, `🔒 ${region.icon} ${region.name}`),
    );
  }
  const check = canUnlockRegion(content, state, regionId);
  // 해금 조건은 아이콘 + 수치만 간략히 — "필요합니다" 문구 없이 한 줄 유지 (2026-08-23 사용자)
  const counts = capturedCounts(content, state);
  const requirements: string[] = [];
  for (const [requiredRegion, need] of Object.entries(region.unlock.codexCaptured ?? {})) {
    const have = Math.min(counts.byRegion.get(requiredRegion) ?? 0, need);
    requirements.push(`${content.regions.get(requiredRegion)?.icon ?? ''}${have}/${need}`); // 지역 아이콘 = 그 지역 도감
  }
  for (const [materialId, need] of Object.entries(region.unlock.materials ?? {})) {
    const have = Math.min(state.wallet.materials[materialId] ?? 0, need);
    requirements.push(`${content.materials.get(materialId)?.icon ?? ''}${have}/${need}`);
  }
  return el('div.region-row.locked', { title: check.reason ?? '' },
    el('div.region-name', {}, `🔒 ${region.icon} ${region.name}`),
    el('div.muted.small.region-req', {}, check.ok ? '해금 조건 달성!' : requirements.join(' ')),
    // 해금하면 바로 출발 대상으로 — 방금 연 지역이 다음 목적지다
    check.ok ? el('button.btn.btn-primary.small-btn', { onclick: () => { unlock(regionId); selRegion.set(regionId); } }, '해금') : null,
  );
}

/** 군 카드 — 파티 슬롯 수만큼 미리보기 + 유물 줄 + 이름·CP. 클릭하면 편성 시트 */
function teamCard(team: TeamLoadout): HTMLElement {
  const state = save();
  const busy = busyTeamIds(state).has(team.id);
  const party = teamParty(state, team);
  const artifacts = teamArtifacts(state, team);

  // 해금한 슬롯 수만큼 칸을 그린다 — 4칸 고정은 5칸 편성의 다섯째 몬스터를 숨겼다 (2026-08-27 사용자)
  const slots = state.profile.partySlots;
  const iconCells: HTMLElement[] = [];
  for (let i = 0; i < slots; i++) {
    const monsterId = party[i];
    if (monsterId) {
      const owned = state.roster.find((m) => m.monsterId === monsterId)!;
      iconCells.push(el('div.team-cell', {}, monsterIconBadged(owned, { count: false }))); // 편성 미리보기 — 편성 슬롯과 같은 이유로 카드 수 숨김
    } else {
      iconCells.push(el('div.team-cell.team-cell-empty', {}, '+'));
    }
  }

  // 장착 유물 줄 — 이름·수치는 툴팁과 편성 시트로, 여기서는 등급 테두리만
  const arteRow = artifacts.length > 0
    ? el('div.team-arte-row', {}, ...artifacts.map((itemId) => {
        const def = content.artifacts.get(itemId);
        const owned = state.artifacts.find((a) => a.itemId === itemId);
        const icon = artifactIcon(itemId);
        if (def) icon.title = `${def.name}${owned && owned.enhance > 0 ? ` +${owned.enhance}` : ''}`;
        return icon;
      }))
    : null;

  const totalCp = party.reduce((sum, id) => {
    const owned = state.roster.find((m) => m.monsterId === id);
    return sum + (owned ? ownedCp(owned) : 0);
  }, 0);

  return el(`button.card.team-card${busy ? '.team-busy' : ''}`, {
    title: `${team.name} 편성 열기${artifacts.length > 0 ? ` · 유물 ${artifacts.length}/4` : ''}`,
    onclick: () => {
      playSfx('tap');
      resetTeamSheet();
      overlay.set({ kind: 'teamEdit', teamId: team.id });
    },
  },
    el('div.team-row', {}, ...iconCells),
    arteRow,
    el('div.team-foot', {},
      el('span.team-name-sm', {}, busy ? `🧭 ${team.name}` : team.name), // 파견 중은 칩과 같은 🧭 접두
      party.length > 0
        ? el('span.team-cp', {}, `CP ${fmtGold(totalCp)}`)
        : el('span.muted.small', {}, '비어 있음'),
    ),
  );
}

/** 아직 잠긴 군 — 카드 대신 한 줄 (12지역 개편으로 화면이 길어져 세로 압축, 2026-08-27) */
function lockedTeamLines(state: SaveState): HTMLElement[] {
  // 군 게이트가 뒤로 이동해도(2026-08-26 심부 이동) 이미 만들어진 프리셋은 회수하지 않는다 —
  // 프리셋 카드가 있는 군에 잠금 줄을 겹쳐 보여주지 않는다
  const current = Math.max(teamCount(content, state), state.teams.length);
  return content.balance.teams
    .filter((u) => u.count > current && u.regionUnlocked)
    .map((u) => {
      const region = content.regions.get(u.regionUnlocked!);
      return el('div.team-locked-line', { title: `${region?.name ?? ''} 해금 시 편성 가능` },
        `🔒 원정대 ${u.count} — ${region?.icon ?? ''} ${region?.name ?? ''} 해금 시`);
    });
}

export function renderExpedition(): HTMLElement {
  const state = save();
  // 리셋·세이브 붙여넣기로 선택 지역이 잠겼을 수 있다 — 시그널은 두고 이번 렌더의 출발 대상만 보정
  const regionId = isRegionUnlocked(content, state, selRegion())
    ? selRegion()
    : deepestUnlockedRegion(content, state).id;
  const region = content.regions.get(regionId)!;
  const tier = selTier();
  const busy = busyTeamIds(state);

  // 선택 군 — 없거나 파견 중이면 첫 가용 군으로
  const chosen = state.teams.find((t) => t.id === selTeamId() && !busy.has(t.id))
    ?? state.teams.find((t) => !busy.has(t.id))
    ?? state.teams[0]!;
  const team = chosen;
  const party = teamParty(state, team);
  const info = teamPreview(team, regionId, tier);

  const cpClass = info && info.power >= region.recommendedCp ? 'cp-ok' : 'cp-low';
  const synergyChips = (info?.tribes ?? [])
    .filter((t) => t.count >= 2)
    .map((t) =>
      el(`span.tag.synergy${t.count >= 3 ? '.synergy-max' : ''}`, {},
        `${TRIBE_EMOJI[t.tribe as keyof typeof TRIBE_EMOJI]} ${TRIBE_LABEL[t.tribe as keyof typeof TRIBE_LABEL]} ×${Math.min(t.count, 3)}`),
    );

  const lureLoad = Math.min(content.balance.lures.maxLoad, state.wallet.lures);
  const runningCount = state.expeditions.filter((e) => isExpeditionOut(e, clock.now())).length;
  const maxTeams = teamCount(content, state);
  const teamsFull = runningCount >= maxTeams;
  const teamBusy = busy.has(team.id);

  const tierDef = content.balance.tiers[tier];
  const tierInfo = [
    `조우 ${tierDef.encounters + (info?.encounterAdd ?? 0)}회`,
    tierDef.crossroads > 0 ? `갈림길 ${tierDef.crossroads}회` : null,
    tierDef.yieldMult > 1 ? `보상 ×${tierDef.yieldMult}` : null,
    tierDef.rareWeightMult > 1 ? `희귀 출현 ×${tierDef.rareWeightMult}` : null,
    tierDef.legendaryChance > 0 ? '⭐ 전설과 만날 수 있다' : null,
  ].filter(Boolean).join(' · ');

  // 권역 탭 — 12행을 탭 4개 + 소지역 3행으로 접는다. 완료 ✓ · 진행 n/3 · 미개방 🔒,
  // 지금 해금을 실행할 수 있는 관문이 있으면 알림 점(탭 점 관용: '보유'가 아니라 '실행 가능')
  const viewTier = selTierView();
  const tierTabs = tabBar(
    regionTiers.map(({ tier: t, regions }) => {
      const unlockedCount = regions.filter((r) => isRegionUnlocked(content, state, r.id)).length;
      const mark = unlockedCount === regions.length ? '✓' : unlockedCount === 0 ? '🔒' : `${unlockedCount}/${regions.length}`;
      return {
        key: String(t),
        label: `${regions[0]!.icon} ${tierShortName(regions)} ${mark}`,
        title: `${regions[0]!.name} 권역 — 소지역 ${unlockedCount}/${regions.length} 해금`,
        dot: regions.some((r) => !isRegionUnlocked(content, state, r.id) && canUnlockRegion(content, state, r.id).ok),
      };
    }),
    { active: String(viewTier), onPick: (key) => pickTier(Number(key)) },
  );
  const viewRegions = (regionTiers.find((t) => t.tier === viewTier) ?? regionTiers[0]!).regions;
  // 잠김 지역 중 첫 번째(다음 관문)만 조건을 펼친다 — 나머지는 이름만 보여 목표는 보이되 목록은 짧게
  const nextGate = content.regionList.find((r) => !isRegionUnlocked(content, state, r.id))?.id;

  return el('div.screen', {},
    tierTabs,
    el('div.card.stack-sm', {}, ...viewRegions.map((r) => regionRow(r.id, {
      selected: r.id === regionId,
      compact: r.id !== nextGate && !isRegionUnlocked(content, state, r.id),
    }))),

    el('h2.section-title', {}, '원정대'),
    el('div.team-grid', {}, ...state.teams.map((t) => teamCard(t))),
    ...lockedTeamLines(state),

    el(`div.card.dispatch-panel${panelOpen() ? '' : '.collapsed'}`, {},
      panelHandle(panelOpen()),
      // 원정대 선택은 접힘 상태에서도 항상 (2026-08-23 사용자)
      el('div.chips-wrap', {}, ...state.teams.map((t) =>
        el(`button.chip${team.id === t.id ? '.active' : ''}`, {
          disabled: busy.has(t.id),
          onclick: () => selTeamId.set(t.id),
        }, busy.has(t.id) ? `🧭 ${t.name}` : t.name))),
      ...(panelOpen() ? [
        el('div.cp-row', {},
          el('span', {}, `${team.name} 유효 전투력`),
          el(`strong.${cpClass}`, {}, info ? fmtGold(info.power) : '—'),
          el('span.muted.small', {}, `/ 권장 ${fmtGold(region.recommendedCp)}`),
        ),
        synergyChips.length > 0 ? el('div.chips-wrap', {}, ...synergyChips) : el('div.muted.small', {}, '시너지 없음 [같은 종족 2마리부터 발동]'),
        info && info.synergyAmp > 0 ? el('div.muted.small', {}, `시너지 증폭 +${Math.round(info.synergyAmp * 100)}%`) : null,
        el('div.tier-row', {}, ...(['scout', 'standard', 'deep'] as const).map((t) =>
          el(`button.btn.tier-btn${tier === t ? '.selected' : ''}`, { onclick: () => selTier.set(t) }, TIER_LABEL[t]),
        )),
        el('div.muted.small', {}, tierInfo),
        el('div.muted.small', {}, `미끼 자동 적재: ${lureLoad}개 (보유 ${state.wallet.lures})`),
        maxTeams > 1 || teamsFull
          ? el('div.muted.small', {}, `원정대 ${runningCount}/${maxTeams} 파견 중`)
          : null,
      ] : []),
      el('button.btn.btn-primary.btn-big', {
        disabled: party.length === 0 || teamsFull || teamBusy,
        onclick: () => {
          if (dispatchTeam(team.id, regionId, tier)) {
            playSfx('confirm');
            tab.set('home');
          }
        },
      }, teamsFull
        ? `⛺ 원정대가 모두 파견 중입니다 (${runningCount}/${maxTeams})`
        : party.length === 0
          ? `${team.name} 편성이 비어 있습니다 [카드를 눌러 편성하세요]`
          : `🧭 ${josaRo(region.name)} 출발`), // 갯벌로·우듬지로·심연으로 — '으로' 고정 금지
    ),
  );
}

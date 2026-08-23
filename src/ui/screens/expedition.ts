/**
 * 원정 — 지역 선택 → 군(원정대) 카드 → 파견 길이 → 출발. (2026-08-23 군 시스템 개편)
 * 편성은 군 카드를 눌러 여는 편성 시트에서, 파견은 군 단위로.
 */
import { content } from '../../content';
import type { Tier } from '../../content/schema';
import { computePartyPower } from '../../core/combat';
import { collectTeamEffects } from '../../core/effects';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, teamCount } from '../../core/progression';
import { GameError, type SaveState, type TeamLoadout } from '../../core/types';
import { signal } from '../../state/signal';
import { dispatchTeam, save, unlock } from '../../state/store';
import { monsterIconBadged, ownedCp } from '../components';
import { ELEMENT_EMOJI, ELEMENT_LABEL, TIER_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, fmtGold } from '../kit';
import { resetTeamSheet } from '../teamSheet';
import { overlay, tab } from '../router';
import { playSfx } from '../sfx';

const selRegion = signal<string>(content.regionList[0]!.id);
const selTier = signal<Tier>('scout');
const selTeamId = signal<string>('team-1');
// 하단 파견 패널 접힘 상태 — 접은 채로 종료해도 다음 접속에 유지 (세이브와 무관한 기기 UI 취향이라 localStorage 별도 키)
const PANEL_OPEN_KEY = 'newworld-ui-dispatch-open';
const panelOpen = signal(localStorage.getItem(PANEL_OPEN_KEY) !== '0');

function setPanelOpen(next: boolean): void {
  if (panelOpen() !== next) playSfx('tap');
  panelOpen.set(next);
  try { localStorage.setItem(PANEL_OPEN_KEY, next ? '1' : '0'); } catch { /* 저장 불가 환경이면 세션 한정 동작 */ }
}

/** 파견 중인 군 id 집합 */
function busyTeamIds(state: SaveState): Set<string> {
  return new Set(state.expeditions.filter((e) => !e.claimed && e.teamId).map((e) => e.teamId!));
}

/** 유효한(존재하는) 편성만 남긴 군 파티 */
function teamParty(state: SaveState, team: TeamLoadout): string[] {
  return team.partyIds.filter((id) => state.roster.some((m) => m.monsterId === id));
}
function teamArtifacts(state: SaveState, team: TeamLoadout): string[] {
  return team.artifactUids.filter((uid) => state.artifacts.some((a) => a.uid === uid));
}

interface Preview {
  power: number;
  tribes: { tribe: string; count: number }[];
  synergyAmp: number;
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
    return { power: Math.round(power), tribes, synergyAmp: fx.synergyAmp };
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

function regionRow(regionId: string): HTMLElement {
  const state = save();
  const region = content.regions.get(regionId)!;
  const unlocked = isRegionUnlocked(content, state, regionId);
  const selected = selRegion() === regionId;
  if (unlocked) {
    return el(`button.region-row${selected ? '.selected' : ''}`, { onclick: () => selRegion.set(regionId) },
      el('div.region-name', {},
        `${region.icon} ${region.name}`,
        el('span.region-elem', { title: `우세 속성 ${ELEMENT_LABEL[region.element]} — 같거나 이기는 속성이 유리` }, ` ${ELEMENT_EMOJI[region.element]}`),
      ),
      el('div.muted.small', {}, `권장 CP ${fmtGold(region.recommendedCp)}`),
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
    check.ok ? el('button.btn.btn-primary.small-btn', { onclick: () => unlock(regionId) }, '해금') : null,
  );
}

/** 군 카드 — 2×2 몬스터 미리보기 + 요약(CP·속성·유물). 클릭하면 편성 시트 */
function teamCard(team: TeamLoadout): HTMLElement {
  const state = save();
  const busy = busyTeamIds(state).has(team.id);
  const party = teamParty(state, team);
  const artifacts = teamArtifacts(state, team);

  // 아이콘 한 줄 4마리 + CP만 — 상세는 카드·편성 시트에 있으니 요약 최소화 (2026-08-23 사용자)
  const iconCells: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) {
    const monsterId = party[i];
    if (monsterId) {
      const owned = state.roster.find((m) => m.monsterId === monsterId)!;
      iconCells.push(el('div.team-cell', {}, monsterIconBadged(owned)));
    } else {
      iconCells.push(el('div.team-cell.team-cell-empty', {}, '+'));
    }
  }

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
    el('div.team-row', {},
      ...iconCells,
      party.length > 4 ? el('span.team-more', {}, `+${party.length - 4}`) : null,
    ),
    el('div.team-info', {},
      busy ? el('span.tag.busy-tag', {}, '🧭 원정 중') : null,
      party.length > 0
        ? el('div.team-cp', {}, `CP ${fmtGold(totalCp)}`)
        : el('div.muted.small', {}, '편성 비어 있음'),
    ),
  );
}

/** 아직 잠긴 군 안내 카드 */
function lockedTeamCards(state: SaveState): HTMLElement[] {
  const current = teamCount(content, state);
  return content.balance.teams
    .filter((u) => u.count > current && u.regionUnlocked)
    .map((u) => {
      const region = content.regions.get(u.regionUnlocked!);
      return el('div.card.team-card.team-locked', {},
        el('div.team-row', {}, ...Array.from({ length: 4 }, () => el('div.team-cell.team-cell-empty', {}, ''))),
        el('div.team-info', {},
          el('div.team-name.muted', {}, `🔒 원정대 ${u.count}`),
          el('div.muted.small', {}, `${region?.icon ?? ''} ${region?.name ?? ''} 해금 시`),
        ),
      );
    });
}

export function renderExpedition(): HTMLElement {
  const state = save();
  const regionId = selRegion();
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
  const runningCount = state.expeditions.filter((e) => !e.claimed).length;
  const maxTeams = teamCount(content, state);
  const teamsFull = runningCount >= maxTeams;
  const teamBusy = busy.has(team.id);

  const tierDef = content.balance.tiers[tier];
  const tierInfo = [
    `조우 ${tierDef.encounters}회`,
    tierDef.crossroads > 0 ? `갈림길 ${tierDef.crossroads}회` : null,
    tierDef.yieldMult > 1 ? `보상 ×${tierDef.yieldMult}` : null,
    tierDef.rareWeightMult > 1 ? `희귀 출현 ×${tierDef.rareWeightMult}` : null,
    tierDef.legendaryChance > 0 ? '⭐ 전설과 만날 수 있다' : null,
  ].filter(Boolean).join(' · ');

  return el('div.screen', {},
    el('h2.section-title', {}, '지역'),
    el('div.card.stack-sm', {}, ...content.regionList.map((r) => regionRow(r.id))),

    el('h2.section-title', {}, '원정대'),
    ...state.teams.map((t) => teamCard(t)),
    ...lockedTeamCards(state),

    el(`div.card.dispatch-panel${panelOpen() ? '' : '.collapsed'}`, {},
      panelHandle(panelOpen()),
      ...(panelOpen() ? [
        el('div.chips-wrap', {}, ...state.teams.map((t) =>
          el(`button.chip${team.id === t.id ? '.active' : ''}`, {
            disabled: busy.has(t.id),
            onclick: () => selTeamId.set(t.id),
          }, busy.has(t.id) ? `🧭 ${t.name}` : t.name))),
        el('div.cp-row', {},
          el('span', {}, `${team.name} 유효 전투력`),
          el(`strong.${cpClass}`, {}, info ? fmtGold(info.power) : '—'),
          el('span.muted.small', {}, `/ 권장 ${fmtGold(region.recommendedCp)}`),
        ),
        synergyChips.length > 0 ? el('div.chips-wrap', {}, ...synergyChips) : el('div.muted.small', {}, '시너지 없음 — 같은 종족 2마리부터 발동'),
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
          ? `${team.name} 편성이 비어 있습니다 — 카드를 눌러 편성하세요`
          : `🧭 ${team.name} — ${region.name}으로 출발`),
    ),
  );
}

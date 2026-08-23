/**
 * 원정 — 지역 선택 → 파티·유물 편성(유효 CP 실시간) → 파견 길이 → 출발.
 * 필러 2: "몬스터·유물을 바꿔 끼울 때마다 숫자가 움직이는" 화면.
 */
import { content } from '../../content';
import type { Tier } from '../../content/schema';
import { computePartyPower } from '../../core/combat';
import { collectTeamEffects } from '../../core/effects';
import { canUnlockRegion, isRegionUnlocked, teamCount } from '../../core/progression';
import { GameError } from '../../core/types';
import { signal } from '../../state/signal';
import { dispatchExpedition, save, unlock } from '../../state/store';
import { artifactIcon, monsterIcon } from '../components';
import { ELEMENT_EMOJI, ELEMENT_LABEL, TIER_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, fmtGold } from '../kit';
import { resetPicks } from '../pickSheets';
import { overlay, tab } from '../router';
import { playSfx } from '../sfx';

const selRegion = signal<string>(content.regionList[0]!.id);
const selParty = signal<string[]>([]);
const selArtifacts = signal<string[]>([]);
const selTier = signal<Tier>('scout');
// 하단 파견 패널 접힘 상태 — 접은 채로 종료해도 다음 접속에 유지 (세이브와 무관한 기기 UI 취향이라 localStorage 별도 키)
const PANEL_OPEN_KEY = 'newworld-ui-dispatch-open';
const panelOpen = signal(localStorage.getItem(PANEL_OPEN_KEY) !== '0');
let presetLoaded = false;

function setPanelOpen(next: boolean): void {
  if (panelOpen() !== next) playSfx('tap');
  panelOpen.set(next);
  try { localStorage.setItem(PANEL_OPEN_KEY, next ? '1' : '0'); } catch { /* 저장 불가 환경이면 세션 한정 동작 */ }
}

export function busyUids(): Set<string> {
  const state = save();
  return new Set(state.expeditions.filter((e) => !e.claimed).flatMap((e) => [...e.partyIds, ...e.artifactUids]));
}

/**
 * 신호에 남은 id 중 지금 실제로 편성 가능한 것만.
 * 파견·초기화·가져오기로 무효해진 선택이 화면·미리보기·출발에 끼어들지 않게 하는 단일 관문 —
 * 렌더 중 signal.set을 피하려고 저장값은 그대로 두고 읽는 쪽에서 거른다.
 */
export function effectiveParty(): string[] {
  const state = save();
  const busy = busyUids();
  return selParty().filter((monsterId) => state.roster.some((m) => m.monsterId === monsterId) && !busy.has(monsterId));
}

export function effectiveArtifacts(): string[] {
  const state = save();
  const busy = busyUids();
  return selArtifacts().filter((uid) => state.artifacts.some((a) => a.uid === uid) && !busy.has(uid));
}

/** 팀 프리셋(마지막 편성)을 최초 1회 불러온다 — 파견 중이거나 사라진 대상은 제외 */
function loadPresetOnce(): void {
  if (presetLoaded) return;
  presetLoaded = true;
  const state = save();
  const busy = busyUids();
  const team = state.teams[0];
  if (!team) return;
  selParty.set(team.partyIds.filter((monsterId) => state.roster.some((m) => m.monsterId === monsterId) && !busy.has(monsterId)));
  selArtifacts.set(team.artifactUids.filter((uid) => state.artifacts.some((a) => a.uid === uid) && !busy.has(uid)));
}

/** 성공 여부 반환 — 선택 팝업이 효과음으로 결과를 알릴 수 있게 */
export function toggleParty(monsterId: string): boolean {
  const state = save();
  const current = effectiveParty();
  if (current.includes(monsterId)) {
    selParty.set(current.filter((id) => id !== monsterId));
    return true;
  }
  if (current.length >= state.profile.partySlots) return false;
  selParty.set([...current, monsterId]);
  return true;
}

export function toggleArtifact(uid: string): boolean {
  const state = save();
  const current = effectiveArtifacts();
  if (current.includes(uid)) {
    selArtifacts.set(current.filter((u) => u !== uid));
    return true;
  }
  const owned = state.artifacts.find((a) => a.uid === uid);
  const def = owned ? content.artifacts.get(owned.itemId) : null;
  if (!def) return false;
  // 같은 슬롯은 교체, 최대 4개
  const withoutSameSlot = current.filter((u) => {
    const other = state.artifacts.find((a) => a.uid === u);
    return other && content.artifacts.get(other.itemId)?.slot !== def.slot;
  });
  if (withoutSameSlot.length >= 4) return false;
  selArtifacts.set([...withoutSameSlot, uid]);
  return true;
}

interface Preview {
  power: number;
  tribes: { tribe: string; count: number }[];
  synergyAmp: number;
}

function preview(regionId: string, tier: Tier): Preview | null {
  const state = save();
  const region = content.regions.get(regionId);
  const partyUids = effectiveParty();
  if (!region || partyUids.length === 0) return null;
  try {
    const fx = collectTeamEffects(content, state, partyUids, effectiveArtifacts());
    const party = partyUids.map((monsterId) => state.roster.find((m) => m.monsterId === monsterId)!).filter(Boolean);
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
 * 펼침 상태에선 바(═), 접힘 상태에선 펼침 화살표를 보여준다.
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
        region.name,
        el('span.region-elem', { title: `우세 속성 ${ELEMENT_LABEL[region.element]} — 같거나 이기는 속성이 유리` }, ` ${ELEMENT_EMOJI[region.element]}`),
      ),
      el('div.muted.small', {}, `권장 CP ${fmtGold(region.recommendedCp)}`),
    );
  }
  const check = canUnlockRegion(content, state, regionId);
  return el('div.region-row.locked', {},
    el('div.region-name', {}, `🔒 ${region.name}`),
    el('div.muted.small', {}, check.ok ? '해금 조건 달성!' : (check.reason ?? '')),
    check.ok ? el('button.btn.btn-primary.small-btn', { onclick: () => unlock(regionId) }, '해금') : null,
  );
}

export function renderExpedition(): HTMLElement {
  loadPresetOnce();
  const state = save();
  const regionId = selRegion();
  const region = content.regions.get(regionId)!;
  const tier = selTier();
  const info = preview(regionId, tier);
  const slots = state.profile.partySlots;
  const party = effectiveParty();
  const artifacts = effectiveArtifacts();

  // 편성 영역은 실제 편성분만 네모 슬롯으로 — 빈 슬롯의 +를 누르면 선택 팝업 (2026-08-23)
  const openPartyPick = () => { resetPicks(); overlay.set({ kind: 'partyPick' }); };
  const maxPartySlots = Math.max(slots, ...content.balance.party.slotUnlocks.map((u) => u.slots));
  const partySlotCells = Array.from({ length: maxPartySlots }, (_, i) => {
    const monsterId = party[i];
    if (monsterId) {
      return el('button.party-slot.filled', {
        title: `${content.monsters.get(monsterId)?.name ?? ''} — 눌러서 편성 변경`,
        onclick: openPartyPick,
      }, monsterIcon(monsterId));
    }
    if (i < slots) return el('button.party-slot', { title: '몬스터 편성', onclick: openPartyPick }, '+');
    return el('div.party-slot.locked', { title: '캠프에서 파티 슬롯을 확장할 수 있습니다' }, '🔒');
  });

  const openArtifactPick = () => { resetPicks(); overlay.set({ kind: 'artifactPick' }); };
  const artifactSlotCells = Array.from({ length: 4 }, (_, i) => {
    const uid = artifacts[i];
    const owned = uid ? state.artifacts.find((a) => a.uid === uid) : null;
    if (owned) {
      return el('button.party-slot.filled', {
        title: `${content.artifacts.get(owned.itemId)?.name ?? ''} — 눌러서 편성 변경`,
        onclick: openArtifactPick,
      }, artifactIcon(owned.itemId));
    }
    return el('button.party-slot', { title: '유물 장착', onclick: openArtifactPick }, '+');
  });

  const cpClass = info && info.power >= region.recommendedCp ? 'cp-ok' : 'cp-low';
  const synergyChips = (info?.tribes ?? [])
    .filter((t) => t.count >= 2)
    .map((t) =>
      el(`span.tag.synergy${t.count >= 3 ? '.synergy-max' : ''}`, {},
        `${TRIBE_EMOJI[t.tribe as keyof typeof TRIBE_EMOJI]} ${TRIBE_LABEL[t.tribe as keyof typeof TRIBE_LABEL]} ×${Math.min(t.count, 3)}`),
    );

  const lureLoad = Math.min(content.balance.lures.maxLoad, state.wallet.lures);

  // 동시 파견 한도 — 가득 차면 출발을 막고 이유를 보여준다
  const runningCount = state.expeditions.filter((e) => !e.claimed).length;
  const maxTeams = teamCount(content, state);
  const teamsFull = runningCount >= maxTeams;
  const nextTeam = content.balance.teams.find((u) => u.count === maxTeams + 1);
  const nextTeamHint = nextTeam
    ? nextTeam.regionUnlocked
      ? `${content.regions.get(nextTeam.regionUnlocked)?.name ?? nextTeam.regionUnlocked} 해금 시 ${nextTeam.count}팀`
      : `도감 ${nextTeam.totalCaptured}종 포획 시 ${nextTeam.count}팀`
    : null;

  // 선택한 파견 길이의 정보 (GDD §5.1)
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

    el('h2.section-title', {}, `파티 편성 (${party.length}/${slots})`),
    el('div.card.stack-sm', {},
      el('div.party-slots', {}, ...partySlotCells),
      state.roster.length === 0 ? el('span.muted.small', {}, '보유 몬스터가 없습니다') : null,
    ),

    el('h2.section-title', {}, `유물 (${artifacts.length}/4)`),
    el('div.card.stack-sm', {},
      el('div.party-slots', {}, ...artifactSlotCells),
      state.artifacts.length === 0 ? el('span.muted.small', {}, '아직 유물이 없습니다 — 원정에서 발굴해 보세요') : null,
    ),

    el(`div.card.dispatch-panel${panelOpen() ? '' : '.collapsed'}`, {},
      panelHandle(panelOpen()),
      ...(panelOpen() ? [
        el('div.cp-row', {},
          el('span', {}, '유효 전투력'),
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
          ? el('div.muted.small', {},
              `원정대 ${runningCount}/${maxTeams} 파견 중${nextTeamHint ? ` · ${nextTeamHint}` : ''}`)
          : null,
      ] : []),
      el('button.btn.btn-primary.btn-big', {
        disabled: party.length === 0 || teamsFull,
        onclick: () => {
          const ok = dispatchExpedition({ regionId, tier, partyIds: effectiveParty(), artifactUids: effectiveArtifacts() });
          if (ok) {
            playSfx('confirm');
            tab.set('home');
          }
        },
      }, teamsFull ? `⛺ 원정대가 모두 파견 중입니다 (${runningCount}/${maxTeams})` : `🧭 ${region.name}으로 출발`),
    ),
  );
}

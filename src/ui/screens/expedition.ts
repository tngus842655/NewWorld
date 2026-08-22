/**
 * 원정 — 지역 선택 → 파티·유물 편성(유효 CP 실시간) → 파견 길이 → 출발.
 * 필러 2: "몬스터·유물을 바꿔 끼울 때마다 숫자가 움직이는" 화면.
 */
import { content } from '../../content';
import type { Tier } from '../../content/schema';
import { computePartyPower } from '../../core/combat';
import { collectTeamEffects } from '../../core/effects';
import { canUnlockRegion, isRegionUnlocked } from '../../core/progression';
import { GameError } from '../../core/types';
import { signal } from '../../state/signal';
import { dispatchExpedition, save, unlock } from '../../state/store';
import { artifactCard, monsterChip } from '../components';
import { SLOT_LABEL, TIER_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, fmtGold } from '../kit';
import { tab } from '../router';
import { playSfx } from '../sfx';

const selRegion = signal<string>(content.regionList[0]!.id);
const selParty = signal<string[]>([]);
const selArtifacts = signal<string[]>([]);
const selTier = signal<Tier>('scout');
let presetLoaded = false;

function busyUids(): Set<string> {
  const state = save();
  return new Set(state.expeditions.filter((e) => !e.claimed).flatMap((e) => [...e.partyUids, ...e.artifactUids]));
}

/** 팀 프리셋(마지막 편성)을 최초 1회 불러온다 — 파견 중이거나 사라진 대상은 제외 */
function loadPresetOnce(): void {
  if (presetLoaded) return;
  presetLoaded = true;
  const state = save();
  const busy = busyUids();
  const team = state.teams[0];
  if (!team) return;
  selParty.set(team.partyUids.filter((uid) => state.roster.some((m) => m.uid === uid) && !busy.has(uid)));
  selArtifacts.set(team.artifactUids.filter((uid) => state.artifacts.some((a) => a.uid === uid) && !busy.has(uid)));
}

function toggleParty(uid: string): void {
  const state = save();
  const current = selParty();
  if (current.includes(uid)) {
    selParty.set(current.filter((u) => u !== uid));
  } else if (current.length < state.profile.partySlots) {
    selParty.set([...current, uid]);
  }
}

function toggleArtifact(uid: string): void {
  const state = save();
  const current = selArtifacts();
  if (current.includes(uid)) {
    selArtifacts.set(current.filter((u) => u !== uid));
    return;
  }
  const owned = state.artifacts.find((a) => a.uid === uid);
  const def = owned ? content.artifacts.get(owned.itemId) : null;
  if (!def) return;
  // 같은 슬롯은 교체, 최대 4개
  const withoutSameSlot = current.filter((u) => {
    const other = state.artifacts.find((a) => a.uid === u);
    return other && content.artifacts.get(other.itemId)?.slot !== def.slot;
  });
  if (withoutSameSlot.length >= 4) return;
  selArtifacts.set([...withoutSameSlot, uid]);
}

interface Preview {
  power: number;
  tribes: { tribe: string; count: number }[];
  synergyAmp: number;
}

function preview(regionId: string, tier: Tier): Preview | null {
  const state = save();
  const region = content.regions.get(regionId);
  if (!region || selParty().length === 0) return null;
  try {
    const fx = collectTeamEffects(content, state, selParty(), selArtifacts());
    const party = selParty().map((uid) => state.roster.find((m) => m.uid === uid)!).filter(Boolean);
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

function regionRow(regionId: string): HTMLElement {
  const state = save();
  const region = content.regions.get(regionId)!;
  const unlocked = isRegionUnlocked(content, state, regionId);
  const selected = selRegion() === regionId;
  if (unlocked) {
    return el(`button.region-row${selected ? '.selected' : ''}`, { onclick: () => selRegion.set(regionId) },
      el('div.region-name', {}, region.name),
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
  const busy = busyUids();
  const regionId = selRegion();
  const region = content.regions.get(regionId)!;
  const tier = selTier();
  const info = preview(regionId, tier);
  const slots = state.profile.partySlots;

  const partyChips = [...state.roster]
    .sort((a, b) => (busy.has(a.uid) ? 1 : 0) - (busy.has(b.uid) ? 1 : 0))
    .map((owned) =>
      monsterChip(owned, {
        selected: selParty().includes(owned.uid),
        busy: busy.has(owned.uid),
        onclick: () => toggleParty(owned.uid),
      }),
    );

  const artifactCards = [...state.artifacts]
    .map((owned) => ({ owned, def: content.artifacts.get(owned.itemId)! }))
    .sort((a, b) => a.def.slot.localeCompare(b.def.slot))
    .map(({ owned, def }) =>
      artifactCard(owned, def, {
        selected: selArtifacts().includes(owned.uid),
        busy: busy.has(owned.uid),
        onclick: () => toggleArtifact(owned.uid),
      }),
    );

  const cpClass = info && info.power >= region.recommendedCp ? 'cp-ok' : 'cp-low';
  const synergyChips = (info?.tribes ?? [])
    .filter((t) => t.count >= 2)
    .map((t) =>
      el(`span.tag.synergy${t.count >= 3 ? '.synergy-max' : ''}`, {},
        `${TRIBE_EMOJI[t.tribe as keyof typeof TRIBE_EMOJI]} ${TRIBE_LABEL[t.tribe as keyof typeof TRIBE_LABEL]} ×${Math.min(t.count, 3)}`),
    );

  const lureLoad = Math.min(content.balance.lures.maxLoad, state.wallet.lures);

  return el('div.screen', {},
    el('h2.section-title', {}, '지역'),
    el('div.card.stack-sm', {}, ...content.regionList.map((r) => regionRow(r.id))),

    el('h2.section-title', {}, `파티 편성 (${selParty().length}/${slots})`),
    el('div.card', {},
      el('div.chips', {}, ...partyChips),
      state.roster.length === 0 ? el('span.muted', {}, '보유 몬스터가 없습니다') : null,
    ),

    el('h2.section-title', {}, `유물 (${selArtifacts().length}/4)`),
    el('div.card', {},
      state.artifacts.length === 0
        ? el('span.muted', {}, '아직 유물이 없습니다 — 원정에서 발굴해 보세요')
        : el('div.stack-sm', {}, ...artifactCards),
    ),

    el('div.card.dispatch-panel', {},
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
      el('div.muted.small', {}, `미끼 자동 적재: ${lureLoad}개 (보유 ${state.wallet.lures})`),
      el('button.btn.btn-primary.btn-big', {
        disabled: selParty().length === 0,
        onclick: () => {
          const ok = dispatchExpedition({ regionId, tier, partyUids: selParty(), artifactUids: selArtifacts() });
          if (ok) {
            playSfx('confirm');
            tab.set('home');
          }
        },
      }, `🧭 ${region.name}으로 출발`),
    ),
  );
}

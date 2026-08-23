/**
 * 군 편성 시트 (2026-08-23, 군 시스템) — 상단 편성 슬롯(파티·유물), 하단 보유 목록.
 * 몬스터는 카드 수 기준으로 군 간 배타(다른 군이 다 쓰면 목록에서 숨김),
 * 유물은 같은 종류(itemId)로 묶어 ×n 표시하고 연결 시 강화 높은 개체를 자동 선택한다.
 */
import { content } from '../content';
import type { Tribe } from '../content/schema';
import { artifactsUsedByTeams, speciesUsedByTeams } from '../core/teams';
import type { OwnedArtifact } from '../core/types';
import { signal } from '../state/signal';
import { save, setTeam } from '../state/store';
import { artifactIcon, monsterChip, monsterIconBadged, ownedCp } from './components';
import { ARTIFACT_RARITY_LABEL, ARTIFACT_RARITY_ORDER, SLOT_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, fmtGold } from './kit';
import { sheetShell } from './overlays';
import { playSfx } from './sfx';

type SortMode = 'cp' | 'level' | 'rarity';
const SORT_LABEL: Record<SortMode, string> = { cp: 'CP순', level: '레벨순', rarity: '등급순' };
const sortMode = signal<SortMode>('cp');
const tribeFilter = signal<Tribe | null>(null);
const listTab = signal<'monster' | 'artifact'>('monster'); // 하단 목록 탭 (2026-08-23 사용자)

/** 편성 시트를 열 때 정렬·필터 초기화 */
export function resetTeamSheet(): void {
  sortMode.set('cp');
  tribeFilter.set(null);
  listTab.set('monster');
}

export function teamSheet(teamId: string): HTMLElement | null {
  const state = save();
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const busy = state.expeditions.some((e) => !e.claimed && e.teamId === teamId);
  const slots = state.profile.partySlots;
  const party = team.partyIds.filter((id) => state.roster.some((m) => m.monsterId === id));
  const artifacts = team.artifactUids.filter((uid) => state.artifacts.some((a) => a.uid === uid));

  const guard = (): boolean => {
    if (busy) playSfx('error');
    return busy;
  };
  const commit = (partyIds: string[], artifactUids: string[], sfx: 'select' | 'tap'): void => {
    if (setTeam(teamId, partyIds, artifactUids)) playSfx(sfx);
  };

  // ── 상단 편성 슬롯 ──
  const partyCells = Array.from({ length: slots }, (_, i) => {
    const monsterId = party[i];
    if (!monsterId) {
      return el('button.party-slot', {
        title: '아래 목록에서 몬스터를 눌러 편성',
        onclick: () => listTab.set('monster'), // 빈 슬롯 탭 → 해당 목록으로
      }, '+');
    }
    const owned = state.roster.find((m) => m.monsterId === monsterId)!;
    return el('button.party-slot.filled', {
      title: `${content.monsters.get(monsterId)?.name ?? ''} — 눌러서 해제`,
      onclick: () => { if (!guard()) commit(party.filter((id) => id !== monsterId), artifacts, 'tap'); },
    }, monsterIconBadged(owned));
  });

  const artifactCells = Array.from({ length: 4 }, (_, i) => {
    const uid = artifacts[i];
    const owned = uid ? state.artifacts.find((a) => a.uid === uid) : null;
    if (!owned) {
      return el('button.party-slot', {
        title: '아래 목록에서 유물을 눌러 연결',
        onclick: () => listTab.set('artifact'),
      }, '+');
    }
    const def = content.artifacts.get(owned.itemId);
    const icon = artifactIcon(owned.itemId);
    if (owned.enhance > 0) icon.append(el('span.micon-count', {}, `+${owned.enhance}`));
    return el('button.party-slot.filled', {
      title: `${def?.name ?? ''}${owned.enhance > 0 ? ` +${owned.enhance}` : ''} — 눌러서 해제`,
      onclick: () => { if (!guard()) commit(party, artifacts.filter((u) => u !== owned.uid), 'tap'); },
    }, icon);
  });

  const totalCp = party.reduce((sum, id) => {
    const owned = state.roster.find((m) => m.monsterId === id);
    return sum + (owned ? ownedCp(owned) : 0);
  }, 0);

  // ── 몬스터 목록 (군 간 배타 — 다른 군이 카드를 다 쓰면 숨김) ──
  const otherUse = speciesUsedByTeams(state, teamId);
  const sort = sortMode();
  const tribe = tribeFilter();
  const monsterList = [...state.roster]
    .filter((owned) => {
      if (tribe !== null && content.monsters.get(owned.monsterId)?.tribe !== tribe) return false;
      const available = owned.count - (otherUse.get(owned.monsterId) ?? 0);
      return party.includes(owned.monsterId) || available > 0;
    })
    .sort((a, b) => {
      if (sort === 'level' && b.level !== a.level) return b.level - a.level;
      if (sort === 'rarity') {
        const diff = ARTIFACT_RARITY_ORDER[content.monsters.get(b.monsterId)!.rarity] - ARTIFACT_RARITY_ORDER[content.monsters.get(a.monsterId)!.rarity];
        if (diff !== 0) return diff;
      }
      return ownedCp(b) - ownedCp(a);
    });

  const tribesOwned = [...new Set(state.roster.map((m) => content.monsters.get(m.monsterId)?.tribe).filter(Boolean))] as Tribe[];

  const monsterChips = monsterList.map((owned) =>
    monsterChip(owned, {
      selected: party.includes(owned.monsterId),
      onclick: () => {
        if (guard()) return;
        if (party.includes(owned.monsterId)) {
          commit(party.filter((id) => id !== owned.monsterId), artifacts, 'tap');
        } else if (party.length >= slots) {
          playSfx('error');
        } else {
          commit([...party, owned.monsterId], artifacts, 'select');
        }
      },
    }),
  );

  // ── 유물 목록 — itemId로 묶어 ×n 표시 (다른 군 연결분 제외) ──
  const otherArtifacts = artifactsUsedByTeams(state, teamId);
  const groups = new Map<string, { free: OwnedArtifact[]; equipped: OwnedArtifact[] }>();
  for (const owned of state.artifacts) {
    if (otherArtifacts.has(owned.uid)) continue;
    const group = groups.get(owned.itemId) ?? { free: [], equipped: [] };
    (artifacts.includes(owned.uid) ? group.equipped : group.free).push(owned);
    groups.set(owned.itemId, group);
  }
  const artifactRows = [...groups.entries()]
    .map(([itemId, group]) => ({ itemId, group, def: content.artifacts.get(itemId)! }))
    .sort((a, b) => ARTIFACT_RARITY_ORDER[b.def.rarity] - ARTIFACT_RARITY_ORDER[a.def.rarity] || a.def.slot.localeCompare(b.def.slot))
    .map(({ itemId, group, def }) => {
      const equipped = group.equipped.length > 0;
      const total = group.free.length + group.equipped.length;
      const best = [...(equipped ? group.equipped : group.free)].sort((a, b) => b.enhance - a.enhance)[0]!;
      const icon = artifactIcon(itemId);
      if (total > 1) icon.append(el('span.micon-count', { title: `보유 ${total}개` }, `×${total}`));
      return el(`button.acard.rar-${def.rarity}${equipped ? '.selected' : ''}`, {
        onclick: () => {
          if (guard()) return;
          if (equipped) {
            commit(party, artifacts.filter((uid) => uid !== group.equipped[0]!.uid), 'tap');
            return;
          }
          // 연결 — 강화 높은 개체 자동, 같은 슬롯은 교체
          const pick = [...group.free].sort((a, b) => b.enhance - a.enhance)[0]!;
          const withoutSameSlot = artifacts.filter((uid) => {
            const other = state.artifacts.find((a) => a.uid === uid);
            return other && content.artifacts.get(other.itemId)?.slot !== def.slot;
          });
          if (withoutSameSlot.length >= 4) {
            playSfx('error');
            return;
          }
          commit(party, [...withoutSameSlot, pick.uid], 'select');
        },
      },
        icon,
        el('div.acard-body', {},
          el('div.acard-name', {}, `${def.name}${best.enhance > 0 ? ` +${best.enhance}` : ''}`),
          el('div.acard-sub', {}, `[${ARTIFACT_RARITY_LABEL[def.rarity]} ${SLOT_LABEL[def.slot]}]`),
        ),
      );
    });

  const shell = sheetShell(`${team.name} 편성`,
    busy ? el('div.card.banner', {}, el('span.small', {}, '🧭 원정에서 돌아오면 편성을 바꿀 수 있습니다')) : null,
    el('div.card.stack-sm', {},
      el('div.list-row', {},
        el('span.small', {}, `몬스터 (${party.length}/${slots})`),
        el('strong.title-cp', {}, party.length > 0 ? `CP ${fmtGold(totalCp)}` : '—'),
      ),
      el('div.party-slots', {}, ...partyCells),
      el('div.list-row', {}, el('span.small', {}, `유물 (${artifacts.length}/4)`)),
      el('div.party-slots', {}, ...artifactCells),
    ),

    // 하단 목록 — 몬스터/유물 탭 분리 (2026-08-23 사용자)
    el('div.chips-wrap.list-tabs', {},
      el(`button.chip${listTab() === 'monster' ? '.active' : ''}`, {
        onclick: () => { playSfx('tap'); listTab.set('monster'); },
      }, `🐾 몬스터 ${monsterList.length}`),
      el(`button.chip${listTab() === 'artifact' ? '.active' : ''}`, {
        onclick: () => { playSfx('tap'); listTab.set('artifact'); },
      }, `💎 유물 ${artifactRows.length}`),
    ),
    ...(listTab() === 'monster'
      ? [
          el('div.pick-controls', {},
            el('div.chips-wrap', {},
              ...(['cp', 'level', 'rarity'] as const).map((s) =>
                el(`button.chip${sort === s ? '.active' : ''}`, { onclick: () => sortMode.set(s) }, SORT_LABEL[s]))),
            tribesOwned.length > 1
              ? el('div.chips-wrap', {},
                  el(`button.chip${tribe === null ? '.active' : ''}`, { onclick: () => tribeFilter.set(null) }, '전체'),
                  ...tribesOwned.map((t) =>
                    el(`button.chip${tribe === t ? '.active' : ''}`, { onclick: () => tribeFilter.set(t) }, `${TRIBE_EMOJI[t]} ${TRIBE_LABEL[t]}`)))
              : null,
          ),
          monsterChips.length === 0
            ? el('div.muted.small', {}, '편성할 수 있는 몬스터가 없습니다 — 다른 군이 카드를 사용 중이면 중복 포획으로 카드를 늘려보세요')
            : el('div.chips', {}, ...monsterChips),
        ]
      : [
          artifactRows.length === 0
            ? el('div.muted.small', {}, '연결할 수 있는 유물이 없습니다 — 원정에서 발굴하거나 다른 군의 연결을 해제해 보세요')
            : el('div.stack-sm', {}, ...artifactRows),
        ]),
  );
  shell.classList.add('sheet-full');
  return shell;
}

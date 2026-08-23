/**
 * 편성 선택 팝업 — 원정 화면의 몬스터·유물 슬롯(+)에서 연다.
 * 탭해서 넣고 빼고, 정렬·필터로 빠르게 찾는다. (2026-08-23)
 */
import { content } from '../content';
import { TRIBES, type Tribe } from '../content/schema';
import { signal } from '../state/signal';
import { save } from '../state/store';
import { artifactCard, monsterChip, ownedCp } from './components';
import { ARTIFACT_RARITY_ORDER, SLOT_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el } from './kit';
import { sheetShell } from './overlays';
import { closeOverlay } from './router';
import { busyUids, effectiveArtifacts, effectiveParty, toggleArtifact, toggleParty } from './screens/expedition';
import { playSfx } from './sfx';

type MonsterSort = 'cp' | 'level' | 'rarity';
type ArtifactSort = 'rarity' | 'enhance' | 'slot';
const MONSTER_SORT_LABEL: Record<MonsterSort, string> = { cp: 'CP순', level: '레벨순', rarity: '등급순' };
const ARTIFACT_SORT_LABEL: Record<ArtifactSort, string> = { rarity: '등급순', enhance: '강화순', slot: '부위순' };
const SLOT_EMOJI: Record<string, string> = { weapon: '🗡️', armor: '🛡️', banner: '🚩', charm: '🧿' };
const SLOT_ORDER = ['weapon', 'armor', 'banner', 'charm'];

const monsterSort = signal<MonsterSort>('cp');
const monsterTribe = signal<Tribe | null>(null);
const artifactSort = signal<ArtifactSort>('rarity');
const artifactSlot = signal<string | null>(null);

/** 팝업을 열 때 정렬·필터를 기본값으로 — 지난 필터가 남아 목록이 비어 보이지 않게 */
export function resetPicks(): void {
  monsterSort.set('cp');
  monsterTribe.set(null);
  artifactSort.set('rarity');
  artifactSlot.set(null);
}

export function partyPickSheet(): HTMLElement {
  const state = save();
  const party = effectiveParty();
  const slots = state.profile.partySlots;
  const busy = busyUids();
  const sort = monsterSort();
  const tribe = monsterTribe();

  const list = [...state.roster]
    .filter((m) => tribe === null || content.monsters.get(m.monsterId)?.tribe === tribe)
    .sort((a, b) => {
      const busyDiff = (busy.has(a.monsterId) ? 1 : 0) - (busy.has(b.monsterId) ? 1 : 0);
      if (busyDiff !== 0) return busyDiff; // 파견 중은 뒤로
      if (sort === 'level' && b.level !== a.level) return b.level - a.level;
      if (sort === 'rarity') {
        const diff = ARTIFACT_RARITY_ORDER[content.monsters.get(b.monsterId)!.rarity] - ARTIFACT_RARITY_ORDER[content.monsters.get(a.monsterId)!.rarity];
        if (diff !== 0) return diff;
      }
      return ownedCp(b) - ownedCp(a); // 기본·동률은 CP 높은순
    });

  const tribesOwned = TRIBES.filter((t) => state.roster.some((m) => content.monsters.get(m.monsterId)?.tribe === t));

  const chips = list.map((owned) =>
    monsterChip(owned, {
      selected: party.includes(owned.monsterId),
      busy: busy.has(owned.monsterId),
      onExpedition: busy.has(owned.monsterId),
      onclick: () => {
        const removing = party.includes(owned.monsterId);
        playSfx(toggleParty(owned.monsterId) ? (removing ? 'tap' : 'select') : 'error');
      },
    }),
  );

  return sheetShell(`파티 편성 (${party.length}/${slots})`,
    el('div.pick-controls', {},
      el('div.chips-wrap', {},
        ...(['cp', 'level', 'rarity'] as const).map((s) =>
          el(`button.chip${sort === s ? '.active' : ''}`, { onclick: () => monsterSort.set(s) }, MONSTER_SORT_LABEL[s]))),
      tribesOwned.length > 1
        ? el('div.chips-wrap', {},
            el(`button.chip${tribe === null ? '.active' : ''}`, { onclick: () => monsterTribe.set(null) }, '전체'),
            ...tribesOwned.map((t) =>
              el(`button.chip${tribe === t ? '.active' : ''}`, { onclick: () => monsterTribe.set(t) }, `${TRIBE_EMOJI[t]} ${TRIBE_LABEL[t]}`)))
        : null,
    ),
    el('div.muted.small', {}, '눌러서 넣고 빼기 · 파견 중(🧭)인 몬스터는 편성할 수 없습니다'),
    chips.length === 0
      ? el('div.muted', {}, state.roster.length === 0 ? '보유 몬스터가 없습니다 — 원정에서 포획해 보세요' : '이 종족의 몬스터가 없습니다')
      : el('div.chips', {}, ...chips),
    el('button.btn.btn-primary.btn-big', { onclick: closeOverlay }, '완료'),
  );
}

export function artifactPickSheet(): HTMLElement {
  const state = save();
  const picked = effectiveArtifacts();
  const busy = busyUids();
  const sort = artifactSort();
  const slotFilter = artifactSlot();

  const list = state.artifacts
    .map((owned) => ({ owned, def: content.artifacts.get(owned.itemId)! }))
    .filter(({ def }) => slotFilter === null || def.slot === slotFilter)
    .sort((a, b) => {
      const busyDiff = (busy.has(a.owned.uid) ? 1 : 0) - (busy.has(b.owned.uid) ? 1 : 0);
      if (busyDiff !== 0) return busyDiff;
      if (sort === 'enhance' && b.owned.enhance !== a.owned.enhance) return b.owned.enhance - a.owned.enhance;
      if (sort === 'slot') {
        const diff = SLOT_ORDER.indexOf(a.def.slot) - SLOT_ORDER.indexOf(b.def.slot);
        if (diff !== 0) return diff;
      }
      return ARTIFACT_RARITY_ORDER[b.def.rarity] - ARTIFACT_RARITY_ORDER[a.def.rarity] || b.owned.enhance - a.owned.enhance;
    });

  const slotsOwned = SLOT_ORDER.filter((s) => state.artifacts.some((a) => content.artifacts.get(a.itemId)?.slot === s));

  const cards = list.map(({ owned, def }) =>
    artifactCard(owned, def, {
      selected: picked.includes(owned.uid),
      busy: busy.has(owned.uid),
      onclick: () => {
        const removing = picked.includes(owned.uid);
        playSfx(toggleArtifact(owned.uid) ? (removing ? 'tap' : 'select') : 'error');
      },
    }),
  );

  return sheetShell(`유물 편성 (${picked.length}/4)`,
    el('div.pick-controls', {},
      el('div.chips-wrap', {},
        ...(['rarity', 'enhance', 'slot'] as const).map((s) =>
          el(`button.chip${sort === s ? '.active' : ''}`, { onclick: () => artifactSort.set(s) }, ARTIFACT_SORT_LABEL[s]))),
      slotsOwned.length > 1
        ? el('div.chips-wrap', {},
            el(`button.chip${slotFilter === null ? '.active' : ''}`, { onclick: () => artifactSlot.set(null) }, '전체'),
            ...slotsOwned.map((s) =>
              el(`button.chip${slotFilter === s ? '.active' : ''}`, { onclick: () => artifactSlot.set(s) }, `${SLOT_EMOJI[s]} ${SLOT_LABEL[s]}`)))
        : null,
    ),
    el('div.muted.small', {}, '눌러서 장착·해제 — 같은 부위는 자동 교체 · 파견 중인 유물은 장착할 수 없습니다'),
    cards.length === 0
      ? el('div.muted', {}, state.artifacts.length === 0 ? '아직 유물이 없습니다 — 원정에서 발굴해 보세요' : '이 부위의 유물이 없습니다')
      : el('div.stack-sm', {}, ...cards),
    el('button.btn.btn-primary.btn-big', { onclick: closeOverlay }, '완료'),
  );
}

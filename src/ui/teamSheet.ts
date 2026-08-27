/**
 * 군 편성 시트 (2026-08-23, 군 시스템) — 상단 편성 슬롯(파티·유물), 하단 보유 목록.
 * 몬스터는 카드 수 기준으로 군 간 배타(다른 군이 다 쓰면 목록에서 숨김),
 * 유물은 같은 종류(itemId)로 묶어 ×n 표시하고 연결 시 강화 높은 개체를 자동 선택한다.
 */
import { content } from '../content';
import { SLOTS, type MonsterRarity, type Slot, type Tribe } from '../content/schema';
import { isExpeditionOut } from '../core/expedition';
import { artifactsUsedByTeams, autoLoadout, speciesUsedByTeams } from '../core/teams';
import * as clock from '../state/clock';
import type { OwnedArtifact } from '../core/types';
import { signal } from '../state/signal';
import { save, setTeam } from '../state/store';
import { artifactCard, artifactIcon, monsterChip, monsterIconBadged, ownedCp } from './components';
import { ARTIFACT_RARITY_LABEL, MONSTER_RARITY_LABEL, RARITY_DESC, RARITY_ORDER, SLOT_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, fmtGold, toast } from './kit';
import { sheetShell } from './overlays';
import { filterChips, tabBar } from './panels';
import { regionTiers, tierShortName } from './regionTiers';
import { playSfx } from './sfx';

type SortMode = 'cp' | 'level';
const SORT_LABEL: Record<SortMode, string> = { cp: 'CP순', level: '레벨순' };
const sortMode = signal<SortMode>('cp');
const tribeFilter = signal<Tribe | null>(null);
const listTab = signal<'monster' | 'artifact'>('monster'); // 하단 목록 탭 (2026-08-23 사용자)
// 216종·96점 규모에 맞춘 분할축 (2026-08-25) — 몬스터는 권역 탭(캠프와 같은 축, 2026-08-27),
// 유물은 슬롯 탭, 공통으로 등급 칩.
// 전부 시그널이어야 한다: 편성은 탭할 때마다 save()가 바뀌어 시트가 통째로 다시 그려지므로,
// DOM 로컬 상태로 두면 몬스터 하나 넣을 때마다 첫 탭으로 튕긴다.
const tierTab = signal<number | null>(null); // null = 렌더 시점에 '최강 몬스터 서식지의 권역'으로 해소
const raritySel = signal<MonsterRarity | null>(null);
const slotTab = signal<Slot | null>(null); // null = 첫 슬롯

/** 편성 시트를 열 때 정렬·필터 초기화 */
export function resetTeamSheet(): void {
  sortMode.set('cp');
  tribeFilter.set(null);
  listTab.set('monster');
  tierTab.set(null);
  raritySel.set(null);
  slotTab.set(null);
}

/**
 * 빈 목록의 사유를 구분한다 — 하나뿐이던 문구("다른 군이 카드를 사용 중이면…")는
 * 필터로 0건일 때 틀린 원인을 말한다.
 */
function emptyMonsterText(inTierCount: number, filtered: boolean): string {
  if (inTierCount > 0 && filtered) return '이 조건에 맞는 몬스터가 없습니다 [등급·종족 칩을 눌러 해제해 보세요]';
  if (inTierCount === 0) return '이 권역의 몬스터를 아직 보유하지 않았습니다 [다른 권역 탭을 보거나 원정으로 포획해 보세요]';
  return '편성할 수 있는 몬스터가 없습니다 [다른 군이 카드를 사용 중이면 중복 포획으로 카드를 늘려보세요]';
}

function emptyArtifactText(ownedCount: number, filtered: boolean): string {
  if (ownedCount > 0 && filtered) return '이 조건에 맞는 유물이 없습니다 [등급 칩을 눌러 해제해 보세요]';
  if (ownedCount > 0) return '이 슬롯의 유물이 없습니다 [다른 슬롯 탭을 확인해 보세요]';
  return '연결할 수 있는 유물이 없습니다 [원정에서 발굴하거나 다른 군의 연결을 해제해 보세요]';
}

export function teamSheet(teamId: string): HTMLElement | null {
  const state = save();
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const busy = state.expeditions.some((e) => isExpeditionOut(e, clock.now()) && e.teamId === teamId);
  const slots = state.profile.partySlots;
  const party = team.partyIds.filter((id) => state.roster.some((m) => m.monsterId === id));
  const artifacts = team.artifactIds.filter((itemId) => state.artifacts.some((a) => a.itemId === itemId));

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
    }, monsterIconBadged(owned, { count: false })); // 편성 슬롯은 카드 수 뱃지를 뺀다 — 편성 마릿수로 오독된다
  });

  const artifactCells = Array.from({ length: 4 }, (_, i) => {
    const itemId = artifacts[i];
    const owned = itemId ? state.artifacts.find((a) => a.itemId === itemId) : null;
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
      onclick: () => { if (!guard()) commit(party, artifacts.filter((id) => id !== owned.itemId), 'tap'); },
    }, icon);
  });

  const totalCp = party.reduce((sum, id) => {
    const owned = state.roster.find((m) => m.monsterId === id);
    return sum + (owned ? ownedCp(owned) : 0);
  }, 0);

  // ── 몬스터 목록 (군 간 배타 — 다른 군이 카드를 다 쓰면 숨김) ──
  // 배타 필터만 건 기준 목록. 탭·칩 카운트는 전부 여기서 센다 —
  // 필터 결과로 세면 종족 칩만 눌러도 상단 '몬스터 (N)'이 줄어든다 (기존 오염).
  const otherUse = speciesUsedByTeams(state, teamId);
  const baseMonsters = [...state.roster].filter((owned) => {
    const available = owned.count - (otherUse.get(owned.monsterId) ?? 0);
    return party.includes(owned.monsterId) || available > 0;
  });

  // 기본 권역 탭 = 보유 몬스터 중 최강의 서식지 권역. 전역 CP 서열을 잃는 것에 대한 보완 —
  // 막 해금해서 0마리인 권역이 기본 탭이 되는 것도 같이 막는다.
  const habitatTier = (monsterId: string): number | undefined => {
    const habitat = content.monsters.get(monsterId)?.habitat;
    return habitat ? content.regions.get(habitat)?.tier : undefined;
  };
  const strongest = [...baseMonsters].sort((a, b) => ownedCp(b) - ownedCp(a))[0];
  const tier = tierTab()
    ?? (strongest ? habitatTier(strongest.monsterId)! : regionTiers[0]!.tier);
  const rarity = raritySel();
  const sort = sortMode();
  const tribe = tribeFilter();

  const inTier = baseMonsters.filter((owned) => habitatTier(owned.monsterId) === tier);
  // 종족 칩은 '이 권역에 실제로 보유한 종족'만 — 전체 로스터 기준이면 누르면 0건인 칩이 생긴다
  const tribesHere = [...new Set(inTier.map((m) => content.monsters.get(m.monsterId)!.tribe))];

  const monsterList = inTier
    .filter((owned) => {
      const def = content.monsters.get(owned.monsterId)!;
      if (tribe !== null && def.tribe !== tribe) return false;
      if (rarity !== null && def.rarity !== rarity) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === 'level' && b.level !== a.level) return b.level - a.level;
      // 편성은 '고르는 화면' — 등급 내림차순이 1차, 그 안에서 CP (2026-08-25 사용자 확정)
      const byRarity = RARITY_ORDER[content.monsters.get(b.monsterId)!.rarity] - RARITY_ORDER[content.monsters.get(a.monsterId)!.rarity];
      if (byRarity !== 0) return byRarity;
      return ownedCp(b) - ownedCp(a);
    });

  const monsterChips = monsterList.map((owned) =>
    monsterChip(owned, {
      selected: party.includes(owned.monsterId),
      busy, // 파견 중엔 눌러도 소용없다 — 에러음만 나던 것을 비활성으로 (2026-08-25)
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

  // ── 유물 목록 — 종 단위 (v6): 개수 배타, 다른 군이 다 쓰면 숨김 ──
  const otherArtifactUse = artifactsUsedByTeams(state, teamId);
  const baseArtifacts = [...state.artifacts]
    .filter((owned) => {
      const available = owned.count - (otherArtifactUse.get(owned.itemId) ?? 0);
      return artifacts.includes(owned.itemId) || available > 0;
    })
    .map((owned) => ({ owned, def: content.artifacts.get(owned.itemId)! }));

  const slot = slotTab() ?? SLOTS[0];
  const artifactList = baseArtifacts
    .filter(({ def }) => def.slot === slot && (rarity === null || def.rarity === rarity))
    // 등급 내림차순 → 강화 높은 순 (슬롯은 탭이 이미 갈랐다)
    .sort((a, b) => RARITY_ORDER[b.def.rarity] - RARITY_ORDER[a.def.rarity] || b.owned.enhance - a.owned.enhance);

  // 탭 숫자는 "지금 새로 배정 가능한" 수만 — 이미 이 군에 편성/장착된 것은 제외 (2026-08-23 사용자)
  const assignableMonsters = baseMonsters.filter((owned) => !party.includes(owned.monsterId)).length;
  const assignableArtifacts = baseArtifacts.filter(({ owned }) => !artifacts.includes(owned.itemId)).length;

  const artifactRows = artifactList.map(({ owned, def }) =>
    artifactCard(owned, def, {
      selected: artifacts.includes(owned.itemId),
      busy,
      onclick: () => {
        if (guard()) return;
        if (artifacts.includes(owned.itemId)) {
          commit(party, artifacts.filter((id) => id !== owned.itemId), 'tap');
          return;
        }
        // 연결 — 같은 슬롯은 교체. 슬롯이 4종뿐이고 코어가 슬롯 중복을 막으므로
        // 교체 후 개수는 항상 3 이하다 (기존의 >= 4 가드는 도달 불가라 삭제, 2026-08-25)
        const withoutSameSlot = artifacts.filter((id) => {
          const other = state.artifacts.find((a) => a.itemId === id);
          return other && content.artifacts.get(other.itemId)?.slot !== def.slot;
        });
        commit(party, [...withoutSameSlot, owned.itemId], 'select');
      },
    }));

  const shell = sheetShell(`${team.name} 편성`,
    busy ? el('div.card.banner', {}, el('span.small', {}, '🧭 원정에서 돌아오면 편성을 바꿀 수 있습니다')) : null,
    el('div.card.stack-sm', {},
      el('div.list-row', {},
        el('span.small', {}, `몬스터 (${party.length}/${slots})`),
        el('div.row-gap', {},
          el('button.btn.btn-ghost.auto-btn', {
            disabled: busy,
            title: '몬스터는 CP 높은 순, 유물은 등급·강화 순으로 자동 편성',
            onclick: () => {
              if (guard()) return;
              const auto = autoLoadout(content, save(), teamId);
              if (setTeam(teamId, auto.partyIds, auto.artifactIds)) {
                playSfx('select');
                toast('⚡ 자동 편성 [몬스터 CP순 · 유물 등급순]', 'ok');
              }
            },
          }, '⚡ 자동'),
          el('strong.title-cp', {}, party.length > 0 ? `CP ${fmtGold(totalCp)}` : '—'),
        ),
      ),
      el('div.party-slots', {}, ...partyCells),
      el('div.list-row', {}, el('span.small', {}, `유물 (${artifacts.length}/4)`)),
      el('div.party-slots', {}, ...artifactCells),
    ),

    // 하단 목록 — 탭 2줄(몬스터·유물 / 지역·슬롯) + 등급 칩을 sticky로 묶는다.
    // 지역 한 칸이 1,900px을 넘으므로 sticky가 없으면 탭을 바꿀 때마다 맨 위로 올라와야 한다.
    el('div.sheet-sticky', {},
      tabBar(
        [
          { key: 'monster' as const, label: `몬스터 (${assignableMonsters})` },
          { key: 'artifact' as const, label: `유물 (${assignableArtifacts})` },
        ],
        { active: listTab(), onPick: (key) => listTab.set(key) },
      ),
      // 2차 분할축 — 몬스터는 서식 권역(캠프와 같은 축), 유물은 장착 슬롯 (상단 유물 4칸과 1:1이라 교체 규칙이 설명 없이 읽힌다)
      listTab() === 'monster'
        ? tabBar(
            regionTiers.map(({ tier: t, regions }) => ({
              key: String(t),
              label: `${regions[0]!.icon} ${tierShortName(regions)} ${baseMonsters.filter((m) => habitatTier(m.monsterId) === t).length}`,
              title: `${regions[0]!.name} 권역`,
            })),
            { active: String(tier), onPick: (key) => tierTab.set(Number(key)) },
          )
        : tabBar(
            SLOTS.map((s) => ({
              key: s,
              label: `${SLOT_LABEL[s]} ${baseArtifacts.filter(({ def }) => def.slot === s).length}`,
            })),
            { active: slot, onPick: (key) => slotTab.set(key) },
          ),
      // 등급 칩 — 몬스터·유물 공통. 내림차순(전설→일반)이 '고르는 화면'의 규칙
      filterChips(
        RARITY_DESC.map((r) => ({ key: r, label: MONSTER_RARITY_LABEL[r], cls: `rar-${r}` })),
        { active: rarity, onPick: (v) => raritySel.set(v) },
      ),
    ),
    // 정렬·종족은 한 번 정해두는 축이라 sticky 밖에 — 안에 넣으면 2줄로 감겨 sticky가 198px까지 커지고
    // 목록이 보이는 높이를 그만큼 먹는다 (등급 축은 위 칩이 담당하므로 등급순 정렬은 삭제)
    listTab() === 'monster'
      ? el('div.chips-wrap', {},
          ...(['cp', 'level'] as const).map((s) =>
            el(`button.chip${sort === s ? '.active' : ''}`, {
              onclick: () => { playSfx('tap'); sortMode.set(s); },
            }, SORT_LABEL[s])),
          ...(tribesHere.length > 1
            ? tribesHere.map((t) =>
                el(`button.chip${tribe === t ? '.active' : ''}`, {
                  onclick: () => { playSfx('tap'); tribeFilter.set(tribe === t ? null : t); },
                  title: TRIBE_LABEL[t],
                }, TRIBE_EMOJI[t]))
            : []),
        )
      : null,
    ...(listTab() === 'monster'
      ? [
          monsterChips.length === 0
            ? el('div.muted.small', {}, emptyMonsterText(inTier.length, rarity !== null || tribe !== null))
            : el('div.chips', {}, ...monsterChips),
        ]
      : [
          artifactRows.length === 0
            ? el('div.muted.small', {}, emptyArtifactText(baseArtifacts.length, rarity !== null))
            : el('div.stack-sm', {}, ...artifactRows),
        ]),
  );
  shell.classList.add('sheet-full');
  return shell;
}

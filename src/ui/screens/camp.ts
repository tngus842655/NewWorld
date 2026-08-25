/**
 * 캠프 — 몬스터 관리(레벨·각성), 유물 인벤토리(강화·분해), 미끼 제작, 지갑.
 * 설정·세이브 관리는 설정 탭으로 분리 (2026-08-23).
 */
import { content } from '../../content';
import { SLOTS, type MonsterRarity, type Slot } from '../../content/schema';
import { isRegionUnlocked, nextPartySlotUnlock } from '../../core/progression';
import { signal } from '../../state/signal';
import { buySlot, craft, save } from '../../state/store';
import { resetArtifactFusion } from '../artifactFusionSheet';
import { artifactCard, monsterChip, ownedCp } from '../components';
import { MONSTER_RARITY_LABEL, RARITY_DESC, RARITY_ORDER, SLOT_LABEL, el, fmtGold } from '../kit';
import { FUSION_NEXT, resetFusion } from '../fusionSheet';
import { filterChips, tabBar } from '../panels';
import { overlay } from '../router';
import { playSfx } from '../sfx';

// 상단 재료 설명(터치 토글) — 화면을 오가도 세션 동안 유지
const selMaterialId = signal<string | null>(null);
/**
 * 216종·96점 규모에 맞춘 분할 (2026-08-25) — 접힘 카드를 탭으로 교체.
 * 최상위는 몬스터/유물/제작 3탭, 그 안에서 몬스터는 지역, 유물은 슬롯, 공통으로 등급 칩.
 * 편성 시트와 같은 축이라 두 화면을 오갈 때 같은 근육 기억이 통한다.
 * 화면은 save() 변경마다 통째로 다시 그려지므로 상태는 반드시 시그널이어야 한다.
 */
const campTab = signal<'monster' | 'artifact' | 'craft'>('monster');
const campRegion = signal<string | null>(null); // null = 최강 몬스터의 서식지
const campRarity = signal<MonsterRarity | null>(null);
const campSlot = signal<Slot | null>(null);

export function renderCamp(): HTMLElement {
  const state = save();
  const busyIds = new Set(state.expeditions.filter((e) => !e.claimed).flatMap((e) => e.partyIds));
  const tab = campTab();
  const rarity = campRarity();

  // ── 몬스터: 지역 탭 + 등급 칩 ──
  // 캠프는 '키울 놈 고르는 화면' — 등급 내림차순 (읽는 화면인 정보 시트·도감은 오름차순, 2026-08-25 사용자 확정)
  const strongest = [...state.roster].sort((a, b) => ownedCp(b) - ownedCp(a))[0];
  const region = campRegion()
    ?? (strongest ? content.monsters.get(strongest.monsterId)!.habitat : content.regionList[0]!.id);
  const inRegion = state.roster.filter((m) => content.monsters.get(m.monsterId)?.habitat === region);
  const rosterList = inRegion
    .filter((m) => rarity === null || content.monsters.get(m.monsterId)!.rarity === rarity)
    .sort((a, b) =>
      RARITY_ORDER[content.monsters.get(b.monsterId)!.rarity] - RARITY_ORDER[content.monsters.get(a.monsterId)!.rarity]
      || ownedCp(b) - ownedCp(a));

  // ── 유물: 슬롯 탭 + 등급 칩 ──
  const slot = campSlot() ?? SLOTS[0];
  const artifactList = state.artifacts
    .map((owned) => ({ owned, def: content.artifacts.get(owned.itemId) }))
    .filter((entry): entry is { owned: typeof entry.owned; def: NonNullable<typeof entry.def> } => entry.def !== undefined)
    .filter(({ def }) => def.slot === slot && (rarity === null || def.rarity === rarity))
    .sort((a, b) => RARITY_ORDER[b.def.rarity] - RARITY_ORDER[a.def.rarity] || b.owned.enhance - a.owned.enhance);

  const recipes = [...content.recipes.values()].map((recipe) => {
    // 부족한 항목이 보이게 — 비용 나열에 보유량 병기, 부족하면 제작 버튼 비활성
    const goldShort = state.wallet.gold < recipe.cost.gold;
    const materialShorts = Object.entries(recipe.cost.materials)
      .filter(([id, n]) => (state.wallet.materials[id] ?? 0) < n);
    const affordable = !goldShort && materialShorts.length === 0;
    const costText = [
      recipe.cost.gold > 0 ? `골드 ${fmtGold(recipe.cost.gold)}` : null,
      ...Object.entries(recipe.cost.materials).map(([id, n]) => {
        const material = content.materials.get(id);
        const have = state.wallet.materials[id] ?? 0;
        // 부족분은 '보유/필요'로 압축 — "(보유 n)" 병기는 좁은 화면에서 줄바꿈됨 (2026-08-23)
        return have < n ? `${material?.icon ?? ''}${material?.name} ${have}/${n}` : `${material?.icon ?? ''}${material?.name} ×${n}`;
      }),
    ].filter(Boolean).join(' + ');
    return el('div.list-row', {},
      el('div', {},
        el('div', {}, `${recipe.name} → 미끼 ${recipe.output.lures}개`),
        el(`div.muted.small${affordable ? '' : '.cost-short'}`, {}, costText),
      ),
      el('button.btn.btn-ghost', {
        disabled: !affordable,
        onclick: () => { if (craft(recipe.id)) playSfx('craft'); },
      }, '제작'),
    );
  });

  // 지역 재료 — 상단 앱바 지갑과 중복되던 재화 카드 대신, 재료를 아이콘 한 줄로 (해금 지역은 0 포함)
  const shownMaterialIds = new Set<string>();
  for (const region of content.regions.values()) {
    if (isRegionUnlocked(content, state, region.id)) region.materials.forEach((id) => shownMaterialIds.add(id));
  }
  for (const [id, count] of Object.entries(state.wallet.materials)) {
    if (count > 0) shownMaterialIds.add(id); // 미해금 지역 재료도 보유분이 있으면 표시
  }
  const selMaterial = selMaterialId();
  const materialChips = [...content.materials.values()]
    .filter((material) => shownMaterialIds.has(material.id))
    .map((material) =>
      el(`button.wallet-item${selMaterial === material.id ? '.active' : ''}`, {
        title: material.name,
        onclick: () => { playSfx('tap'); selMaterialId.set(selMaterial === material.id ? null : material.id); },
      }, `${material.icon} ${state.wallet.materials[material.id] ?? 0}`),
    );

  // 터치한 재료의 이름·설명·쓰임을 아이콘 줄 바로 아래 말풍선으로 (쓰임은 레시피·해금 조건에서 도출)
  const tipMaterial = selMaterial ? content.materials.get(selMaterial) : null;
  const materialTip = tipMaterial && shownMaterialIds.has(tipMaterial.id)
    ? (() => {
        const region = content.regions.get(tipMaterial.region);
        const uses = [
          ...[...content.recipes.values()]
            .filter((recipe) => (recipe.cost.materials[tipMaterial.id] ?? 0) > 0)
            .map((recipe) => `${recipe.name} 제작`),
          ...content.regionList
            .filter((r) => (r.unlock.materials?.[tipMaterial.id] ?? 0) > 0)
            .map((r) => `${r.icon} ${r.name} 해금`),
        ];
        return el('div.wallet-tip', {},
          el('div.wallet-tip-title', {},
            `${tipMaterial.icon} ${tipMaterial.name}`,
            el('span.muted.small', {}, `  ${region?.icon ?? ''} ${region?.name ?? ''} · 보유 ${state.wallet.materials[tipMaterial.id] ?? 0}`),
          ),
          el('div.small.muted', {}, tipMaterial.desc),
          uses.length > 0 ? el('div.small.wallet-tip-use', {}, `쓰임 [${uses.join(' · ')}]`) : null,
        );
      })()
    : null;

  const slotUnlock = nextPartySlotUnlock(content, state);

  // 합성 여분 — 합성 가능 등급(다음 등급이 있는 등급)만. 최상위 등급은 재료가 될 수 없다 (2026-08-25)
  const spareCards = state.roster.reduce((sum, m) => {
    const r = content.monsters.get(m.monsterId)?.rarity;
    return sum + (r && FUSION_NEXT[r] !== null ? Math.max(0, m.count - 1) : 0);
  }, 0);
  const spareArtifacts = state.artifacts.reduce((sum, a) => {
    const r = content.artifacts.get(a.itemId)?.rarity;
    return sum + (r && FUSION_NEXT[r] !== null ? Math.max(0, a.count - 1) : 0);
  }, 0);

  // 합성 한 번에 필요한 재료 수 — 여분이 이만큼 모여야 실제로 돌릴 수 있다
  const fusionCost = content.balance.fusion.materials;
  const canFuse = spareCards >= fusionCost || spareArtifacts >= fusionCost;

  const rarityChipRow = filterChips(
    RARITY_DESC.map((r) => ({ key: r, label: MONSTER_RARITY_LABEL[r], cls: `rar-${r}` })),
    { active: rarity, onPick: (v) => campRarity.set(v) },
  );

  const monsterPanel = [
    // 지역 탭은 4개 고정 — 진행도에 따라 탭이 생겼다 사라지면 근육 기억이 깨진다
    tabBar(
      content.regionList.map((r) => ({
        key: r.id,
        label: `${r.icon} ${r.name.split(' ').pop()} ${state.roster.filter((m) => content.monsters.get(m.monsterId)?.habitat === r.id).length}`,
        title: r.name,
      })),
      { active: region, onPick: (key) => campRegion.set(key) },
    ),
    rarityChipRow,
    rosterList.length > 0
      ? el('div.stack-sm', {}, ...rosterList.map((o) => monsterChip(o, {
          onclick: () => overlay.set({ kind: 'monster', monsterId: o.monsterId }),
          onExpedition: busyIds.has(o.monsterId),
        })))
      : el('div.card', {}, el('span.muted.small', {},
          inRegion.length > 0
            ? '이 등급의 몬스터가 없습니다 [등급 칩을 눌러 해제해 보세요]'
            : '이 지역의 몬스터를 아직 보유하지 않았습니다 [원정에서 포획해 보세요]')),
    slotUnlock
      ? (() => {
          const captured = Object.values(state.codex).filter((c) => c.captured).length;
          const canBuy = captured >= slotUnlock.totalCaptured && state.wallet.gold >= slotUnlock.gold;
          return el('div.card.list-row', {},
            el('span.muted.small', {},
              `파티 슬롯 ${state.profile.partySlots} → ${slotUnlock.slots} (도감 ${Math.min(captured, slotUnlock.totalCaptured)}/${slotUnlock.totalCaptured}종 + 골드 ${fmtGold(slotUnlock.gold)})`),
            el('button.btn.btn-ghost', {
              disabled: !canBuy,
              onclick: () => { if (buySlot()) playSfx('confirm'); },
            }, '확장'),
          );
        })()
      : null,
  ];

  const artifactPanel = [
    // 슬롯 탭 — 편성 시트의 유물 탭과 같은 축
    tabBar(
      SLOTS.map((s) => ({
        key: s,
        label: `${SLOT_LABEL[s]} ${state.artifacts.filter((a) => content.artifacts.get(a.itemId)?.slot === s).length}`,
      })),
      { active: slot, onPick: (key) => campSlot.set(key) },
    ),
    rarityChipRow,
    artifactList.length > 0
      ? el('div.stack-sm', {}, ...artifactList.map(({ owned, def }) =>
          artifactCard(owned, def, { onclick: () => overlay.set({ kind: 'artifact', itemId: owned.itemId }) })))
      : el('div.card', {}, el('span.muted.small', {},
          state.artifacts.length > 0
            ? '이 조건의 유물이 없습니다 [다른 슬롯 탭이나 등급 칩을 확인해 보세요]'
            : '원정에서 발굴한 유물이 여기 모입니다')),
  ];

  // 제작 탭 = 만드는 것 전부 (2026-08-25 사용자) — 합성 진입 2종을 몬스터·유물 목록 끝에서 여기로 옮겼다.
  // 목록 탭은 '보고 고르는 곳', 제작 탭은 '만드는 곳'으로 역할이 갈린다.
  const craftPanel = [
    el('h2.section-title', {}, '합성'),
    el('div.card', {},
      el('div.list-row', {},
        el('span', {}, `🧬 카드 합성 [여분 카드 ${spareCards}장]`),
        el('button.btn.btn-ghost', {
          disabled: spareCards < fusionCost,
          onclick: () => { resetFusion(); overlay.set({ kind: 'fusion' }); },
        }, '열기'),
      ),
      el('div.list-row', {},
        el('span', {}, `💠 유물 합성 [여분 ${spareArtifacts}개]`),
        el('button.btn.btn-ghost', {
          disabled: spareArtifacts < fusionCost,
          onclick: () => { resetArtifactFusion(); overlay.set({ kind: 'artifactFusion' }); },
        }, '열기'),
      ),
    ),
    el('h2.section-title', {}, '미끼 제작'),
    el('div.card.wallet', {},
      ...(materialChips.length > 0
        ? materialChips
        : [el('span.muted.small', {}, '지역 재료는 원정의 채집·갈림길에서 모입니다')]),
      materialTip,
    ),
    el('div.card', {}, ...recipes),
  ];

  return el('div.screen', {},
    // 골드·가루는 캠프 액션 4종(레벨업·각성·제작·슬롯 확장)의 공통 관문인데 홈에만 있었다 (2026-08-25)
    el('div.card.wallet', {},
      el('span.wallet-item', {}, `💰 ${fmtGold(state.wallet.gold)}`),
      el('span.wallet-item', {}, `✨ ${fmtGold(state.wallet.dust)}`),
    ),
    tabBar(
      [
        { key: 'monster' as const, label: `몬스터 (${state.roster.length})` },
        { key: 'artifact' as const, label: `유물 (${state.artifacts.length})` },
        // 제작 탭만 수치가 없어 발견성이 떨어진다 — 지금 합성이 가능하면 점으로 알린다 (2026-08-25 사용자).
        // '보유 여분이 있다'가 아니라 '실제로 한 번 돌릴 수 있다'가 기준 (재료 수를 채워야 한다)
        { key: 'craft' as const, label: '제작', dot: canFuse },
      ],
      { active: tab, onPick: (key) => campTab.set(key) },
    ),
    ...(tab === 'monster' ? monsterPanel : tab === 'artifact' ? artifactPanel : craftPanel),
  );
}

/**
 * 캠프 — 몬스터 관리(레벨·각성), 유물 인벤토리(강화), 미끼 제작, 지갑.
 * 설정·세이브 관리는 설정 탭으로 분리 (2026-08-23).
 */
import { content } from '../../content';
import { SLOTS, type MonsterRarity, type Slot } from '../../content/schema';
import { isExpeditionOut } from '../../core/expedition';
import { isRegionUnlocked, nextPartySlotUnlock } from '../../core/progression';
import * as clock from '../../state/clock';
import { signal } from '../../state/signal';
import { buySlot, craft, save } from '../../state/store';
import { resetArtifactFusion } from '../artifactFusionSheet';
import { artifactCard, monsterChip, ownedCp } from '../components';
import { MONSTER_RARITY_LABEL, RARITY_DESC, RARITY_ORDER, SLOT_LABEL, el, fmtGold, fmtRemain } from '../kit';
import { FUSION_NEXT, resetFusion } from '../fusionSheet';
import { accountBonusState } from '../../core/accountBonus';
import { filterChips, tabBar } from '../panels';
import { regionTiers, tierShortName } from '../regionTiers';
import { overlay } from '../router';
import { playSfx } from '../sfx';

// 상단 재료 설명(터치 토글) — 화면을 오가도 세션 동안 유지
const selMaterialId = signal<string | null>(null);
/**
 * 216종·96점 규모에 맞춘 분할 (2026-08-25) — 접힘 카드를 탭으로 교체.
 * 최상위는 몬스터/유물/제작 3탭, 그 안에서 몬스터는 권역, 유물은 슬롯, 공통으로 등급 칩.
 * (지역 축은 12지역 개편으로 소지역 12탭이 뭉개져 권역 4탭으로 — 소지역은 아이콘의
 * 서식지 뱃지가 구분하고, 등급 내림차순 정렬이 우선순위를 잡는다. 2026-08-27)
 * 편성 시트와 같은 축이라 두 화면을 오갈 때 같은 근육 기억이 통한다.
 * 화면은 save() 변경마다 통째로 다시 그려지므로 상태는 반드시 시그널이어야 한다.
 */
const campTab = signal<'monster' | 'artifact' | 'craft'>('monster');
const campTier = signal<number | null>(null); // null = 최강 몬스터 서식지의 권역
const campRarity = signal<MonsterRarity | null>(null);
const campSlot = signal<Slot | null>(null);

export function renderCamp(): HTMLElement {
  const state = save();
  const busyIds = new Set(state.expeditions.filter((e) => isExpeditionOut(e, clock.now())).flatMap((e) => e.partyIds));
  const tab = campTab();
  const rarity = campRarity();

  // ── 몬스터: 권역 탭 + 등급 칩 ──
  // 캠프는 '키울 놈 고르는 화면' — 등급 내림차순 (읽는 화면인 정보 시트·도감은 오름차순, 2026-08-25 사용자 확정)
  const habitatTier = (monsterId: string): number | undefined => {
    const habitat = content.monsters.get(monsterId)?.habitat;
    return habitat ? content.regions.get(habitat)?.tier : undefined;
  };
  const strongest = [...state.roster].sort((a, b) => ownedCp(b) - ownedCp(a))[0];
  const tier = campTier()
    ?? (strongest ? habitatTier(strongest.monsterId)! : regionTiers[0]!.tier);
  const inTier = state.roster.filter((m) => habitatTier(m.monsterId) === tier);
  const rosterList = inTier
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

  const canAfford = (recipe: { cost: { gold: number; materials: Record<string, number> } }): boolean =>
    state.wallet.gold >= recipe.cost.gold
    && Object.entries(recipe.cost.materials).every(([id, n]) => (state.wallet.materials[id] ?? 0) >= n);

  /**
   * 아직 잠긴 지역이 요구하는 재료 수량 (재료 id → 필요 개수).
   * 제작과 지역 해금이 **같은 재료 풀을 공유**해서, 모르고 만들다 보면 해금이 밀린다
   * (시뮬 실측: 모래시계를 계속 세공하면 화산 해금이 D7 → D19). 막지는 않고 알려만 준다 —
   * 지금 시간을 벌지 나중에 문을 열지는 유저가 고를 문제다.
   */
  const unlockReserve = new Map<string, { need: number; region: string }>();
  for (const region of content.regionList) {
    if (isRegionUnlocked(content, state, region.id)) continue;
    for (const [materialId, need] of Object.entries(region.unlock.materials ?? {})) {
      const prev = unlockReserve.get(materialId);
      if (!prev || need > prev.need) unlockReserve.set(materialId, { need, region: `${region.icon} ${region.name}` });
    }
  }
  /** 이 레시피를 만들면 해금 예약분을 깎는가 — 깎는 재료들의 안내 문구 */
  const reserveWarning = (recipe: { cost: { materials: Record<string, number> } }): string | null => {
    const hits: string[] = [];
    let regionLabel = '';
    for (const [materialId, count] of Object.entries(recipe.cost.materials)) {
      const reserve = unlockReserve.get(materialId);
      if (!reserve) continue;
      const have = state.wallet.materials[materialId] ?? 0;
      if (have - count >= reserve.need) continue; // 만들어도 해금분이 남는다
      // "보유/필요"로 쓰면 충족된 것처럼 읽힌다 — 만든 **뒤**의 수량을 보여준다
      hits.push(`${content.materials.get(materialId)?.icon ?? ''}${have - count}/${reserve.need}`);
      regionLabel = reserve.region;
    }
    return hits.length > 0 ? `🔒 만들면 ${regionLabel} 해금분이 모자랍니다 (제작 후 ${hits.join(' · ')})` : null;
  };

  const recipeRow = (recipe: (typeof content.recipes) extends ReadonlyMap<string, infer R> ? R : never) => {
    // 부족한 항목이 보이게 — 비용 나열에 보유량 병기, 부족하면 제작 버튼 비활성
    const affordable = canAfford(recipe);
    const costText = [
      recipe.cost.gold > 0 ? `골드 ${fmtGold(recipe.cost.gold)}` : null,
      ...Object.entries(recipe.cost.materials).map(([id, n]) => {
        const material = content.materials.get(id);
        const have = state.wallet.materials[id] ?? 0;
        // 부족분은 '보유/필요'로 압축 — "(보유 n)" 병기는 좁은 화면에서 줄바꿈됨 (2026-08-23)
        return have < n ? `${material?.icon ?? ''}${material?.name} ${have}/${n}` : `${material?.icon ?? ''}${material?.name} ×${n}`;
      }),
    ].filter(Boolean).join(' + ');
    // 산출 표기 — 모래시계는 등급색 이름 + 총 단축 시간을 병기한다 (몇 분을 버는지가 판단 기준)
    const out = recipe.output;
    const outLabel = out.kind === 'lures'
      ? el('span', {}, `미끼 ${out.count}개`)
      : (() => {
          const def = content.hourglasses.get(out.hourglassId);
          const total = (def?.minutes ?? 0) * out.count;
          return el('span', {},
            el(`span.rar-name.rar-${def?.rarity ?? 'common'}`, {}, def?.name ?? out.hourglassId),
            ` ${out.count}개`,
            el('span.muted.small', {}, ` [총 ${fmtRemain(total * 60_000)} 단축]`),
          );
        })();
    const warning = affordable ? reserveWarning(recipe) : null; // 못 만드는 레시피엔 경고가 무의미
    return el('div.list-row', {},
      el('div', {},
        el('div', {}, `${recipe.name} → `, outLabel),
        el(`div.muted.small${affordable ? '' : '.cost-short'}`, {}, costText),
        warning ? el('div.small.cost-reserve', {}, warning) : null,
      ),
      el('button.btn.btn-ghost', {
        disabled: !affordable,
        onclick: () => { if (craft(recipe.id)) playSfx('craft'); },
      }, '제작'),
    );
  };
  // 산출 종류로 나눈다 — 섹션 제목이 내용과 맞아야 한다 (2026-08-25)
  const allRecipes = [...content.recipes.values()];
  const lureRecipes = allRecipes.filter((r) => r.output.kind === 'lures').map(recipeRow);
  const hourglassRecipes = allRecipes.filter((r) => r.output.kind === 'hourglass').map(recipeRow);

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
  // 제작 탭 알림 점은 카드·유물 합성 가능일 때만 (2026-08-30 사용자) — 미끼·모래시계는
  // 재료만 있으면 늘 만들 수 있어 점이 상시 켜진 것과 같아진다 (알림 가치 0)
  const canFuse = spareCards >= fusionCost || spareArtifacts >= fusionCost;

  const rarityChipRow = filterChips(
    RARITY_DESC.map((r) => ({ key: r, label: MONSTER_RARITY_LABEL[r], cls: `rar-${r}` })),
    { active: rarity, onPick: (v) => campRarity.set(v) },
  );

  const monsterPanel = [
    // 권역 탭은 4개 고정 — 진행도에 따라 탭이 생겼다 사라지면 근육 기억이 깨진다
    tabBar(
      regionTiers.map(({ tier: t, regions }) => ({
        key: String(t),
        label: `${regions[0]!.icon} ${tierShortName(regions)} ${state.roster.filter((m) => habitatTier(m.monsterId) === t).length}`,
        title: `${regions[0]!.name} 권역`,
      })),
      { active: String(tier), onPick: (key) => campTier.set(Number(key)) },
    ),
    rarityChipRow,
    rosterList.length > 0
      ? el('div.stack-sm', {}, ...rosterList.map((o, index) => {
          const chip = monsterChip(o, {
            onclick: () => overlay.set({ kind: 'monster', monsterId: o.monsterId }),
            onExpedition: busyIds.has(o.monsterId),
          });
          if (index === 0) chip.dataset['tour'] = 'camp-monster'; // 온보딩 투어 — 첫 몬스터 열기
          return chip;
        }))
      : el('div.card', {}, el('span.muted.small', {},
          inTier.length > 0
            ? '이 등급의 몬스터가 없습니다 [등급 칩을 눌러 해제해 보세요]'
            : '이 권역의 몬스터를 아직 보유하지 않았습니다 [원정에서 포획해 보세요]')),
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
    // 재료 지갑은 두 제작 섹션의 공통 재원이라 위에 한 번만
    el('h2.section-title', {}, '제작 재료'),
    el('div.card.wallet', {},
      ...(materialChips.length > 0
        ? materialChips
        : [el('span.muted.small', {}, '지역 재료는 원정의 채집·갈림길에서 모입니다')]),
      materialTip,
    ),
    el('h2.section-title', {}, '미끼 제작'),
    el('div.card', {}, ...lureRecipes),
    el('h2.section-title', {}, '모래시계 세공'),
    el('div.card', {}, ...hourglassRecipes),
  ];

  // 영구 보너스 진입 카드 (GDD §4.6) — 육성 총량의 킥을 캠프 입구에서 보여준다
  const bonus = accountBonusState(content, state);
  return el('div.screen', {},
    el('button.card.bonus-entry', { // 가운데 정렬 (2026-08-25 사용자)
      title: '몬스터 레벨·각성, 유물 강화 총량에 따른 계정 영구 보너스',
      onclick: () => overlay.set({ kind: 'accountBonus' }),
    },
      el('span.small', {}, '🎖 영구 보너스'),
      el('span.muted.small', {},
        `🐾 조련 ${bonus.training.active}/${bonus.training.tiers.length} · 🔮 공명 ${bonus.resonance.active}/${bonus.resonance.tiers.length}`),
    ),
    tabBar(
      [
        { key: 'monster' as const, label: `몬스터 (${state.roster.length})` },
        { key: 'artifact' as const, label: `유물 (${state.artifacts.length})` },
        // 제작 탭만 수치가 없어 발견성이 떨어진다 — 합성(카드·유물) 가능일 때만 점 (2026-08-30 사용자)
        { key: 'craft' as const, label: '제작', dot: canFuse },
      ],
      { active: tab, onPick: (key) => campTab.set(key) },
    ),
    ...(tab === 'monster' ? monsterPanel : tab === 'artifact' ? artifactPanel : craftPanel),
  );
}

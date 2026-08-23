/**
 * 캠프 — 몬스터 관리(레벨·각성), 유물 인벤토리(강화·분해), 미끼 제작, 지갑.
 * 설정·세이브 관리는 설정 탭으로 분리 (2026-08-23).
 */
import { content } from '../../content';
import { isRegionUnlocked, nextPartySlotUnlock } from '../../core/progression';
import { signal } from '../../state/signal';
import { buySlot, craft, save } from '../../state/store';
import { artifactCard, monsterChip, ownedCp } from '../components';
import { ARTIFACT_RARITY_ORDER, el, fmtGold } from '../kit';
import { resetFusion } from '../fusionSheet';
import { overlay } from '../router';
import { playSfx } from '../sfx';

// 상단 재료 설명(터치 토글)·지역별 몬스터 접힘 상태 — 화면을 오가도 세션 동안 유지
const selMaterialId = signal<string | null>(null);
const openRegions = signal<Record<string, boolean>>({});

export function renderCamp(): HTMLElement {
  const state = save();
  const busyIds = new Set(state.expeditions.filter((e) => !e.claimed).flatMap((e) => e.partyIds));

  // 몬스터는 지역별 카드로 — 기본은 접힘(가로 슬라이드 1줄), 펼치면 전체 그리드
  const rosterCards = content.regionList
    .map((region) => ({
      region,
      owned: state.roster
        .filter((m) => content.monsters.get(m.monsterId)?.habitat === region.id)
        .sort((a, b) =>
          ARTIFACT_RARITY_ORDER[content.monsters.get(b.monsterId)!.rarity] - ARTIFACT_RARITY_ORDER[content.monsters.get(a.monsterId)!.rarity]
          || ownedCp(b) - ownedCp(a)),
    }))
    .filter(({ owned }) => owned.length > 0)
    .map(({ region, owned }) => {
      const open = openRegions()[region.id] === true;
      const chips = owned.map((o) => monsterChip(o, {
        onclick: () => overlay.set({ kind: 'monster', monsterId: o.monsterId }),
        onExpedition: busyIds.has(o.monsterId),
      }));
      return el('div.card.stack-sm', {},
        el('button.roster-head', {
          onclick: () => {
            playSfx('tap');
            openRegions.set({ ...openRegions(), [region.id]: !open });
          },
        },
          el('span', {}, `${region.icon} ${region.name} (${owned.length})`),
          el('span.muted.small', {}, open ? '접기 ∧' : '펼치기 ∨'),
        ),
        open ? el('div.chips', {}, ...chips) : el('div.roster-row', {}, ...chips),
      );
    });

  const artifacts = [...state.artifacts]
    .map((owned) => ({ owned, def: content.artifacts.get(owned.itemId)! }))
    .sort((a, b) => ARTIFACT_RARITY_ORDER[b.def.rarity] - ARTIFACT_RARITY_ORDER[a.def.rarity] || a.def.slot.localeCompare(b.def.slot))
    .map(({ owned, def }) => artifactCard(owned, def, { onclick: () => overlay.set({ kind: 'artifact', uid: owned.uid }) }));

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
        return `${material?.icon ?? ''}${material?.name} ×${n}${have < n ? ` (보유 ${have})` : ''}`;
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
          uses.length > 0 ? el('div.small.wallet-tip-use', {}, `쓰임 — ${uses.join(' · ')}`) : null,
        );
      })()
    : null;

  const slotUnlock = nextPartySlotUnlock(content, state);

  return el('div.screen', {},
    el('div.card.wallet', {},
      ...(materialChips.length > 0
        ? materialChips
        : [el('span.muted.small', {}, '지역 재료는 원정의 채집·갈림길에서 모입니다')]),
      materialTip,
    ),

    el('h2.section-title', {}, `몬스터 (${state.roster.length})`),
    ...(rosterCards.length > 0 ? rosterCards : [el('div.card', {}, el('span.muted', {}, '아직 몬스터가 없습니다 — 원정에서 포획해 보세요'))]),
    (() => {
      // 카드 합성 진입 — 여분(각 종 count-1) 총량이 보이게
      const spareTotal = state.roster.reduce((sum, m) => sum + Math.max(0, m.count - 1), 0);
      return el('div.card.list-row', {},
        el('span.muted.small', {}, `🧬 카드 합성 (여분 카드 ${spareTotal}장)`),
        el('button.btn.btn-ghost', { onclick: () => { resetFusion(); overlay.set({ kind: 'fusion' }); } }, '열기'),
      );
    })(),
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

    el('h2.section-title', {}, `유물 (${state.artifacts.length})`),
    el('div.card', {},
      state.artifacts.length === 0 ? el('span.muted', {}, '원정에서 발굴한 유물이 여기 모입니다') : el('div.stack-sm', {}, ...artifacts),
    ),

    el('h2.section-title', {}, '미끼 제작'),
    el('div.card', {}, ...recipes),
  );
}

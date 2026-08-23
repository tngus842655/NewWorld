/**
 * 캠프 — 몬스터 관리(레벨·각성), 유물 인벤토리(강화·분해), 미끼 제작, 지갑.
 * 설정·세이브 관리는 설정 탭으로 분리 (2026-08-23).
 */
import { content } from '../../content';
import { isRegionUnlocked, nextPartySlotUnlock } from '../../core/progression';
import { buySlot, craft, save } from '../../state/store';
import { artifactCard, monsterChip, ownedCp } from '../components';
import { ARTIFACT_RARITY_ORDER, el, fmtGold } from '../kit';
import { resetFusion } from '../fusionSheet';
import { overlay } from '../router';
import { playSfx } from '../sfx';

export function renderCamp(): HTMLElement {
  const state = save();
  const busyIds = new Set(state.expeditions.filter((e) => !e.claimed).flatMap((e) => e.partyIds));

  const roster = [...state.roster]
    .sort((a, b) => ownedCp(b) - ownedCp(a))
    .map((owned) => monsterChip(owned, {
      onclick: () => overlay.set({ kind: 'monster', monsterId: owned.monsterId }),
      onExpedition: busyIds.has(owned.monsterId),
    }));

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
  const materialChips = [...content.materials.values()]
    .filter((material) => shownMaterialIds.has(material.id))
    .map((material) =>
      el('span.wallet-item', { title: `${material.name} (${content.regions.get(material.region)?.name})` },
        `${material.icon} ${state.wallet.materials[material.id] ?? 0}`),
    );

  const slotUnlock = nextPartySlotUnlock(content, state);

  return el('div.screen', {},
    el('div.card.wallet', {},
      ...(materialChips.length > 0
        ? materialChips
        : [el('span.muted.small', {}, '지역 재료는 원정의 채집·갈림길에서 모입니다')]),
    ),

    el('h2.section-title', {}, `몬스터 (${state.roster.length})`),
    el('div.card', {}, el('div.chips', {}, ...roster)),
    (() => {
      // 카드 합성 진입 — 여분(각 종 count-1) 총량이 보이게
      const spareTotal = state.roster.reduce((sum, m) => sum + Math.max(0, m.count - 1), 0);
      return el('div.card.list-row', {},
        el('span.muted.small', {}, `🧬 카드 합성 — 여분 카드 ${spareTotal}장 (같은 등급 2장 → 상위 등급 도전)`),
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

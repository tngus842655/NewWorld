/**
 * 캠프 — 몬스터 관리(레벨·각성), 유물 인벤토리(강화·분해), 미끼 제작, 지갑.
 * 설정·세이브 관리는 설정 탭으로 분리 (2026-08-23).
 */
import { content } from '../../content';
import { isRegionUnlocked, nextPartySlotUnlock } from '../../core/progression';
import { buySlot, craft, save } from '../../state/store';
import { artifactCard, monsterChip, ownedCp } from '../components';
import { ARTIFACT_RARITY_ORDER, el, fmtGold } from '../kit';
import { overlay } from '../router';
import { playSfx } from '../sfx';

export function renderCamp(): HTMLElement {
  const state = save();
  const busyUids = new Set(state.expeditions.filter((e) => !e.claimed).flatMap((e) => e.partyUids));

  const roster = [...state.roster]
    .sort((a, b) => ownedCp(b) - ownedCp(a))
    .map((owned) => monsterChip(owned, {
      onclick: () => overlay.set({ kind: 'monster', uid: owned.uid }),
      onExpedition: busyUids.has(owned.uid),
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
        const have = state.wallet.materials[id] ?? 0;
        return `${content.materials.get(id)?.name} ×${n}${have < n ? ` (보유 ${have})` : ''}`;
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

  // 해금 지역의 재료는 보유 0이어도 상시 표시 — "뭘 모아야 하나"가 보이게
  const shownMaterialIds = new Set<string>();
  const materialRows = [...content.regions.values()]
    .filter((region) => isRegionUnlocked(content, state, region.id))
    .map((region) => {
      region.materials.forEach((id) => shownMaterialIds.add(id));
      return el('div.list-row', {},
        el('span.muted.small', {}, region.name),
        el('span', {}, region.materials
          .map((id) => `${content.materials.get(id)?.name ?? id} ${state.wallet.materials[id] ?? 0}`)
          .join(' · ')),
      );
    });
  const extraMaterials = Object.entries(state.wallet.materials)
    .filter(([id, count]) => count > 0 && !shownMaterialIds.has(id))
    .map(([id, count]) => el('span.tag', {}, `${content.materials.get(id)?.name ?? id} ${count}`));

  const slotUnlock = nextPartySlotUnlock(content, state);

  return el('div.screen', {},
    el('div.card.wallet', {},
      el('span', {}, `💰 ${fmtGold(state.wallet.gold)}`),
      el('span', {}, `✨ 가루 ${fmtGold(state.wallet.dust)}`),
      el('span', {}, `🪤 미끼 ${state.wallet.lures}`),
    ),
    el('h2.section-title', {}, '지역 재료'),
    el('div.card', {},
      ...materialRows,
      extraMaterials.length > 0 ? el('div.chips-wrap', {}, ...extraMaterials) : null,
    ),

    el('h2.section-title', {}, `몬스터 (${state.roster.length})`),
    el('div.card', {}, el('div.chips', {}, ...roster)),
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

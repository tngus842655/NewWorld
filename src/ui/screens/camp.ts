/**
 * 캠프 — 몬스터 관리(레벨·각성), 유물 인벤토리(강화·분해), 미끼 제작, 지갑, 설정.
 */
import { content } from '../../content';
import { isRegionUnlocked, nextPartySlotUnlock } from '../../core/progression';
import { exportSave, importSave } from '../../state/save';
import { buySlot, craft, resetSave, save, toggleSound } from '../../state/store';
import { artifactCard, monsterChip, ownedCp } from '../components';
import { ARTIFACT_RARITY_ORDER, el, fmtGold, toast } from '../kit';
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

    el('h2.section-title', {}, '설정'),
    el('div.card', {},
      el('div.list-row', {},
        el('span', {}, '효과음'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            toggleSound();
            // 켠 직후에만 확인음 (끄면 즉시 무음이 곧 피드백)
            if (save().settings.sound) playSfx('tap');
          },
        }, state.settings.sound ? '🔊 켬' : '🔇 끔'),
      ),
      el('div.list-row', {},
        el('span', {}, '세이브 내보내기'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            void navigator.clipboard?.writeText(exportSave(save())).then(
              () => toast('세이브를 클립보드에 복사했습니다', 'ok'),
              () => toast('클립보드 복사 실패', 'error'),
            );
          },
        }, '복사'),
      ),
      el('div.list-row', {},
        el('span', {}, '세이브 가져오기'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            const text = prompt('세이브 JSON을 붙여넣으세요');
            if (!text) return;
            const imported = importSave(text);
            if (imported) {
              save.set(imported);
              toast('세이브를 불러왔습니다', 'ok');
            } else {
              toast('올바른 세이브가 아닙니다', 'error');
            }
          },
        }, '붙여넣기'),
      ),
      el('div.list-row', {},
        el('span.muted', {}, '처음부터 (되돌릴 수 없음)'),
        el('button.btn.btn-danger', {
          onclick: () => {
            if (confirm('정말 새 게임을 시작할까요? 현재 진행이 사라집니다.')) resetSave();
          },
        }, '초기화'),
      ),
    ),
  );
}

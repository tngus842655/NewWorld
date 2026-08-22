/**
 * 오버레이 — 일지 / 몬스터 상세 / 유물 상세 / 갈림길 선택.
 */
import { content } from '../content';
import { enhanceCost, levelUpCost, starUpCost, statAt } from '../core/formulas';
import * as clock from '../state/clock';
import { awaken, choose, claim, crossroadsOf, enhance, levelUp, salvage, save } from '../state/store';
import { artifactIcon, fmtEffect, mainLabel, monsterIcon, ownedCp } from './components';
import { describeEffect } from './effectText';
import {
  ARTIFACT_RARITY_LABEL, ELEMENT_LABEL, MONSTER_RARITY_LABEL, SLOT_LABEL, TRIBE_LABEL,
  el, fmtGold, stars,
} from './kit';
import { journalView } from './journalView';
import { closeOverlay, overlay, type Overlay } from './router';

export function renderOverlay(current: Overlay): HTMLElement | null {
  if (!current) return null;
  const sheet =
    current.kind === 'journal'
      ? journalSheet(current)
      : current.kind === 'monster'
        ? monsterSheet(current.uid)
        : current.kind === 'artifact'
          ? artifactSheet(current.uid)
          : crossroadsSheet(current.expeditionId);
  if (!sheet) return null;
  return el('div.overlay', { onclick: (event) => { if (event.target === event.currentTarget) closeOverlay(); } }, sheet);
}

function sheetShell(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return el('div.sheet', {},
    el('div.sheet-head', {},
      el('div.sheet-title', {}, title),
      el('button.btn.btn-ghost', { onclick: closeOverlay }, '닫기'),
    ),
    ...children,
  );
}

function journalSheet(data: Extract<NonNullable<Overlay>, { kind: 'journal' }>): HTMLElement {
  return el('div.sheet.sheet-journal', {},
    journalView(data.journal, data.newMilestones),
    el('button.btn.btn-primary.btn-big', { onclick: closeOverlay }, '확인'),
  );
}

function monsterSheet(uid: string): HTMLElement | null {
  const state = save();
  const owned = state.roster.find((m) => m.uid === uid);
  if (!owned) return null;
  const monster = content.monsters.get(owned.monsterId)!;
  const { balance } = content;
  const atk = Math.round(statAt(monster.baseAtk, owned.level, owned.star, balance));
  const hp = Math.round(statAt(monster.baseHp, owned.level, owned.star, balance));
  const maxLevel = owned.level >= balance.level.max;
  const maxStar = owned.star >= balance.star.max;
  const upCost = maxLevel ? 0 : levelUpCost(owned.level, balance);
  const starCost = maxStar ? 0 : starUpCost(owned.star, balance);
  const essenceHave = state.wallet.essence[owned.monsterId] ?? 0;
  const busy = state.expeditions.some((e) => !e.claimed && e.partyUids.includes(uid));

  return sheetShell(monster.name,
    el('div.detail-head', {},
      monsterIcon(monster.id),
      el('div', {},
        el('div.chips-wrap', {},
          el(`span.tag.rar-${monster.rarity}`, {}, MONSTER_RARITY_LABEL[monster.rarity]),
          el('span.tag', {}, ELEMENT_LABEL[monster.element]),
          el('span.tag', {}, TRIBE_LABEL[monster.tribe]),
        ),
        el('div.muted.small', {}, `Lv.${owned.level} ${stars(owned.star)} · 서식지 ${content.regions.get(monster.habitat)?.name}`),
        busy ? el('div.tag.busy-tag', {}, '🧭 원정 중') : null,
      ),
    ),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.muted.small', {}, '공격'), el('strong', {}, `${atk}`)),
      el('div.stat', {}, el('div.muted.small', {}, '생명'), el('strong', {}, `${hp}`)),
      el('div.stat', {}, el('div.muted.small', {}, '전투력'), el('strong', {}, `${ownedCp(owned)}`)),
    ),
    el('p.flavor', {}, `“${monster.flavor}”`),
    el('div.row-gap', {},
      el('button.btn.btn-primary', {
        disabled: maxLevel || state.wallet.gold < upCost,
        onclick: () => levelUp(uid),
      }, maxLevel ? '최대 레벨' : `레벨업 (골드 ${fmtGold(upCost)})`),
      el('button.btn.btn-primary', {
        disabled: maxStar || essenceHave < starCost,
        onclick: () => awaken(uid),
      }, maxStar ? '최대 성급' : `각성 ★${owned.star + 1} (정수 ${starCost} / 보유 ${essenceHave})`),
    ),
  );
}

function artifactSheet(uid: string): HTMLElement | null {
  const state = save();
  const owned = state.artifacts.find((a) => a.uid === uid);
  if (!owned) return null;
  const def = content.artifacts.get(owned.itemId)!;
  const { balance } = content;
  const mainValue = def.main.base + def.main.perEnhance * owned.enhance;
  const maxEnhance = owned.enhance >= balance.artifacts.enhance.max;
  const cost = maxEnhance ? 0 : enhanceCost(owned.enhance, balance);
  const busy = state.expeditions.some((e) => !e.claimed && e.artifactUids.includes(uid));
  const setDef = def.set ? content.sets.get(def.set) : null;

  return sheetShell(`${def.name}${owned.enhance > 0 ? ` +${owned.enhance}` : ''}`,
    el('div.detail-head', {},
      artifactIcon(def.id),
      el('div', {},
        el('div.chips-wrap', {},
          el(`span.tag.rar-${def.rarity}`, {}, ARTIFACT_RARITY_LABEL[def.rarity]),
          el('span.tag', {}, SLOT_LABEL[def.slot] ?? def.slot),
          setDef ? el('span.tag', {}, `${setDef.name} 세트`) : null,
        ),
        busy ? el('div.tag.busy-tag', {}, '🧭 원정 중 (장착됨)') : null,
      ),
    ),
    el('div.card.stack-sm', {},
      el('div.list-row', {}, el('span', {}, `주옵션 · ${mainLabel(def.main.stat)}`), el('strong', {}, fmtEffect(def.main.stat, mainValue))),
      ...owned.substats.map((sub) =>
        el('div.list-row', {}, el('span.muted', {}, `부옵션 · ${mainLabel(sub.stat)}`), el('span', {}, fmtEffect(sub.stat, sub.value))),
      ),
      ...def.unique.map((effect) => el('div.list-row.unique-row', {}, el('span', {}, `✦ ${describeEffect(effect)}`))),
      setDef
        ? el('div.setinfo', {},
            el('div.muted.small', {}, `${setDef.name} 2세트: ${setDef.bonuses['2'].map(describeEffect).join(', ')}`),
            el('div.muted.small', {}, `${setDef.name} 4세트: ${setDef.bonuses['4'].map(describeEffect).join(', ')}`),
          )
        : null,
    ),
    el('p.flavor', {}, `“${def.flavor}”`),
    el('div.row-gap', {},
      el('button.btn.btn-primary', {
        disabled: busy || maxEnhance || state.wallet.dust < cost,
        onclick: () => enhance(uid),
      }, maxEnhance ? '최대 강화' : `강화 +${owned.enhance + 1} (가루 ${cost} / 보유 ${state.wallet.dust})`),
      el('button.btn.btn-danger', {
        disabled: busy,
        onclick: () => {
          const gain = balance.artifacts.dustPerSalvage[def.rarity];
          if (confirm(`${def.name}을(를) 분해해 가루 ${gain}을 얻을까요? 되돌릴 수 없습니다.`)) {
            salvage(uid);
            closeOverlay();
          }
        },
      }, '분해'),
    ),
  );
}

function crossroadsSheet(expeditionId: string): HTMLElement | null {
  const state = save();
  const expedition = state.expeditions.find((e) => e.id === expeditionId && !e.claimed);
  if (!expedition) return null;
  const events = crossroadsOf(expeditionId);
  const done = clock.now() >= expedition.endsAt;
  const pendingCount = expedition.choices.filter((choice) => choice === null).length;

  const rows = events.map((event, index) => {
    const chosen = expedition.choices[index] ?? null;
    return el('div.card.stack-sm', {},
      el('div', {}, `🔀 ${event.name}`),
      el('div.muted.small', {}, event.text),
      chosen
        ? el('div.tag', {}, chosen === 'risky' ? '⚡ 위험을 감수하기로 함' : '🛡️ 안전하게 가기로 함')
        : el('div.row-gap', {},
            el('button.btn.btn-ghost', { onclick: () => choose(expeditionId, index, 'safe') }, '🛡️ 안전하게'),
            el('button.btn.btn-primary', { onclick: () => choose(expeditionId, index, 'risky') }, '⚡ 위험을 감수'),
          ),
    );
  });

  return sheetShell('갈림길 선택',
    el('div.muted.small', {}, '선택하지 않으면 원정대는 안전한 길을 고릅니다.'),
    ...rows,
    done
      ? el('button.btn.btn-primary.btn-big', {
          onclick: () => {
            const result = claim(expeditionId);
            if (result) overlay.set({ kind: 'journal', ...result });
          },
        }, pendingCount > 0 ? `📜 일지 정산 — 남은 ${pendingCount}곳은 안전한 길로` : '📜 일지 정산')
      : null,
  );
}

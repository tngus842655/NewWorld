/**
 * 오버레이 — 일지 / 몬스터 상세 / 유물 상세 / 갈림길 선택.
 */
import { content } from '../content';
import { elementMult, enhanceCost, levelUpCost, monsterBaseCp, starUpCost, statAt } from '../core/formulas';
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
import { playSfx } from './sfx';

export function renderOverlay(current: Overlay): HTMLElement | null {
  if (!current) return null;
  const sheet =
    current.kind === 'journal'
      ? journalSheet(current)
      : current.kind === 'monster'
        ? monsterSheet(current.uid)
        : current.kind === 'artifact'
          ? artifactSheet(current.uid)
          : current.kind === 'species'
            ? speciesSheet(current.monsterId)
            : current.kind === 'help'
              ? helpSheet()
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

// 직전 렌더의 성장 수치 — 같은 시트가 레벨업·각성으로 다시 그려질 때만 스탯 팝
let lastMonsterRender: { uid: string; level: number; star: number } | null = null;

function monsterSheet(uid: string): HTMLElement | null {
  const state = save();
  const owned = state.roster.find((m) => m.uid === uid);
  if (!owned) return null;
  const grew =
    lastMonsterRender?.uid === uid &&
    (owned.level > lastMonsterRender.level || owned.star > lastMonsterRender.star);
  lastMonsterRender = { uid, level: owned.level, star: owned.star };
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
      el('div.stat', {}, el('div.muted.small', {}, '공격'), el(`strong${grew ? '.stat-pop' : ''}`, {}, `${atk}`)),
      el('div.stat', {}, el('div.muted.small', {}, '생명'), el(`strong${grew ? '.stat-pop' : ''}`, {}, `${hp}`)),
      el('div.stat', {}, el('div.muted.small', {}, '전투력'), el(`strong${grew ? '.stat-pop' : ''}`, {}, `${ownedCp(owned)}`)),
    ),
    el('p.flavor', {}, `“${monster.flavor}”`),
    el('div.row-gap', {},
      el('button.btn.btn-primary', {
        disabled: maxLevel || state.wallet.gold < upCost,
        onclick: () => { if (levelUp(uid)) playSfx('levelup'); },
      }, maxLevel ? '최대 레벨' : `레벨업 (골드 ${fmtGold(upCost)})`),
      el('button.btn.btn-primary', {
        disabled: maxStar || essenceHave < starCost,
        onclick: () => { if (awaken(uid)) playSfx('awaken'); },
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
        onclick: () => { if (enhance(uid)) playSfx('enhance'); },
      }, maxEnhance ? '최대 강화' : `강화 +${owned.enhance + 1} (가루 ${cost} / 보유 ${state.wallet.dust})`),
      el('button.btn.btn-danger', {
        disabled: busy,
        onclick: () => {
          const gain = balance.artifacts.dustPerSalvage[def.rarity];
          if (confirm(`${def.name}을(를) 분해해 가루 ${gain}을 얻을까요? 되돌릴 수 없습니다.`)) {
            if (salvage(uid)) playSfx('salvage');
            closeOverlay();
          }
        },
      }, '분해'),
    ),
  );
}

/** 도감 종 정보 — 성장 액션 없이 정보만 (캠프의 monsterSheet와 목적 분리) */
function speciesSheet(monsterId: string): HTMLElement | null {
  const monster = content.monsters.get(monsterId);
  if (!monster) return null;
  const state = save();
  const entry = state.codex[monsterId];
  const captured = entry?.captured === true;
  if (!captured && entry?.seen !== true) return null; // 미지 종은 진입 차단 (도감 셀에서도 막지만 방어)
  const habitat = content.regions.get(monster.habitat)?.name ?? monster.habitat;

  // 목격만 한 종: 실루엣 + 서식지 힌트 (GDD §7.2)
  if (!captured) {
    return sheetShell('???',
      el('div.detail-head', {},
        monsterIcon(monster.id, { silhouette: true }),
        el('div', {},
          el('div.chips-wrap', {}, el(`span.tag.rar-${monster.rarity}`, {}, MONSTER_RARITY_LABEL[monster.rarity])),
          el('div.muted.small', {}, `목격 기록 · 서식지 ${habitat}`),
        ),
      ),
      el('p.flavor', {}, '“포획하면 상세 정보가 공개됩니다.”'),
    );
  }

  const { balance } = content;
  const owned = state.roster.find((m) => m.monsterId === monsterId);
  const synergy = content.synergies.get(monster.tribe);
  const goodRegions = content.regionList
    .filter((region) => elementMult(monster.element, region.element, balance) > 1)
    .map((region) => region.name);
  const badRegions = content.regionList
    .filter((region) => elementMult(monster.element, region.element, balance) < 1)
    .map((region) => region.name);
  const essenceHave = state.wallet.essence[monsterId] ?? 0;

  return sheetShell(monster.name,
    el('div.detail-head', {},
      monsterIcon(monster.id),
      el('div', {},
        el('div.chips-wrap', {},
          el(`span.tag.rar-${monster.rarity}`, {}, MONSTER_RARITY_LABEL[monster.rarity]),
          el('span.tag', {}, ELEMENT_LABEL[monster.element]),
          el('span.tag', {}, TRIBE_LABEL[monster.tribe]),
          entry.awakened ? el('span.tag', {}, '✨ 각성') : null,
        ),
        el('div.muted.small', {}, `서식지 ${habitat}`),
        owned ? el('div.tag.busy-tag', {}, `보유 중 · Lv.${owned.level} ${stars(owned.star)}`) : null,
      ),
    ),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.muted.small', {}, '기본 공격'), el('strong', {}, `${monster.baseAtk}`)),
      el('div.stat', {}, el('div.muted.small', {}, '기본 생명'), el('strong', {}, `${monster.baseHp}`)),
      el('div.stat', {}, el('div.muted.small', {}, '기본 전투력'), el('strong', {}, `${Math.round(monsterBaseCp(monster, balance))}`)),
    ),
    el('div.card.stack-sm', {},
      synergy
        ? el('div', {},
            el('div.muted.small', {}, `${TRIBE_LABEL[monster.tribe]} 시너지 (같은 종족 편성 시)`),
            el('div.small', {}, `2마리: ${synergy.at2.map(describeEffect).join(', ')}`),
            el('div.small', {}, `3마리: ${synergy.at3.map(describeEffect).join(', ')}`),
          )
        : null,
      goodRegions.length > 0 ? el('div.small', {}, `⚔️ 유리한 지역: ${goodRegions.join(', ')}`) : null,
      badRegions.length > 0 ? el('div.small.muted', {}, `⚠️ 불리한 지역: ${badRegions.join(', ')}`) : null,
      el('div.small.muted', {}, `보유 정수 ${essenceHave} — 중복 포획 시 자동 전환, 각성(성급)에 사용`),
    ),
    el('p.flavor', {}, `“${monster.flavor}”`),
  );
}

/** 재화 안내 — 상단 지갑 아이콘이 무엇인지 (신규 유저용) */
function helpSheet(): HTMLElement {
  const row = (icon: string, name: string, gain: string, use: string) =>
    el('div.card.stack-sm', {},
      el('div', {}, `${icon} ${name}`),
      el('div.small.muted', {}, `얻기 — ${gain}`),
      el('div.small.muted', {}, `쓰기 — ${use}`),
    );
  return sheetShell('재화 안내',
    row('💰', '골드', '조우 승리 · 보물 · 일지 정산 · 도감 마일스톤', '몬스터 레벨업 · 파티 슬롯 확장 · 미끼 제작'),
    row('✨', '가루', '유물 분해', '유물 강화'),
    row('🪤', '미끼', '캠프에서 제작 (지역 재료 + 골드)', '파견에 자동 적재 — 레어 이상 몬스터 포획률 ×2'),
    el('div.muted.small', {}, '지역 재료·정수 보유량은 캠프 화면에서 볼 수 있습니다.'),
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
            el('button.btn.btn-ghost', { onclick: () => { choose(expeditionId, index, 'safe'); playSfx('select'); } }, '🛡️ 안전하게'),
            el('button.btn.btn-primary', { onclick: () => { choose(expeditionId, index, 'risky'); playSfx('select'); } }, '⚡ 위험을 감수'),
          ),
    );
  });

  return sheetShell('갈림길 선택',
    el('div.muted.small', {}, '🛡️ 안전 — 소소한 보상 확정 · ⚡ 위험 — 전투력 판정, 성공 시 희귀 보상·실패 시 HP 피해'),
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

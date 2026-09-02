/**
 * 오버레이 — 일지 / 몬스터 상세 / 유물 상세 / 갈림길 선택.
 */
import { content } from '../content';
import { RELEASE_NOTES } from '../content/releaseNotes';
import { DIFFICULTIES, ELEMENTS, RARITY_LABEL, TIERS, type MonsterRarity, type Region } from '../content/schema';
import { artifactEnhanceCost, elementMult, monsterBaseCp, monsterLevelUpCost, monsterStarUpCost, statAt } from '../core/formulas';
import { artifactScore, monsterBaseScore, monsterScore } from '../core/score';
import { finalTierEntry, transcendGateRegion } from '../core/economy';
import { isExpeditionOut } from '../core/expedition';
import { isRegionUnlocked } from '../core/progression';
import * as clock from '../state/clock';
import { awaken, choose, claim, crossroadsOf, enhance, levelUp, save } from '../state/store';
import { accelerateSheet } from './accelerateSheet';
import { artifactFusionSheet } from './artifactFusionSheet';
import { mapSheet } from './expeditionMap';
import { feedbackSheet } from './feedbackSheet';
import { FUSABLE_RARITIES, FUSION_NEXT, fusionSheet } from './fusionSheet';
import { rankingSheet, tasksSheet } from './rankingSheets';
import { teamSheet } from './teamSheet';
import { accountBonusSheet } from './accountBonusSheet';
import { attendanceSheet } from './attendanceSheet';
import { rechargeSheet } from './rechargeSheet';
import { shopSheet } from './shopSheet';
import { artifactIcon, artifactIconBadged, fmtEffect, mainLabel, monsterIcon, ownedCp, uiIcon } from './components';
import { describeEffect } from './effectText';
import {
  ARTIFACT_RARITY_LABEL, DIFFICULTY_LABEL, ELEMENT_EMOJI, ELEMENT_LABEL, MONSTER_RARITY_LABEL, RARITY_ASC, SLOT_LABEL,
  TIER_LABEL, TIER_NAME, TRIBE_EMOJI, TRIBE_LABEL, el, fmtAgo, fmtGold, stars,
} from './kit';
import { journalView } from './journalView';
import { chipPanels, filterSections, tabPanels, type Panel } from './panels';
import { closeOverlay, overlay, type Overlay } from './router';
import { playSfx } from './sfx';

export function renderOverlay(current: Overlay): HTMLElement | null {
  if (!current) return null;
  const sheet =
    current.kind === 'journal'
      ? journalSheet(current)
      : current.kind === 'journalDetail'
        ? journalDetailSheet(current.expeditionId)
      : current.kind === 'accelerate'
        ? accelerateSheet(current.expeditionId)
      : current.kind === 'monster'
        ? monsterSheet(current.monsterId)
        : current.kind === 'artifact'
          ? artifactSheet(current.itemId)
          : current.kind === 'species'
            ? speciesSheet(current.monsterId)
            : current.kind === 'ranking'
              ? rankingSheet()
            : current.kind === 'shop'
              ? shopSheet()
            : current.kind === 'recharge'
              ? rechargeSheet()
            : current.kind === 'attendance'
              ? attendanceSheet()
            : current.kind === 'accountBonus'
              ? accountBonusSheet()
            : current.kind === 'tasks'
              ? tasksSheet()
              : current.kind === 'fusion'
                ? fusionSheet()
                : current.kind === 'artifactFusion'
                  ? artifactFusionSheet()
                : current.kind === 'teamEdit'
                  ? teamSheet(current.teamId)
                : current.kind === 'map'
                  ? mapSheet()
                : current.kind === 'odds'
                  ? oddsSheet()
                : current.kind === 'elementInfo'
                  ? elementInfoSheet()
                : current.kind === 'monsterInfo'
                  ? monsterInfoSheet()
                : current.kind === 'releaseNotes'
                  ? releaseNotesSheet()
                : current.kind === 'feedback'
                  ? feedbackSheet()
                  : current.kind === 'artifactInfo'
                    ? artifactInfoSheet()
                    : crossroadsSheet(current.expeditionId);
  if (!sheet) return null;
  return el('div.overlay', { onclick: (event) => { if (event.target === event.currentTarget) closeOverlay(); } }, sheet);
}

/** title은 문자열 또는 [아이콘, 텍스트] 배열 — 이모지 자리를 webp 아이콘(uiIcon)으로 대체할 때 배열로 */
export function sheetShell(title: string | (HTMLElement | string)[], ...children: (HTMLElement | null)[]): HTMLElement {
  return el('div.sheet', {},
    el('div.sheet-head', {},
      el('div.sheet-title', {}, ...(Array.isArray(title) ? title : [title])),
      el('button.btn.btn-ghost', { onclick: closeOverlay }, '닫기'),
    ),
    ...children,
  );
}

function journalSheet(data: Extract<NonNullable<Overlay>, { kind: 'journal' }>): HTMLElement {
  // sheet-journal-live: 순차 공개 동안 시트가 자라며 출렁이지 않게 처음부터 최대 높이 고정 (2026-08-23 사용자)
  return el('div.sheet.sheet-journal.sheet-journal-live', {},
    journalView(data.journal, data.newMilestones),
    el('button.btn.btn-primary.btn-big', { onclick: closeOverlay }, '확인'),
  );
}

/** 최근 일지 재열람 — 아카이브에 보관된 풀 일지를 연출 없이 바로 보여준다 */
function journalDetailSheet(expeditionId: string): HTMLElement | null {
  const summary = save().journalArchive.find((s) => s.expeditionId === expeditionId);
  if (!summary?.journal) return null; // 구 세이브 항목 — 풀 일지 없음 (UI가 상세 버튼을 숨기지만 방어)
  return el('div.sheet.sheet-journal', {},
    journalView(summary.journal, [], { instant: true, subtitle: `${fmtAgo(clock.now() - summary.endedAt)} 귀환` }),
    el('button.btn.btn-primary.btn-big', { onclick: closeOverlay }, '확인'),
  );
}

// 직전 렌더의 성장 수치 — 같은 시트가 레벨업·각성으로 다시 그려질 때만 스탯 팝
let lastMonsterRender: { monsterId: string; level: number; star: number } | null = null;

function monsterSheet(monsterId: string): HTMLElement | null {
  const state = save();
  const owned = state.roster.find((m) => m.monsterId === monsterId);
  if (!owned) return null;
  const grew =
    lastMonsterRender?.monsterId === monsterId &&
    (owned.level > lastMonsterRender.level || owned.star > lastMonsterRender.star);
  lastMonsterRender = { monsterId, level: owned.level, star: owned.star };
  const monster = content.monsters.get(owned.monsterId)!;
  const { balance } = content;
  const atk = Math.round(statAt(monster.baseAtk, owned.level, owned.star, balance));
  const hp = Math.round(statAt(monster.baseHp, owned.level, owned.star, balance));
  const cp = ownedCp(owned);
  const maxLevel = owned.level >= balance.level.max;
  const maxStar = owned.star >= balance.star.max;
  const upCost = maxLevel ? 0 : monsterLevelUpCost(content, monsterId, owned.level);
  const starCost = maxStar ? 0 : monsterStarUpCost(content, monsterId, owned.star);
  const busy = state.expeditions.some((e) => isExpeditionOut(e, clock.now()) && e.partyIds.includes(monsterId));

  // 다음 레벨 미리보기 — "레벨업하면 얼마나 오르나"가 버튼 옆에 바로 보이게
  const nextAtkStat = statAt(monster.baseAtk, owned.level + 1, owned.star, balance);
  const nextHpStat = statAt(monster.baseHp, owned.level + 1, owned.star, balance);
  const gains = maxLevel ? null : {
    atk: Math.round(nextAtkStat) - atk,
    hp: Math.round(nextHpStat) - hp,
    cp: Math.round(nextAtkStat * balance.cp.atkWeight + nextHpStat * balance.cp.hpWeight) - cp,
  };
  const statCell = (label: string, value: number, gain: number | undefined) =>
    el('div.stat', {},
      el('div.muted.small', {}, label),
      el(`strong${grew ? '.stat-pop' : ''}`, {}, `${value}`),
      gain ? el('div.stat-next', {}, `+${gain}`) : null,
    );

  return sheetShell(monster.name,
    el('div.detail-head', {},
      monsterIcon(monster.id),
      el('div', {},
        el('div.chips-wrap', {},
          el(`span.tag.rar-${monster.rarity}`, {}, MONSTER_RARITY_LABEL[monster.rarity]),
          el('span.tag', {}, ELEMENT_LABEL[monster.element]),
          el('span.tag', {}, TRIBE_LABEL[monster.tribe]),
        ),
        el('div.muted.small', {}, `Lv.${owned.level} ${stars(owned.star)} · 서식지 ${[content.regions.get(monster.habitat)?.icon, content.regions.get(monster.habitat)?.name].filter(Boolean).join(' ')}`),
        // 상세 머리의 오른쪽 열은 265px — 한 줄에 맞게 짧게 (2026-09-02 문구 점검)
        el('div.muted.small', {}, `보유 카드 ${owned.count}장 [중복 포획으로 누적 · 합성 재료]`),
        el('div.muted.small', {}, `🏆 랭킹 점수 ${monsterScore(content, owned)} [레벨·성급으로 커집니다]`),
        busy ? el('div.tag.busy-tag', {}, '🧭 원정 중') : null,
      ),
    ),
    el('div.stat-row', {},
      statCell('공격', atk, gains?.atk),
      statCell('생명', hp, gains?.hp),
      statCell('전투력', cp, gains?.cp),
    ),
    monster.unique.length > 0
      ? el('div.card.stack-sm', {},
          ...monster.unique.map((effect) => el('div.list-row.unique-row', {}, el('span', {}, `✦ 고유 능력 · ${describeEffect(effect)}`))),
          el('div.small.muted', {}, '전설의 고유 능력 — 편성하면 원정 내내 발동합니다'),
        )
      : null,
    el('p.flavor', {}, `“${monster.flavor}”`),
    el('div.row-gap', {},
      el('button.btn.btn-primary', {
        tour: 'levelup', // 온보딩 투어 — 첫 레벨업 유도 (GDD §11.2)
        disabled: maxLevel || state.wallet.gold < upCost,
        onclick: () => { if (levelUp(monsterId)) playSfx('levelup'); },
      }, maxLevel ? '최대 레벨' : `레벨업 (골드 ${fmtGold(upCost)})`),
      el('button.btn.btn-primary', {
        disabled: maxStar || state.wallet.gold < starCost,
        onclick: () => { if (awaken(monsterId)) playSfx('awaken'); },
      }, maxStar ? '최대 성급' : `각성 ★${owned.star + 1} (골드 ${fmtGold(starCost)})`),
    ),
  );
}

function artifactSheet(itemId: string): HTMLElement | null {
  const state = save();
  const owned = state.artifacts.find((a) => a.itemId === itemId);
  if (!owned) return null;
  const def = content.artifacts.get(owned.itemId)!;
  const { balance } = content;
  const mainValue = def.main.base + def.main.perEnhance * owned.enhance;
  const maxEnhance = owned.enhance >= balance.artifacts.enhance.max;
  const cost = maxEnhance ? 0 : artifactEnhanceCost(content, def.id, owned.enhance);
  const setDef = def.set ? content.sets.get(def.set) : null;

  return sheetShell(`${def.name}${owned.enhance > 0 ? ` +${owned.enhance}` : ''}`,
    el('div.detail-head', {},
      artifactIconBadged(owned),
      el('div', {},
        el('div.chips-wrap', {},
          el(`span.tag.rar-${def.rarity}`, {}, ARTIFACT_RARITY_LABEL[def.rarity]),
          el('span.tag', {}, SLOT_LABEL[def.slot] ?? def.slot),
          setDef ? el('span.tag', {}, `${setDef.name} 세트`) : null,
        ),
        el('div.muted.small', {}, `보유 ${owned.count}개 [강화는 종 공통, 여분은 합성 재료]`),
        el('div.muted.small', {}, `🏆 랭킹 점수 ${artifactScore(content, owned)} [강화하면 커집니다]`),
      ),
    ),
    el('div.card.stack-sm', {},
      el('div.list-row', {}, el('span', {}, `주옵션 · ${mainLabel(def.main.stat)}`), el('strong', {}, fmtEffect(def.main.stat, mainValue))),
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
        disabled: maxEnhance || state.wallet.dust < cost,
        onclick: () => { if (enhance(itemId)) playSfx('enhance'); },
      }, maxEnhance ? '최대 강화' : `강화 +${owned.enhance + 1} (가루 ${cost} / 보유 ${state.wallet.dust})`),
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
  const habitatRegion = content.regions.get(monster.habitat);
  const habitat = habitatRegion ? `${habitatRegion.icon} ${habitatRegion.name}` : monster.habitat;

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
        el('div.muted.small', {},
          `🏆 랭킹 점수 기본 ${monsterBaseScore(content, monster.id)}${owned ? ` · 보유 ${monsterScore(content, owned)}` : ''}`),
        owned ? el('div.tag.busy-tag', {}, `보유 중 · Lv.${owned.level} ${stars(owned.star)} · 카드 ${owned.count}장`) : null,
      ),
    ),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.muted.small', {}, '기본 공격'), el('strong', {}, `${monster.baseAtk}`)),
      el('div.stat', {}, el('div.muted.small', {}, '기본 생명'), el('strong', {}, `${monster.baseHp}`)),
      el('div.stat', {}, el('div.muted.small', {}, '기본 전투력'), el('strong', {}, `${Math.round(monsterBaseCp(monster, balance))}`)),
    ),
    el('div.card.stack-sm', {},
      ...monster.unique.map((effect) => el('div.small.unique-row', {}, `✦ 고유 능력 · ${describeEffect(effect)} [파티 편성 시 발동]`)),
      synergy
        ? el('div', {},
            el('div.muted.small', {}, `${TRIBE_LABEL[monster.tribe]} 시너지 (같은 종족 편성 시)`),
            el('div.small', {}, `2마리: ${synergy.at2.map(describeEffect).join(', ')}`),
            el('div.small', {}, `3마리: ${synergy.at3.map(describeEffect).join(', ')}`),
          )
        : null,
      goodRegions.length > 0 ? el('div.small', {}, `⚔️ 유리한 지역: ${goodRegions.join(', ')}`) : null,
      badRegions.length > 0 ? el('div.small.muted', {}, `⚠️ 불리한 지역: ${badRegions.join(', ')}`) : null,
      el('div.small.muted', {}, '중복 포획 시 카드가 쌓입니다 [추후 합성(같은 등급 2장 → 상위 등급)에 사용 예정]'),
    ),
    el('p.flavor', {}, `“${monster.flavor}”`),
  );
}

/** % 표기 — 소수 2자리까지 필요한 만큼만 (0.55 → "55%", 0.125 → "12.5%", 0.0625 → "6.25%") */
export function pct1(ratio: number): string {
  const value = Math.round(ratio * 10000) / 100;
  return `${value}%`;
}

/** 지역 출현 테이블을 등급별로 집계 (core buildPlan의 spawnWeightOf와 같은 규칙) */
function spawnOddsByRarity(region: Region, rareWeightMult: number): Map<MonsterRarity, number> {
  const weights = new Map<MonsterRarity, number>();
  let total = 0;
  for (const spawn of region.spawns) {
    const monster = content.monsters.get(spawn.monster)!;
    const weight = spawn.weight * (monster.rarity === 'rare' || monster.rarity === 'heroic' ? rareWeightMult : 1);
    weights.set(monster.rarity, (weights.get(monster.rarity) ?? 0) + weight);
    total += weight;
  }
  const odds = new Map<MonsterRarity, number>();
  for (const [rarity, weight] of weights) odds.set(rarity, weight / total);
  return odds;
}

/** 등급색 게이지 바 — 확률을 한눈에 비교할 수 있게 (유저 공개용 가독성). 행 왼쪽에 등급색 테두리. */
function pctBarRow(label: HTMLElement | string, ratio: number, colorVar: string): HTMLElement {
  const fill = el('div.pct-fill');
  fill.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
  fill.style.background = `var(${colorVar})`;
  const row = el('div.pct-row.edge', {},
    el('div.pct-label', {}, label),
    el('div.pct-track', {}, fill),
    el('strong.pct-value', {}, pct1(ratio)),
  );
  row.style.setProperty('--edge-color', `var(${colorVar})`);
  return row;
}

// 빅탭·칩 선택기·필터 구간은 ui/panels.ts로 이전 (2026-08-25) — 화면·편성 시트와 공유한다.

/**
 * 확률 정보 — 유저에게 공개되는 확률 고지 (밸런스 데이터에서 파생, 하드코딩 없음).
 * 추후 관리자 페이지로 대체 예정 (M6 확률 고지 페이지의 원본 데이터).
 */
function oddsSheet(): HTMLElement {
  const { balance } = content;
  const state = save();
  const rarities = RARITY_ASC; // 순서 정본은 RARITIES — 라벨 객체의 키 순서에 기대지 않는다 (2026-08-25)
  const extendedMult = balance.tiers.extended.rareWeightMult;
  const deepMult = balance.tiers.deep.rareWeightMult;
  const rarityTag = (rarity: MonsterRarity) => el(`span.tag.rar-${rarity}`, {}, MONSTER_RARITY_LABEL[rarity]);

  // ── 탭 1: 몬스터 — 포획 + 지역별 등장 (지역은 칩으로 1개씩) ──
  const captureCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '🎯 포획 확률'),
    el('div.muted.small', {}, '조우 승리 시 등급별 기본 확률로 포획을 시도합니다.'),
    // 0%인 등급은 행을 만들지 않는다 — 초월은 조우 자체가 없어 "0%" 행이 뜨면 오히려 오해를 부른다 (2026-08-25)
    ...rarities
      .filter((rarity) => (balance.capture.base[rarity] ?? 0) > 0)
      .map((rarity) => pctBarRow(rarityTag(rarity), balance.capture.base[rarity] ?? 0, `--rar-${rarity}`)),
    el('div.odds-note', {},
      el('div.small.muted', {}, `· 미끼 적재 시 ×${balance.capture.lureMult} [희귀 이상 조우에 자동 사용됩니다]`),
      el('div.small.muted', {}, `· 확률 배수 상한 ×${balance.capture.multCap} · 최종 확률 상한 ${pct1(balance.capture.chanceCap)}`),
      balance.capture.firstCaptureGuarantee ? el('div.small.muted', {}, '· 계정의 첫 포획은 100% 성공합니다') : null,
    ),
  );

  const regionViews = content.regionList.map((region) => {
    const base = spawnOddsByRarity(region, 1);
    const extended = spawnOddsByRarity(region, extendedMult);
    const deep = spawnOddsByRarity(region, deepMult);
    const legendNames = region.legendary.map((id) => content.monsters.get(id)?.name ?? id).join('·');
    return {
      key: region.id,
      // 잠금 자물쇠는 뺐다 (2026-08-30 사용자) — 확률 고지는 '어디서 무엇이 몇 %로 나오나'를
      // 보여주는 표라, 지금 갈 수 있는지는 여기서 답할 질문이 아니다 (그건 원정 화면의 몫)
      label: `${region.icon} ${region.name}`,
      view: el('div.stack-sm', {},
        el('div.odds-grid.odds-head', {},
          el('span', {}, '등급'), el('span', {}, `${TIER_NAME.scout}·${TIER_NAME.standard}`),
          el('span', {}, TIER_NAME.extended), el('span', {}, TIER_NAME.deep),
        ),
        ...rarities.filter((rarity) => base.has(rarity)).map((rarity) =>
          el('div.odds-grid', {},
            rarityTag(rarity),
            el('span', {}, pct1(base.get(rarity) ?? 0)),
            el('span', {}, pct1(extended.get(rarity) ?? 0)),
            el('span', {}, pct1(deep.get(rarity) ?? 0)),
          ),
        ),
        // 전설 이름은 지역마다 길이가 달라 한 문장에 붙이면 어중간하게 접힌다 — 이름 줄과 규칙 줄을 나눈다 (2026-09-02)
        el('div.small.muted', {}, `⭐ 전설 (${legendNames})`),
        el('div.small.muted', {},
          `· ${TIER_LABEL.deep}마다 ${pct1(balance.tiers.deep.legendaryChance)} 확률로 조우에 포함`),
      ),
    };
  });
  const firstUnlocked = Math.max(0, content.regionList.findIndex((region) => isRegionUnlocked(content, state, region.id)));
  const traces = balance.legendTraces;
  // 지역 칩은 2열 고정 — 12개나 되고 이름 길이가 제각각이라 flex-wrap이면 줄마다 왼쪽 변이
  // 어긋난다 (2026-08-30 사용자). chipPanels가 [칩바, ...패널]을 주므로 칩바에만 클래스를 얹는다
  const [regionChips, ...regionPanels] = chipPanels(regionViews, { initial: firstUnlocked });
  regionChips?.classList.add('chips-grid2');
  const regionCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '🗺️ 지역별 등장 확률'),
    ...(regionChips ? [regionChips] : []),
    ...regionPanels,
    // 흔적은 전설 확률을 바꾸는 요소라 확률 고지에 명시한다 (확률형 아이템 고지 의무)
    el('div.small.muted', {},
      `✨ 전설의 흔적: 완주 시 발견 (${TIERS.filter((t) => traces.dropChance[t] > 0)
        .map((t) => `${TIER_NAME[t]} ${pct1(traces.dropChance[t])}`).join(' · ')}) — `
      + `다음 ${TIER_LABEL.deep} 출발 시 소모되어 전설 확률을 1개당 +${pct1(traces.bonusPerTrace)}p 올립니다 `
      + `[최대 ${traces.maxStacks}개 · 발견 후 ${traces.ttlHours}시간 유효]`),
    // 난이도 배수 고지 (GDD §5.1 난이도, 2026-09-02) — 확률을 바꾸는 요소는 여기 명시. 보통은 위 표 그대로
    el('div.small.muted', {},
      `🎚️ 난이도 [${balance.difficultyTiers.map((t) => TIER_NAME[t]).join('·')}에서 선택] — 보통은 위 표 그대로`),
    ...DIFFICULTIES.filter((d) => d !== 'normal').map((d) => {
      const df = balance.difficulties[d];
      return el('div.small.muted', {},
        `· ${DIFFICULTY_LABEL[d]}: 적 ×${df.enemyMult} · 골드 ×${df.goldMult} · 희귀 +${df.rareWeightAdd} · 전설 +${Math.round(df.legendaryAdd * 10000) / 100}%p`); // 375px 한 줄 · 0.25%p처럼 소수 둘째 자리까지
    }),
  );
  const monsterPanel = el('div.stack-sm', {}, captureCard, regionCard);

  // ── 탭 2: 합성 — 카드·유물 공통 확률 ──
  const fusionPanel = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '🧬 합성 성공 확률'),
    el('div.muted.small', {}, `같은 등급 여분 ${balance.fusion.materials}장으로 다음 등급 1종에 도전합니다.`),
    ...FUSABLE_RARITIES.map((rarity) => {
      const nextRarity = FUSION_NEXT[rarity]!;
      const label = el('span.fusion-step', {},
        rarityTag(rarity),
        el('span.muted', {}, ' → '),
        rarityTag(nextRarity),
      );
      return pctBarRow(label, balance.fusion.chance[rarity] ?? 0, `--rar-${nextRarity}`);
    }),
    el('div.odds-note', {},
      el('div.small.muted', {}, '· 성공: 해금한 지역의 다음 등급 몬스터 중 랜덤 1종 (미보유 종이면 도감 등록)'),
      el('div.small.muted', {}, '· 실패: 재료 2장 중 1장이 사라지고, 1장은 돌아옵니다'),
      el('div.small.muted', {}, '· 종별 마지막 1장은 재료로 쓸 수 없습니다 (육성 보호)'),
      el('div.small.muted', {}, '· 유물 합성도 같은 확률입니다 [같은 등급 유물 2개 → 다음 등급 랜덤 1개 · 실패 시 1개 반환]'),
      // 초월은 유일한 획득 경로가 합성이므로 확률 고지에 명시한다 (2026-08-25 사용자)
      el('div.small.muted', {},
        `· ${RARITY_LABEL.transcendent}은 오직 합성으로만 얻습니다 [조우·발굴·상점 뽑기에는 등장하지 않습니다]`),
      // 확률형 아이템 고지 — 실제 규칙(core/economy.ts)과 반드시 일치시킨다. 2026-08-31 관문 개편:
      // 재료 서식 제한 철폐 + 분화구 심장부 해금 관문. 유물 관문(화산 권역)은 지역이 달라 나란히 적어 혼동을 막는다
      el('div.small.muted', {},
        `· ${RARITY_LABEL.transcendent} 카드 도전은 ${transcendGateRegion(content).name} 해금 후에 열립니다 [재료는 모든 지역의 ${RARITY_LABEL.legendary} 여분 카드]`),
      el('div.small.muted', {},
        `· ${RARITY_LABEL.transcendent} 유물 도전은 ${finalTierEntry(content).name} 해금 후에 열립니다 [화산 권역 진입 시점 — 카드 관문보다 앞]`),
    ),
  );

  // ── 탭 3: 유물 — 발굴 등급 확률 + 발굴 기회 ──
  const artifactRarities = RARITY_ASC;
  const { sources } = balance.artifacts;
  const artifactPanel = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '💎 유물 등급 확률'),
    el('div.muted.small', {}, '유물이 발굴될 때 등급이 아래 확률로 결정됩니다.'),
    ...artifactRarities
      .filter((rarity) => (balance.artifacts.dropRarity[rarity] ?? 0) > 0)
      .map((rarity) =>
        pctBarRow(el(`span.tag.rar-${rarity}`, {}, ARTIFACT_RARITY_LABEL[rarity]), balance.artifacts.dropRarity[rarity] ?? 0, `--rar-${rarity}`)),
    el('div.odds-note', {},
      el('div.small.muted', {}, `· 발굴 기회 [보물 이벤트의 ${pct1(sources.treasureChance)} · 전설 조우 승리 시 ${pct1(sources.legendaryEncounter)} · 갈림길 대성공 시 ${pct1(sources.crossroadCrit)}]`),
      sources.deepClearBox ? el('div.small.muted', {}, `· ${TIER_LABEL.deep} 완주 상자에서는 유물이 확정입니다`) : null,
      balance.artifacts.firstTreasurePity ? el('div.small.muted', {}, '· 계정의 첫 보물 이벤트에서는 유물이 확정입니다') : null,
    ),
  );

  // ── 탭 4: 상점 뽑기 — 확률형 아이템 고지 (GDD §9.4), 상품은 칩으로 1개씩 ──
  const { shop } = balance;
  const gachaView = (table: Record<string, number>) =>
    el('div.stack-sm', {}, ...rarities.filter((rarity) => (table[rarity] ?? 0) > 0).map((rarity) =>
      pctBarRow(rarityTag(rarity), table[rarity] ?? 0, `--rar-${rarity}`)));
  const shopPanel = el('div.card.stack-sm', {},
    el('div.odds-title', {}, uiIcon('shop-stall', '🏪', '상점'), ' 상점 뽑기 확률'),
    el('div.muted.small', {}, '몬스터 뽑기는 해금한 지역의 몬스터 중에서, 유물 발굴은 전체 유물 중에서 아래 등급 확률로 1개가 결정됩니다. 10장 상품은 같은 확률이 장마다 독립 적용됩니다.'),
    ...chipPanels([
      { key: 'goldNormal', label: '🃏 뽑기 [골드]', view: gachaView(shop.monsterGacha.goldNormal!) },
      { key: 'goldAdvanced', label: '🌟 고급 뽑기 [골드]', view: gachaView(shop.monsterGacha.goldAdvanced!) },
      { key: 'normal', label: '🃏 뽑기·10 [다이아]', view: gachaView(shop.monsterGacha.normal!) },
      { key: 'premium', label: '🌟 고급 뽑기·10', view: gachaView(shop.monsterGacha.premium!) },
      { key: 'standard', label: '🏺 유물 발굴·10', view: gachaView(shop.artifactGacha.standard!) },
      { key: 'artGoldAdvanced', label: '🔮 고급 발굴 [골드]', view: gachaView(shop.artifactGacha.goldAdvanced!) },
      { key: 'artPremium', label: '🔮 고급 발굴·10', view: gachaView(shop.artifactGacha.premium!) },
    ]),
  );

  // ── 탭 바 — 모바일 한 화면 분량으로 분할 (2026-08-24) ──
  return sheetShell('확률 정보',
    el('div.muted.small', {}, '아래 확률은 게임 데이터의 실제 값 그대로입니다. 모든 판정은 파견 시 확정된 시드에서 결정됩니다.'),
    ...tabPanels([
      { key: 'monster', label: '몬스터', view: monsterPanel },
      { key: 'fusion', label: '합성', view: fusionPanel },
      { key: 'artifact', label: '유물', view: artifactPanel },
      { key: 'shop', label: '상점 뽑기', view: shopPanel },
    ]),
  );
}

/** 속성 정보 — 상성 구조·전투력 배수·지역별 유불리. 확률 정보처럼 유저 공개용 (2026-08-23) */
function elementInfoSheet(): HTMLElement {
  const { balance } = content;

  const structureCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '⚔️ 상성 구조'),
    el('div.elem-flow', {}, '🔥 화염 → 🌿 자연 → ❄️ 냉기 → 🔥 화염'),
    el('div.small.muted', {}, '화살표 방향으로 유리 [화염은 자연에게, 자연은 냉기에게, 냉기는 화염에게 강합니다]'),
    el('div.elem-flow', {}, '☀️ 빛 ↔ 🌑 어둠'),
    el('div.small.muted', {}, '빛과 어둠은 서로에게 유리합니다.'),
  );

  const multRow = (label: string, mult: number) =>
    el('div.list-row', {},
      el('span.small', {}, label),
      el(`strong${mult > 1 ? '.cp-ok' : mult < 1 ? '.cp-low' : ''}`, {}, `×${mult}`),
    );
  const multCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '✨ 전투력 배수'),
    el('div.muted.small', {}, '몬스터끼리 겨루는 것이 아니라, 파티 몬스터의 속성과 지역의 우세 속성으로 판정됩니다.'),
    multRow('지역과 같은 속성', balance.element.same),
    multRow('지역 속성을 이기는 속성', balance.element.advantage),
    multRow('지역 속성에게 지는 속성', balance.element.disadvantage),
    multRow('무관한 속성', 1),
  );

  // 지역별 유·불리 — elementMult 실제 계산값으로 도출해 밸런스 수치와 어긋나지 않게
  const neutralEverywhere = ELEMENTS.filter((element) =>
    content.regionList.every((region) => elementMult(element, region.element, balance) === 1));
  const regionCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '🗺️ 지역별 유리·불리'),
    // 우세 속성 표시는 뺐다 (2026-08-30 사용자) — 유·불리 두 칸이 이미 그 결과를 보여준다.
    // 지역 이모지는 한 번 뺐다가 되살렸다: 줄바꿈의 원인이 이모지가 아니라 격자였기 때문.
    // 헤더는 '유리/불리' 대신 실제로 일어나는 일(피해증가/피해감소)로 쓴다.
    // 3열 전용 격자(.elem-region-grid)를 쓰는 이유는 CSS 주석 참고 — 4열짜리 확률 표를
    // 돌려쓰다 빈 열이 폭을 먹어 지역 이름이 줄바꿈되고 있었다
    el('div.elem-region-grid.odds-head', {},
      el('span', {}, '지역'), el('span', {}, '피해증가'), el('span', {}, '피해감소'),
    ),
    ...content.regionList.map((region) => {
      const good = ELEMENTS.filter((element) => elementMult(element, region.element, balance) > 1);
      const bad = ELEMENTS.filter((element) => elementMult(element, region.element, balance) < 1);
      return el('div.elem-region-grid', {},
        el('span', {}, `${region.icon} ${region.name}`),
        el('span.cp-ok', {}, good.map((element) => ELEMENT_EMOJI[element]).join(' ')),
        el('span.cp-low', {}, bad.map((element) => ELEMENT_EMOJI[element]).join(' ')),
      );
    }),
    el('div.odds-note', {},
      neutralEverywhere.length > 0
        ? el('div.small.muted', {},
            `· ${neutralEverywhere.map((element) => ELEMENT_LABEL[element]).join(' · ')} [현재 모든 지역에서 ×1 · 보너스도 페널티도 없이 어디서나 안정적입니다]`)
        : null,
      el('div.small.muted', {}, '· 이 배수는 편성 화면 유효 전투력에 자동 반영됩니다'),
    ),
  );

  return sheetShell('속성 정보',
    el('div.muted.small', {}, '속성은 파티 몬스터와 지역의 우세 속성 사이에서 판정되어, 각 몬스터의 전투력에 배수로 곱해집니다.'),
    structureCard,
    multCard,
    regionCard,
  );
}

/**
 * 전체 몬스터 데이터 뷰 — 도감 진행과 무관하게 104종 전부, 등급·속성·종족·기본 스탯.
 * 추후 관리자 전용 메뉴로 전환 예정 (지금은 설정에서 진입).
 */
/**
 * 등급 구간을 filterSections에 넘길 형태로 — 라벨·색은 여기서 주입한다 (panels.ts는 등급을 모른다).
 * 등급 오름차순(일반→전설)은 '읽는 화면'의 규칙 (2026-08-25 사용자 확정).
 */
function raritySections(sections: { rarity: MonsterRarity; view: HTMLElement }[]): Panel<MonsterRarity>[] {
  return sections.map((section) => ({
    key: section.rarity,
    label: MONSTER_RARITY_LABEL[section.rarity],
    cls: `rar-${section.rarity}`,
    view: section.view,
  }));
}

/** 업데이트 내역 (검토 ⑧) — 파일 관리형(content/releaseNotes.ts), 최신 버전만 기본 펼침 */
function releaseNotesSheet(): HTMLElement {
  return sheetShell('📝 업데이트 내역',
    el('div.sheet-body', {},
      ...RELEASE_NOTES.map((note, index) => {
        const detail = el<'details'>('details.release-note', {},
          el('summary.release-note-head', {},
            el('strong', {}, note.version),
            el('span.muted.small', {}, note.date),
          ),
          el('ul.release-note-items', {},
            ...note.items.map((item) => el('li', {}, item)),
          ),
        );
        detail.open = index === 0; // el() props에 open이 없어 직접 — 최신 버전만 기본 펼침
        return detail;
      }),
    ),
  );
}

function monsterInfoSheet(): HTMLElement {
  const { balance } = content;
  const regionPanels = content.regionList.map((region) => {
    const natives = content.monsterList.filter((monster) => monster.habitat === region.id);
    // 등급 오름차순(일반→전설) 구간 — 필터 칩이 구간 단위로 표시/숨김을 토글한다
    const sections = RARITY_ASC.flatMap((rarity) => {
      const members = natives.filter((monster) => monster.rarity === rarity);
      if (members.length === 0) return [];
      return [{
        rarity,
        view: el('div', {},
          el('div.info-group-head', {},
            el(`span.tag.rar-${rarity}`, {}, MONSTER_RARITY_LABEL[rarity]),
            el('span.muted.small', {}, `${members.length}종`),
          ),
          ...members.map((monster) =>
            el('div.info-row', {},
              monsterIcon(monster.id),
              el('div.info-body', {},
                el('div.info-name', {},
                  monster.name,
                  el('span.mchip-elems', { title: `${ELEMENT_LABEL[monster.element]} · ${TRIBE_LABEL[monster.tribe]}` },
                    ` ${ELEMENT_EMOJI[monster.element]}${TRIBE_EMOJI[monster.tribe]}`),
                ),
                el('div.muted.small', {}, `“${monster.flavor}”`),
              ),
              el('div.info-stats', {},
                el(`span.tag.rar-${monster.rarity}`, {}, MONSTER_RARITY_LABEL[monster.rarity]),
                el('div.small', {}, `공 ${monster.baseAtk} · 생 ${monster.baseHp}`),
                el('div.small.muted', {}, `CP ${Math.round(monsterBaseCp(monster, balance))}`),
              ),
            ),
          ),
        ),
      }];
    });
    return {
      key: region.id,
      // 탭 폭이 좁아 지역명 마지막 어절만 (물안개 해안 → 해안)
      label: `${region.icon} ${region.name.split(' ').pop()}`,
      view: el('div.card.stack-sm', {}, ...filterSections(raritySections(sections))),
    };
  });

  return sheetShell('몬스터 정보',
    el('div.muted.small', {}, `전체 ${content.monsterList.length}종 · 기본 스탯 기준 (레벨·성급 보정 전) · 관리자용 데이터 뷰`),
    ...tabPanels(regionPanels),
  );
}

/**
 * 전체 유물 데이터 뷰 — 56점 전부, 등급·슬롯·주옵션·고유 능력·세트 효과.
 * 추후 관리자 전용 메뉴로 전환 예정 (지금은 설정에서 진입).
 */
function artifactInfoSheet(): HTMLElement {
  const { balance } = content;
  // 유물은 지역 개념이 없어 슬롯 4탭 + 세트 탭으로 분할, 탭 안은 등급 오름차순 구간 + 등급 필터 칩
  const slotPanels = (Object.keys(SLOT_LABEL) as (keyof typeof SLOT_LABEL)[]).map((slot) => {
    const inSlot = [...content.artifacts.values()].filter((def) => def.slot === slot);
    const sections = RARITY_ASC.flatMap((rarity) => {
      const defs = inSlot.filter((def) => def.rarity === rarity);
      if (defs.length === 0) return [];
      return [{
        rarity,
        view: el('div', {},
          el('div.info-group-head', {},
            el(`span.tag.rar-${rarity}`, {}, ARTIFACT_RARITY_LABEL[rarity]),
            el('span.muted.small', {}, `${defs.length}점`),
          ),
          ...defs.map((def) => {
            const setDef = def.set ? content.sets.get(def.set) : null;
            return el('div.info-row', {},
              artifactIcon(def.id),
              el('div.info-body', {},
                el('div.info-name', {}, def.name),
                el('div.small.muted', {},
                  `주옵션 · ${mainLabel(def.main.stat)} ${fmtEffect(def.main.stat, def.main.base)} (강화당 ${fmtEffect(def.main.stat, def.main.perEnhance)})`),
                ...def.unique.map((effect) => el('div.small.unique-row', {}, `✦ ${describeEffect(effect)}`)),
              ),
              el('div.info-stats', {},
                el(`span.tag.rar-${def.rarity}`, {}, ARTIFACT_RARITY_LABEL[def.rarity]),
                setDef ? el('div.small.muted', {}, `${setDef.name} 세트`) : null,
              ),
            );
          }),
        ),
      }];
    });
    return {
      key: slot,
      label: SLOT_LABEL[slot] ?? slot,
      view: el('div.card.stack-sm', {}, ...filterSections(raritySections(sections))),
    };
  });

  const setCards = [...content.sets.entries()].map(([setId, setDef]) => {
    const members = [...content.artifacts.values()].filter((def) => def.set === setId);
    return el('div', {},
      el('div.small', {}, `◆ ${setDef.name}`),
      el('div.small.muted', {}, `2세트: ${setDef.bonuses['2'].map(describeEffect).join(', ')}`),
      el('div.small.muted', {}, `4세트: ${setDef.bonuses['4'].map(describeEffect).join(', ')}`),
      el('div.small.muted', {}, `구성: ${members.map((m) => m.name).join(' · ')}`),
    );
  });
  const setPanel = {
    key: 'set',
    label: '세트',
    view: el('div.card.stack-sm', {},
      el('div.odds-title', {}, '세트 효과'),
      ...setCards,
    ),
  };

  return sheetShell('유물 정보',
    el('div.muted.small', {}, `전체 ${content.artifacts.size}점 · 주옵션은 +0 기준 · 관리자용 데이터 뷰`),
    ...tabPanels([...slotPanels, setPanel]),
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
    el('div.muted.small', {}, '🛡️ 안전 [소소한 보상 확정] · ⚡ 위험 [전투력 판정, 성공 시 희귀 보상·실패 시 HP 피해]'),
    el('div.muted.small', {}, '선택하지 않으면 원정대는 안전한 길을 고릅니다.'),
    ...rows,
    done
      ? el('button.btn.btn-primary.btn-big', {
          onclick: () => {
            const result = claim(expeditionId);
            if (result) overlay.set({ kind: 'journal', ...result });
          },
        }, pendingCount > 0 ? `📜 일지 정산 [남은 ${pendingCount}곳은 안전한 길로]` : '📜 일지 정산')
      : null,
  );
}

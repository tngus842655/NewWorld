/**
 * 오버레이 — 일지 / 몬스터 상세 / 유물 상세 / 갈림길 선택.
 */
import { content } from '../content';
import { ELEMENTS, type MonsterRarity, type Region } from '../content/schema';
import { elementMult, enhanceCost, investedEnhanceDust, levelUpCost, monsterBaseCp, starUpCost, statAt } from '../core/formulas';
import { artifactScore, monsterBaseScore, monsterScore } from '../core/score';
import { isRegionUnlocked } from '../core/progression';
import * as clock from '../state/clock';
import { awaken, choose, claim, crossroadsOf, enhance, levelUp, salvage, save } from '../state/store';
import { artifactFusionSheet } from './artifactFusionSheet';
import { FUSION_NEXT, fusionSheet } from './fusionSheet';
import { artifactPickSheet, partyPickSheet } from './pickSheets';
import { rankingSheet, tasksSheet } from './rankingSheets';
import { shopSheet } from './shopSheet';
import { artifactIcon, fmtEffect, mainLabel, monsterIcon, ownedCp } from './components';
import { askConfirm } from './dialog';
import { describeEffect } from './effectText';
import {
  ARTIFACT_RARITY_LABEL, ELEMENT_EMOJI, ELEMENT_LABEL, MONSTER_RARITY_LABEL, SLOT_LABEL,
  TIER_LABEL, TRIBE_EMOJI, TRIBE_LABEL, el, fmtGold, stars,
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
        ? monsterSheet(current.monsterId)
        : current.kind === 'artifact'
          ? artifactSheet(current.uid)
          : current.kind === 'species'
            ? speciesSheet(current.monsterId)
            : current.kind === 'help'
              ? helpSheet()
            : current.kind === 'ranking'
              ? rankingSheet()
            : current.kind === 'shop'
              ? shopSheet()
            : current.kind === 'tasks'
              ? tasksSheet()
              : current.kind === 'fusion'
                ? fusionSheet()
                : current.kind === 'artifactFusion'
                  ? artifactFusionSheet()
                : current.kind === 'partyPick'
                  ? partyPickSheet()
                : current.kind === 'artifactPick'
                  ? artifactPickSheet()
                : current.kind === 'odds'
                  ? oddsSheet()
                : current.kind === 'elementInfo'
                  ? elementInfoSheet()
                : current.kind === 'monsterInfo'
                  ? monsterInfoSheet()
                  : current.kind === 'artifactInfo'
                    ? artifactInfoSheet()
                    : crossroadsSheet(current.expeditionId);
  if (!sheet) return null;
  return el('div.overlay', { onclick: (event) => { if (event.target === event.currentTarget) closeOverlay(); } }, sheet);
}

export function sheetShell(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
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
  const upCost = maxLevel ? 0 : levelUpCost(owned.level, balance);
  const starCost = maxStar ? 0 : starUpCost(owned.star, balance);
  const busy = state.expeditions.some((e) => !e.claimed && e.partyIds.includes(monsterId));

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
        el('div.muted.small', {}, `보유 카드 ${owned.count}장 — 중복 포획으로 누적 (추후 합성 재료)`),
        el('div.muted.small', {}, `🏆 랭킹 점수 ${monsterScore(content, owned)} — 레벨·성급을 올리면 커집니다`),
        busy ? el('div.tag.busy-tag', {}, '🧭 원정 중') : null,
      ),
    ),
    el('div.stat-row', {},
      statCell('공격', atk, gains?.atk),
      statCell('생명', hp, gains?.hp),
      statCell('전투력', cp, gains?.cp),
    ),
    el('p.flavor', {}, `“${monster.flavor}”`),
    el('div.row-gap', {},
      el('button.btn.btn-primary', {
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
        el('div.muted.small', {}, `🏆 랭킹 점수 ${artifactScore(content, owned)} — 강화하면 커집니다`),
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
          const invested = investedEnhanceDust(owned.enhance, balance);
          const gain = balance.artifacts.dustPerSalvage[def.rarity] + invested;
          void askConfirm({
            title: '유물 분해',
            message: `${def.name}을(를) 분해해 가루 ${gain}을 얻습니다${invested > 0 ? ` (강화에 쓴 가루 ${invested} 전액 포함)` : ''}. 되돌릴 수 없습니다.`,
            confirmLabel: '분해',
            danger: true,
          }).then((ok) => {
            if (!ok) return;
            if (salvage(uid)) playSfx('salvage');
            closeOverlay();
          });
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
      synergy
        ? el('div', {},
            el('div.muted.small', {}, `${TRIBE_LABEL[monster.tribe]} 시너지 (같은 종족 편성 시)`),
            el('div.small', {}, `2마리: ${synergy.at2.map(describeEffect).join(', ')}`),
            el('div.small', {}, `3마리: ${synergy.at3.map(describeEffect).join(', ')}`),
          )
        : null,
      goodRegions.length > 0 ? el('div.small', {}, `⚔️ 유리한 지역: ${goodRegions.join(', ')}`) : null,
      badRegions.length > 0 ? el('div.small.muted', {}, `⚠️ 불리한 지역: ${badRegions.join(', ')}`) : null,
      el('div.small.muted', {}, '중복 포획 시 카드가 쌓입니다 — 추후 합성(같은 등급 2장 → 상위 등급)에 사용 예정'),
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
    row('💰', '골드', '조우 승리 · 보물 · 일지 정산 · 도감 마일스톤', '몬스터 레벨업·각성 · 파티 슬롯 확장 · 미끼 제작'),
    row('✨', '가루', '유물 분해', '유물 강화'),
    row('🪤', '미끼', '캠프에서 제작 (지역 재료 + 골드)', '파견에 자동 적재 — 희귀 이상 몬스터 포획률 ×2'),
    el('div.muted.small', {}, '지역 재료 보유량은 캠프 화면에서, 몬스터 카드 수는 도감·캠프 아이콘에서 볼 수 있습니다.'),
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

/** 등급색 게이지 바 — 확률을 한눈에 비교할 수 있게 (유저 공개용 가독성) */
function pctBarRow(label: HTMLElement | string, ratio: number, colorVar: string): HTMLElement {
  const fill = el('div.pct-fill');
  fill.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
  fill.style.background = `var(${colorVar})`;
  return el('div.pct-row', {},
    el('div.pct-label', {}, label),
    el('div.pct-track', {}, fill),
    el('strong.pct-value', {}, pct1(ratio)),
  );
}

/**
 * 확률 정보 — 유저에게 공개되는 확률 고지 (밸런스 데이터에서 파생, 하드코딩 없음).
 * 추후 관리자 페이지로 대체 예정 (M6 확률 고지 페이지의 원본 데이터).
 */
function oddsSheet(): HTMLElement {
  const { balance } = content;
  const state = save();
  const rarities = Object.keys(MONSTER_RARITY_LABEL) as MonsterRarity[];
  const deepMult = balance.tiers.deep.rareWeightMult;
  const tierName = (tier: 'scout' | 'standard' | 'deep') => TIER_LABEL[tier].split(' ')[0];
  const rarityTag = (rarity: MonsterRarity) => el(`span.tag.rar-${rarity}`, {}, MONSTER_RARITY_LABEL[rarity]);

  // 1) 포획 확률 — 등급별 게이지
  const captureCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '🎯 몬스터 포획 확률'),
    el('div.muted.small', {}, '조우에서 승리하면 등급별 기본 확률로 포획을 시도합니다.'),
    ...rarities.map((rarity) => pctBarRow(rarityTag(rarity), balance.capture.base[rarity] ?? 0, `--rar-${rarity}`)),
    el('div.odds-note', {},
      el('div.small.muted', {}, `· 미끼 적재 시 ×${balance.capture.lureMult} — 희귀 이상 조우에 자동 사용됩니다`),
      el('div.small.muted', {}, `· 확률 배수 상한 ×${balance.capture.multCap} · 최종 확률 상한 ${pct1(balance.capture.chanceCap)}`),
      balance.capture.firstCaptureGuarantee ? el('div.small.muted', {}, '· 계정의 첫 포획은 100% 성공합니다') : null,
    ),
  );

  // 2) 카드 합성 — 등급 전환별 성공 확률
  const fusionCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '🧬 카드 합성 성공 확률'),
    el('div.muted.small', {}, `같은 등급 여분 카드 ${balance.fusion.materials}장으로 다음 등급 랜덤 1종에 도전합니다.`),
    ...(['common', 'uncommon', 'rare', 'heroic'] as const).map((rarity) => {
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
      el('div.small.muted', {}, '· 각 종의 마지막 1장은 재료로 쓸 수 없습니다 (육성 보호)'),
      el('div.small.muted', {}, '· 유물 합성도 같은 확률입니다 — 같은 등급 유물 2개 → 다음 등급 랜덤 1개 (실패 시 1개 반환)'),
    ),
  );

  // 3) 지역별 몬스터 등급 출현 확률 (기본 / 심층)
  const regionCards = content.regionList.map((region) => {
    const unlocked = isRegionUnlocked(content, state, region.id);
    const base = spawnOddsByRarity(region, 1);
    const deep = spawnOddsByRarity(region, deepMult);
    const legendNames = region.legendary.map((id) => content.monsters.get(id)?.name ?? id).join('·');
    return el('div.card.stack-sm', {},
      el('div.odds-title', {}, `${unlocked ? '' : '🔒 '}${region.icon} ${region.name}`),
      el('div.odds-grid.odds-head', {},
        el('span', {}, '등급'), el('span', {}, `${tierName('scout')}·${tierName('standard')}`), el('span', {}, tierName('deep')),
      ),
      ...rarities.filter((rarity) => base.has(rarity)).map((rarity) =>
        el('div.odds-grid', {},
          rarityTag(rarity),
          el('span', {}, pct1(base.get(rarity) ?? 0)),
          el('span', {}, pct1(deep.get(rarity) ?? 0)),
        ),
      ),
      el('div.small.muted', {},
        `⭐ 전설 (${legendNames}) — ${tierName('deep')}마다 ${pct1(balance.tiers.deep.legendaryChance)} 확률로 조우에 포함`),
    );
  });

  // 4) 유물 등급 확률 + 발굴 기회
  const artifactRarities = Object.keys(ARTIFACT_RARITY_LABEL) as (keyof typeof ARTIFACT_RARITY_LABEL)[];
  const { sources } = balance.artifacts;
  const artifactOddsCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '💎 유물 등급 확률'),
    el('div.muted.small', {}, '유물이 발굴될 때 등급이 아래 확률로 결정됩니다.'),
    ...artifactRarities
      .filter((rarity) => (balance.artifacts.dropRarity[rarity] ?? 0) > 0)
      .map((rarity) =>
        pctBarRow(el(`span.tag.rar-${rarity}`, {}, ARTIFACT_RARITY_LABEL[rarity]), balance.artifacts.dropRarity[rarity] ?? 0, `--rar-${rarity}`)),
    el('div.odds-note', {},
      el('div.small.muted', {}, `· 발굴 기회 — 보물 이벤트의 ${pct1(sources.treasureChance)} · 전설 조우 승리 시 ${pct1(sources.legendaryEncounter)} · 갈림길 대성공 시 ${pct1(sources.crossroadCrit)}`),
      sources.deepClearBox ? el('div.small.muted', {}, `· ${tierName('deep')} 완주 상자에서는 유물이 확정으로 나옵니다`) : null,
      balance.artifacts.firstTreasurePity ? el('div.small.muted', {}, '· 계정의 첫 보물 이벤트에서는 유물이 확정으로 나옵니다') : null,
    ),
  );

  // 5) 상점 뽑기 확률 — 확률형 아이템 고지 (GDD §9.4)
  const { shop } = balance;
  const gachaSection = (title: string, table: Record<string, number>, tags: (r: MonsterRarity) => HTMLElement) => [
    el('div.small', {}, title),
    ...rarities.filter((rarity) => (table[rarity] ?? 0) > 0).map((rarity) =>
      pctBarRow(tags(rarity), table[rarity] ?? 0, `--rar-${rarity}`)),
  ];
  const gachaCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '🏪 상점 뽑기 확률'),
    el('div.muted.small', {}, '몬스터 뽑기는 해금한 지역의 몬스터 중에서, 유물 발굴은 전체 유물 중에서 아래 등급 확률로 1개가 결정됩니다.'),
    ...gachaSection('🃏 몬스터 뽑기 (골드 상점)', shop.monsterGacha.goldNormal!, rarityTag),
    ...gachaSection('🃏 몬스터 뽑기 (다이아 상점)', shop.monsterGacha.normal!, rarityTag),
    ...gachaSection('🌟 고급 몬스터 뽑기', shop.monsterGacha.premium!, rarityTag),
    ...gachaSection('🏺 유물 발굴', shop.artifactGacha.standard!, rarityTag),
    ...gachaSection('🔮 고급 유물 발굴', shop.artifactGacha.premium!, rarityTag),
  );

  return sheetShell('확률 정보',
    el('div.muted.small', {}, '아래 확률은 게임 데이터의 실제 값 그대로입니다. 모든 판정은 파견 시 확정된 시드에서 결정됩니다.'),
    captureCard,
    fusionCard,
    ...regionCards,
    artifactOddsCard,
    gachaCard,
  );
}

/** 속성 정보 — 상성 구조·전투력 배수·지역별 유불리. 확률 정보처럼 유저 공개용 (2026-08-23) */
function elementInfoSheet(): HTMLElement {
  const { balance } = content;

  const structureCard = el('div.card.stack-sm', {},
    el('div.odds-title', {}, '⚔️ 상성 구조'),
    el('div.elem-flow', {}, '🔥 화염 → 🌿 자연 → ❄️ 냉기 → 🔥 화염'),
    el('div.small.muted', {}, '화살표 방향으로 유리 — 화염은 자연에게, 자연은 냉기에게, 냉기는 화염에게 강합니다.'),
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
    el('div.odds-grid.odds-head', {},
      el('span', {}, '지역 (우세 속성)'), el('span', {}, '유리'), el('span', {}, '불리'),
    ),
    ...content.regionList.map((region) => {
      const good = ELEMENTS.filter((element) => elementMult(element, region.element, balance) > 1);
      const bad = ELEMENTS.filter((element) => elementMult(element, region.element, balance) < 1);
      return el('div.odds-grid', {},
        el('span', {}, `${region.icon} ${region.name} ${ELEMENT_EMOJI[region.element]}`),
        el('span.cp-ok', {}, good.map((element) => ELEMENT_EMOJI[element]).join(' ')),
        el('span.cp-low', {}, bad.map((element) => ELEMENT_EMOJI[element]).join(' ')),
      );
    }),
    el('div.odds-note', {},
      neutralEverywhere.length > 0
        ? el('div.small.muted', {},
            `· ${neutralEverywhere.map((element) => ELEMENT_LABEL[element]).join(' · ')} — 현재 모든 지역에서 ×1: 보너스도 페널티도 없이 어디서나 안정적입니다`)
        : null,
      el('div.small.muted', {}, '· 이 배수는 원정 편성 화면의 유효 전투력에 자동 반영됩니다'),
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
function monsterInfoSheet(): HTMLElement {
  const { balance } = content;
  const regionCards = content.regionList.map((region) => {
    const natives = content.monsterList.filter((monster) => monster.habitat === region.id);
    const rows = natives.map((monster) =>
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
    );
    return el('div.card.stack-sm', {},
      el('div.odds-title', {}, `${region.icon} ${region.name} (${natives.length}종)`),
      ...rows,
    );
  });

  return sheetShell('몬스터 정보',
    el('div.muted.small', {}, `전체 ${content.monsterList.length}종 · 기본 스탯 기준 (레벨·성급 보정 전) · 관리자용 데이터 뷰`),
    ...regionCards,
  );
}

/**
 * 전체 유물 데이터 뷰 — 56점 전부, 등급·슬롯·주옵션·고유 능력·세트 효과.
 * 추후 관리자 전용 메뉴로 전환 예정 (지금은 설정에서 진입).
 */
function artifactInfoSheet(): HTMLElement {
  const { balance } = content;
  const rarityCards = (['legendary', 'heroic', 'rare', 'uncommon', 'common'] as const).map((rarity) => {
    const defs = [...content.artifacts.values()].filter((def) => def.rarity === rarity);
    const substats = balance.artifacts.substatCount[rarity] ?? 0;
    const rows = defs.map((def) => {
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
          el('span.tag', {}, SLOT_LABEL[def.slot] ?? def.slot),
          setDef ? el('div.small.muted', {}, `${setDef.name} 세트`) : null,
        ),
      );
    });
    return el('div.card.stack-sm', {},
      el('div.odds-title', {},
        el(`span.tag.rar-${rarity}`, {}, ARTIFACT_RARITY_LABEL[rarity]),
        ` ${defs.length}점`,
      ),
      el('div.muted.small', {},
        `부옵션 ${substats}개 · 분해 가루 ${balance.artifacts.dustPerSalvage[rarity]}`),
      ...rows,
    );
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

  return sheetShell('유물 정보',
    el('div.muted.small', {}, `전체 ${content.artifacts.size}점 · 주옵션은 +0 기준 · 관리자용 데이터 뷰`),
    ...rarityCards,
    el('div.card.stack-sm', {},
      el('div.odds-title', {}, '세트 효과'),
      ...setCards,
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

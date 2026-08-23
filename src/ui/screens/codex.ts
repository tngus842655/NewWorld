/**
 * 도감 — 지역별 그리드 (미지 ? / 목격 실루엣 / 포획 컬러 / 각성 금테) + 종족·등급 필터 + 마일스톤.
 */
import { content } from '../../content';
import type { Monster } from '../../content/schema';
import { capturedCounts, type CapturedCounts } from '../../core/progression';
import { signal } from '../../state/signal';
import { save } from '../../state/store';
import { monsterIcon } from '../components';
import { describeEffect } from '../effectText';
import { MONSTER_RARITY_LABEL, TRIBE_LABEL, el, fmtGold } from '../kit';
import { overlay } from '../router';

// 탭을 오가도 유지되는 화면 로컬 필터 (GDD §11)
const tribeFilter = signal<Monster['tribe'] | null>(null);
const rarityFilter = signal<Monster['rarity'] | null>(null);
// 지역 접힘 상태 (기본 접힘 — 캠프와 동일 패턴) + 업적 지역 탭 (2026-08-23)
const openCodexRegions = signal<Record<string, boolean>>({});
const achieveTab = signal<string>(content.regionList[0]!.id); // 지역 id 또는 'common'

function filterChips<T extends string>(
  current: T | null,
  entries: [T, string][],
  pick: (value: T | null) => void,
): HTMLElement {
  return el('div.chips-wrap', {},
    el(`button.chip${current === null ? '.active' : ''}`, { onclick: () => pick(null) }, '전체'),
    ...entries.map(([value, label]) =>
      el(`button.chip${current === value ? '.active' : ''}`,
        { onclick: () => pick(current === value ? null : value) }, label),
    ),
  );
}

export function renderCodex(): HTMLElement {
  const state = save();
  const tribe = tribeFilter();
  const rarity = rarityFilter();
  const captured = Object.values(state.codex).filter((c) => c.captured).length;
  const seen = Object.values(state.codex).filter((c) => c.seen && !c.captured).length;
  const score = Object.entries(state.codex).reduce((sum, [, entry]) => {
    if (entry.awakened) return sum + 5;
    if (entry.captured) return sum + 3;
    if (entry.seen) return sum + 1;
    return sum;
  }, 0);

  // 포획 셀의 아이콘 — 카드 수 대신 레벨·각성 뱃지 (2026-08-23 사용자)
  const capturedIcon = (monster: Monster): HTMLElement => {
    const icon = monsterIcon(monster.id);
    const owned = state.roster.find((m) => m.monsterId === monster.id);
    if (owned) {
      const awakened = state.codex[monster.id]?.awakened;
      icon.append(el('span.micon-count', { title: awakened ? `각성 · Lv.${owned.level}` : `Lv.${owned.level}` },
        `${awakened ? '✨' : ''}Lv.${owned.level}`));
    }
    return icon;
  };

  const sections = content.regionList.map((region) => {
    const allNatives = content.monsterList.filter((m) => m.habitat === region.id);
    const regionCaptured = allNatives.filter((m) => state.codex[m.id]?.captured).length;
    const natives = allNatives.filter(
      (m) => (tribe === null || m.tribe === tribe) && (rarity === null || m.rarity === rarity),
    );
    if (natives.length === 0) return null;
    const open = openCodexRegions()[region.id] === true;

    const cells = natives.map((monster) => {
      const entry = state.codex[monster.id];
      const openSpecies = () => overlay.set({ kind: 'species', monsterId: monster.id });
      if (entry?.captured) {
        return el(`div.codex-cell${entry.awakened ? '.awakened' : ''}`, {
          title: `${monster.name} · ${MONSTER_RARITY_LABEL[monster.rarity]}`,
          onclick: openSpecies,
        },
          capturedIcon(monster),
          el('div.codex-name', {}, monster.name),
        );
      }
      if (entry?.seen) {
        return el('div.codex-cell.seen', { title: '목격 — 아직 포획하지 못했다', onclick: openSpecies },
          monsterIcon(monster.id, { silhouette: true }),
          el('div.codex-name.muted', {}, monster.name),
        );
      }
      return el('div.codex-cell.unknown', {}, el('div.codex-q', {}, '?'), el('div.codex-name.muted', {}, '???'));
    });

    // 접힘: 아이콘만 가로 슬라이드 (캠프와 동일 패턴)
    const iconRow = el('div.roster-row', {}, ...natives.map((monster) => {
      const entry = state.codex[monster.id];
      const openSpecies = () => overlay.set({ kind: 'species', monsterId: monster.id });
      if (entry?.captured) {
        return el('button.roster-icon', { title: monster.name, onclick: openSpecies }, capturedIcon(monster));
      }
      if (entry?.seen) {
        return el('button.roster-icon', { title: '목격', onclick: openSpecies }, monsterIcon(monster.id, { silhouette: true }));
      }
      return el('div.micon.roster-unknown', { title: '???' }, el('span.micon-fallback', {}, '?'));
    }));

    return el('div.card.stack-sm', {},
      el('button.roster-head', {
        onclick: () => openCodexRegions.set({ ...openCodexRegions(), [region.id]: !open }),
      },
        el('span', {}, `${region.icon} ${region.name} (${regionCaptured}/${allNatives.length})`),
        el('span.muted.small', {}, open ? '접기 ∧' : '펼치기 ∨'),
      ),
      open ? el('div.codex-grid', {}, ...cells) : iconRow,
    );
  });
  const visibleSections = sections.filter((s): s is HTMLElement => s !== null);

  // 업적(구 마일스톤) — 지역 4탭 + 공통, 달성 수 표시 (2026-08-23 사용자)
  const counts = capturedCounts(content, state);
  const achievementGroups = [
    ...content.regionList.map((region) => ({
      key: region.id,
      label: `${region.icon} ${region.name.split(' ').pop()}`,
      items: content.milestones.filter((m) => m.condition.kind === 'regionCaptured' && m.condition.region === region.id),
    })),
    {
      key: 'common',
      label: '🏅 공통',
      items: content.milestones.filter((m) => m.condition.kind !== 'regionCaptured'),
    },
  ];
  const currentGroup = achievementGroups.find((g) => g.key === achieveTab()) ?? achievementGroups[0]!;
  const doneCount = (items: typeof content.milestones) => items.filter((m) => state.milestones.includes(m.id)).length;
  const totalDone = doneCount(content.milestones);

  const achievementTabs = el('div.chips-wrap', {}, ...achievementGroups.map((group) =>
    el(`button.chip${currentGroup.key === group.key ? '.active' : ''}`, {
      onclick: () => achieveTab.set(group.key),
    }, `${group.label} ${doneCount(group.items)}/${group.items.length}`)));

  const achievementRows = currentGroup.items.map((milestone) => {
    const done = state.milestones.includes(milestone.id);
    const { need, have } = milestoneProgress(milestone.condition, counts);
    const rewardBits = [
      milestone.reward.gold ? `골드 ${fmtGold(milestone.reward.gold)}` : null,
      milestone.reward.dust ? `가루 ${milestone.reward.dust}` : null,
      ...(milestone.reward.effects ?? []).map((effect) => `영구 ${describeEffect(effect)}`),
    ].filter(Boolean).join(' · ');
    // 왼쪽 = 이름 + 달성 내용(진행), 오른쪽 = 보상 (2026-08-23 위치 교환)
    return el(`div.list-row${done ? '.done' : ''}`, {},
      el('div', {},
        el('div', {}, `${done ? '🏅' : '⬜'} ${milestone.name}`),
        el('div.muted.small', {}, done
          ? describeCondition(milestone.condition)
          : `${describeCondition(milestone.condition)} (${have}/${need})`),
      ),
      rewardBits ? el('span.muted.small.milestone-reward', {}, rewardBits) : null,
    );
  });

  return el('div.screen', {},
    el('div.card.codex-summary', {},
      el('div', {}, el('strong', {}, `${captured}`), el('span.muted', {}, ` / ${content.monsterList.length} 포획`)),
      el('div.muted.small', {}, `목격 ${seen} · 도감 점수 ${score}`),
    ),
    el('div.card.stack-sm', {},
      filterChips(tribe, Object.entries(TRIBE_LABEL) as [Monster['tribe'], string][], (v) => tribeFilter.set(v)),
      filterChips(rarity, Object.entries(MONSTER_RARITY_LABEL) as [Monster['rarity'], string][], (v) => rarityFilter.set(v)),
    ),
    visibleSections.length > 0
      ? el('div.stack-sm', {}, ...visibleSections)
      : el('div.card.empty', {}, el('span.muted', {}, '조건에 맞는 몬스터가 없습니다')),
    el('h2.section-title', {}, `업적 (${totalDone}/${content.milestones.length})`),
    el('div.card.stack-sm', {},
      achievementTabs,
      ...achievementRows,
    ),
  );
}

function milestoneProgress(
  condition: (typeof content.milestones)[number]['condition'],
  counts: CapturedCounts,
): { have: number; need: number } {
  switch (condition.kind) {
    case 'regionCaptured':
      return { have: Math.min(counts.byRegion.get(condition.region) ?? 0, condition.count), need: condition.count };
    case 'tribeCaptured':
      return { have: Math.min(counts.byTribe.get(condition.tribe) ?? 0, condition.count), need: condition.count };
    case 'totalCaptured':
      return { have: Math.min(counts.total, condition.count), need: condition.count };
  }
}

function describeCondition(condition: (typeof content.milestones)[number]['condition']): string {
  switch (condition.kind) {
    case 'regionCaptured': {
      const name = content.regions.get(condition.region)?.name ?? condition.region;
      return `${name} ${condition.count}종 포획`;
    }
    case 'tribeCaptured':
      return `${{ beast: '야수', spirit: '정령', undead: '언데드', aquatic: '수생', flying: '비행', construct: '기계' }[condition.tribe]} ${condition.count}종 포획`;
    case 'totalCaptured':
      return `총 ${condition.count}종 포획`;
  }
}

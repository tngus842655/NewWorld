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

  const sections = content.regionList.map((region) => {
    const allNatives = content.monsterList.filter((m) => m.habitat === region.id);
    const regionCaptured = allNatives.filter((m) => state.codex[m.id]?.captured).length;
    const natives = allNatives.filter(
      (m) => (tribe === null || m.tribe === tribe) && (rarity === null || m.rarity === rarity),
    );
    if (natives.length === 0) return null;
    const cells = natives.map((monster) => {
      const entry = state.codex[monster.id];
      const openSpecies = () => overlay.set({ kind: 'species', monsterId: monster.id });
      if (entry?.captured) {
        const icon = monsterIcon(monster.id);
        const count = state.roster.find((m) => m.monsterId === monster.id)?.count ?? 0;
        if (count > 1) icon.append(el('span.micon-count', { title: `보유 카드 ${count}장` }, `×${count}`));
        return el(`div.codex-cell${entry.awakened ? '.awakened' : ''}`, {
          title: `${monster.name} · ${MONSTER_RARITY_LABEL[monster.rarity]}`,
          onclick: openSpecies,
        },
          icon,
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
    return el('section', {},
      el('h3.codex-region', {}, `${region.name} (${regionCaptured}/${allNatives.length})`),
      el('div.codex-grid', {}, ...cells),
    );
  });
  const visibleSections = sections.filter((s): s is HTMLElement => s !== null);

  const counts = capturedCounts(content, state);
  const milestones = content.milestones.map((milestone) => {
    const done = state.milestones.includes(milestone.id);
    const { need, have } = milestoneProgress(milestone.condition, counts);
    const rewardBits = [
      milestone.reward.gold ? `골드 ${fmtGold(milestone.reward.gold)}` : null,
      milestone.reward.dust ? `가루 ${milestone.reward.dust}` : null,
      ...(milestone.reward.effects ?? []).map((effect) => `영구 ${describeEffect(effect)}`),
    ].filter(Boolean).join(' · ');
    return el(`div.list-row${done ? '.done' : ''}`, {},
      el('div', {},
        el('div', {}, `${done ? '🏅' : '⬜'} ${milestone.name}`),
        rewardBits ? el('div.muted.small.milestone-reward', {}, `보상: ${rewardBits}`) : null,
      ),
      el('span.muted.small', {}, done
        ? describeCondition(milestone.condition)
        : `${describeCondition(milestone.condition)} (${have}/${need})`),
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
      ? el('div', {}, ...visibleSections)
      : el('div.card.empty', {}, el('span.muted', {}, '조건에 맞는 몬스터가 없습니다')),
    el('h2.section-title', {}, '마일스톤'),
    el('div.card', {}, ...milestones),
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

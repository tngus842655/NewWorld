/**
 * 도감 — 지역별 그리드 (미지 ? / 목격 실루엣 / 포획 컬러 / 각성 금테) + 마일스톤.
 */
import { content } from '../../content';
import { save } from '../../state/store';
import { monsterIcon } from '../components';
import { MONSTER_RARITY_LABEL, el } from '../kit';

export function renderCodex(): HTMLElement {
  const state = save();
  const captured = Object.values(state.codex).filter((c) => c.captured).length;
  const seen = Object.values(state.codex).filter((c) => c.seen && !c.captured).length;
  const score = Object.entries(state.codex).reduce((sum, [, entry]) => {
    if (entry.awakened) return sum + 5;
    if (entry.captured) return sum + 3;
    if (entry.seen) return sum + 1;
    return sum;
  }, 0);

  const sections = content.regionList.map((region) => {
    const natives = content.monsterList.filter((m) => m.habitat === region.id);
    const regionCaptured = natives.filter((m) => state.codex[m.id]?.captured).length;
    const cells = natives.map((monster) => {
      const entry = state.codex[monster.id];
      if (entry?.captured) {
        return el(`div.codex-cell${entry.awakened ? '.awakened' : ''}`, { title: `${monster.name} · ${MONSTER_RARITY_LABEL[monster.rarity]}` },
          monsterIcon(monster.id),
          el('div.codex-name', {}, monster.name),
        );
      }
      if (entry?.seen) {
        return el('div.codex-cell.seen', { title: '목격 — 아직 포획하지 못했다' },
          monsterIcon(monster.id, { silhouette: true }),
          el('div.codex-name.muted', {}, monster.name),
        );
      }
      return el('div.codex-cell.unknown', {}, el('div.codex-q', {}, '?'), el('div.codex-name.muted', {}, '???'));
    });
    return el('section', {},
      el('h3.codex-region', {}, `${region.name} (${regionCaptured}/${natives.length})`),
      el('div.codex-grid', {}, ...cells),
    );
  });

  const milestones = content.milestones.map((milestone) => {
    const done = state.milestones.includes(milestone.id);
    return el(`div.list-row${done ? '.done' : ''}`, {},
      el('span', {}, `${done ? '🏅' : '⬜'} ${milestone.name}`),
      el('span.muted.small', {}, describeCondition(milestone.condition)),
    );
  });

  return el('div.screen', {},
    el('div.card.codex-summary', {},
      el('div', {}, el('strong', {}, `${captured}`), el('span.muted', {}, ` / 52 포획`)),
      el('div.muted.small', {}, `목격 ${seen} · 도감 점수 ${score}`),
    ),
    ...sections,
    el('h2.section-title', {}, '마일스톤'),
    el('div.card', {}, ...milestones),
  );
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

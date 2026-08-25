/**
 * 도감 — 몬스터/유물/업적 3탭 (모바일 스크롤 최소화, 2026-08-23).
 * 몬스터: 지역별 그리드 (미지 ? / 목격 실루엣 / 포획 컬러 / 각성 금테) + 종족·등급 필터.
 * 유물: 등급별 그리드 — 획득 이력(v7) 기반, 분해로 종이 사라져도 도감에는 남는다.
 * 업적: 지역 4탭 + 공통.
 */
import { content } from '../../content';
import { ARTIFACT_RARITIES, type ArtifactRarity, type Monster } from '../../content/schema';
import { capturedCounts, type CapturedCounts } from '../../core/progression';
import { signal } from '../../state/signal';
import { save } from '../../state/store';
import { artifactIcon, artifactIconBadged, monsterIcon } from '../components';
import { describeEffect } from '../effectText';
import { ARTIFACT_RARITY_LABEL, MONSTER_RARITY_LABEL, RARITY_ASC, TRIBE_LABEL, el, fmtGold } from '../kit';
import { overlay } from '../router';

// 탭을 오가도 유지되는 화면 로컬 상태 (GDD §11)
const codexTab = signal<'monster' | 'artifact' | 'achieve'>('monster');
const tribeFilter = signal<Monster['tribe'] | null>(null);
const rarityFilter = signal<Monster['rarity'] | null>(null);
// 접힘 상태 (기본 접힘 — 캠프와 동일 패턴) + 업적 지역 탭 (2026-08-23)
const openCodexRegions = signal<Record<string, boolean>>({});
const openArtifactRarities = signal<Record<string, boolean>>({});
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
  const tab = codexTab();

  const captured = Object.values(state.codex).filter((c) => c.captured).length;
  const obtainedArtifacts = Object.values(state.artifactCodex).filter((e) => e.obtained).length;
  const totalDone = content.milestones.filter((m) => state.milestones.includes(m.id)).length;

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'monster', label: `몬스터 (${captured}/${content.monsterList.length})` },
    { key: 'artifact', label: `유물 (${obtainedArtifacts}/${content.artifacts.size})` },
    { key: 'achieve', label: `업적 (${totalDone}/${content.milestones.length})` },
  ];
  const tabBar = el('div.big-tabs', {}, ...tabs.map((t) =>
    el(`button.big-tab${tab === t.key ? '.active' : ''}`, { onclick: () => codexTab.set(t.key) }, t.label)));

  const body = tab === 'monster' ? monsterTab(state) : tab === 'artifact' ? artifactTab(state) : achieveTab_(state);
  return el('div.screen', {}, tabBar, ...body);
}

// ── 몬스터 탭 ────────────────────────────────────────────────────────────────
type Save = ReturnType<typeof save>;

function monsterTab(state: Save): HTMLElement[] {
  const tribe = tribeFilter();
  const rarity = rarityFilter();
  const seen = Object.values(state.codex).filter((c) => c.seen && !c.captured).length;
  const captured = Object.values(state.codex).filter((c) => c.captured).length;
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

    // 접힘: 아이콘만 가로 슬라이드 — 미지(?) 종은 제외 (2026-08-23 사용자)
    const discovered = natives.filter((monster) => state.codex[monster.id]?.seen || state.codex[monster.id]?.captured);
    const iconRow = discovered.length > 0
      ? el('div.roster-row', {}, ...discovered.map((monster) => {
          const entry = state.codex[monster.id]!;
          const openSpecies = () => overlay.set({ kind: 'species', monsterId: monster.id });
          return entry.captured
            ? el('button.roster-icon', { title: monster.name, onclick: openSpecies }, capturedIcon(monster))
            : el('button.roster-icon', { title: '목격', onclick: openSpecies }, monsterIcon(monster.id, { silhouette: true }));
        }))
      : el('div.muted.small', {}, '아직 발견한 몬스터가 없습니다');

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

  return [
    el('div.card.codex-summary', {},
      el('div', {}, el('strong', {}, `${captured}`), el('span.muted', {}, ` / ${content.monsterList.length} 포획`)),
      el('div.muted.small', {}, `목격 ${seen} · 도감 점수 ${score}`),
    ),
    el('div.card.stack-sm', {},
      filterChips(tribe, Object.entries(TRIBE_LABEL) as [Monster['tribe'], string][], (v) => tribeFilter.set(v)),
      filterChips(rarity, RARITY_ASC.map((r) => [r, MONSTER_RARITY_LABEL[r]] as [Monster['rarity'], string]), (v) => rarityFilter.set(v)),
    ),
    visibleSections.length > 0
      ? el('div.stack-sm', {}, ...visibleSections)
      : el('div.card.empty', {}, el('span.muted', {}, '조건에 맞는 몬스터가 없습니다')),
  ];
}

// ── 유물 탭 ──────────────────────────────────────────────────────────────────
function artifactTab(state: Save): HTMLElement[] {
  const obtained = Object.values(state.artifactCodex).filter((e) => e.obtained).length;

  const sections = ARTIFACT_RARITIES.map((rarity: ArtifactRarity) => {
    const defs = content.artifactsByRarity.get(rarity) ?? [];
    if (defs.length === 0) return null;
    const obtainedDefs = defs.filter((def) => state.artifactCodex[def.id]?.obtained);
    const open = openArtifactRarities()[rarity] === true;

    const cells = defs.map((def) => {
      const owned = state.artifacts.find((a) => a.itemId === def.id);
      if (owned) {
        return el('div.codex-cell', {
          title: `${def.name} · ${ARTIFACT_RARITY_LABEL[rarity]}`,
          onclick: () => overlay.set({ kind: 'artifact', itemId: def.id }),
        },
          artifactIconBadged(owned),
          el('div.codex-name', {}, def.name),
        );
      }
      if (state.artifactCodex[def.id]?.obtained) {
        // 획득 이력은 있으나 현재 미보유 (마지막 개까지 분해)
        return el('div.codex-cell.lost', { title: `${def.name} — 획득 이력 있음 · 현재 미보유` },
          artifactIcon(def.id),
          el('div.codex-name.muted', {}, def.name),
        );
      }
      return el('div.codex-cell.unknown', {}, el('div.codex-q', {}, '?'), el('div.codex-name.muted', {}, '???'));
    });

    // 접힘: 획득한 유물 아이콘만 가로 슬라이드 (몬스터 탭과 동일 패턴)
    const iconRow = obtainedDefs.length > 0
      ? el('div.roster-row', {}, ...obtainedDefs.map((def) => {
          const owned = state.artifacts.find((a) => a.itemId === def.id);
          return owned
            ? el('button.roster-icon', {
                title: def.name,
                onclick: () => overlay.set({ kind: 'artifact', itemId: def.id }),
              }, artifactIconBadged(owned))
            : el('button.roster-icon.lost', { title: `${def.name} — 현재 미보유` }, artifactIcon(def.id));
        }))
      : el('div.muted.small', {}, '아직 획득한 유물이 없습니다');

    return el('div.card.stack-sm', {},
      el('button.roster-head', {
        onclick: () => openArtifactRarities.set({ ...openArtifactRarities(), [rarity]: !open }),
      },
        el('span', {}, `${ARTIFACT_RARITY_LABEL[rarity]} (${obtainedDefs.length}/${defs.length})`),
        el('span.muted.small', {}, open ? '접기 ∧' : '펼치기 ∨'),
      ),
      open ? el('div.codex-grid', {}, ...cells) : iconRow,
    );
  });

  return [
    el('div.card.codex-summary', {},
      el('div', {}, el('strong', {}, `${obtained}`), el('span.muted', {}, ` / ${content.artifacts.size} 수집`)),
      el('div.muted.small', {}, `보유 ${state.artifacts.length}종`),
    ),
    el('div.stack-sm', {}, ...sections.filter((s): s is HTMLElement => s !== null)),
  ];
}

// ── 업적 탭 ──────────────────────────────────────────────────────────────────
function achieveTab_(state: Save): HTMLElement[] {
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
    ].filter((bit): bit is string => bit !== null);
    // 왼쪽 = 이름 + 달성 내용(진행), 오른쪽 = 보상 항목별 한 줄씩 (2026-08-23)
    return el(`div.list-row${done ? '.done' : ''}`, {},
      el('div', {},
        el('div', {}, `${done ? '🏅' : '⬜'} ${milestone.name}`),
        el('div.muted.small', {}, done
          ? describeCondition(milestone.condition)
          : `${describeCondition(milestone.condition)} (${have}/${need})`),
      ),
      rewardBits.length > 0
        ? el('div.milestone-reward', {}, ...rewardBits.map((bit) => el('div.muted.small', {}, bit)))
        : null,
    );
  });

  return [
    el('div.card.stack-sm', {},
      achievementTabs,
      ...achievementRows,
    ),
  ];
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

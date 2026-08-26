/**
 * 도감 — 몬스터/유물/업적 3탭 (모바일 스크롤 최소화, 2026-08-23).
 * 몬스터: 권역 칩 → 소지역 3카드 그리드 (미지 ? / 목격 실루엣 / 포획 컬러 / 각성 금테) + 종족·등급 필터.
 * 유물: 등급별 그리드 — 획득 이력(v7) 기반, 종이 사라진 과거 세이브(분해 제거 전)도 도감에는 남는다.
 * 업적: 권역 4칩 + 공통 (12지역 개편으로 지역 13칩이 네 줄을 덮던 것을 압축, 2026-08-27).
 */
import { content } from '../../content';
import { ARTIFACT_RARITIES, type ArtifactRarity, type Monster } from '../../content/schema';
import { capturedCounts, deepestUnlockedRegion, type CapturedCounts } from '../../core/progression';
import { signal } from '../../state/signal';
import { save } from '../../state/store';
import { artifactIcon, artifactIconBadged, monsterIcon } from '../components';
import { describeEffect } from '../effectText';
import { ARTIFACT_RARITY_LABEL, MONSTER_RARITY_LABEL, RARITY_ASC, RARITY_ORDER, TRIBE_LABEL, el, fmtGold } from '../kit';
import { filterChips } from '../panels';
import { regionTiers, tierShortName } from '../regionTiers';
import { overlay } from '../router';

// 탭을 오가도 유지되는 화면 로컬 상태 (GDD §11)
const codexTab = signal<'monster' | 'artifact' | 'achieve'>('monster');
const tribeFilter = signal<Monster['tribe'] | null>(null);
const rarityFilter = signal<Monster['rarity'] | null>(null);
// 접힘 상태 (기본 접힘 — 캠프와 동일 패턴) + 권역 선택 (2026-08-27 원정과 같은 권역 축)
const openCodexRegions = signal<Record<string, boolean>>({});
const openArtifactRarities = signal<Record<string, boolean>>({});
// 접속 기본값은 가장 깊은 해금 권역 — 원정 화면과 같은 이유 (null = 전체, 등급 필터로 전 지역 훑을 때)
const codexTierView = signal<number | null>(deepestUnlockedRegion(content, save()).tier);
const achieveTab = signal<string>(String(deepestUnlockedRegion(content, save()).tier)); // 권역 번호 문자열 또는 'common'

// 필터 칩은 ui/panels.ts로 이전 (2026-08-25) — 편성 시트·캠프와 같은 구현을 쓴다.

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

  // 권역 칩이 소지역 3카드만 남긴다 — 12카드 나열은 화면 두 개 분량 (2026-08-27). '전체'는 등급 필터용 훑기.
  const view = codexTierView();
  const viewRegions = view === null
    ? content.regionList
    : (regionTiers.find((t) => t.tier === view) ?? regionTiers[0]!).regions;
  const sections = viewRegions.map((region) => {
    const allNatives = content.monsterList.filter((m) => m.habitat === region.id);
    const regionCaptured = allNatives.filter((m) => state.codex[m.id]?.captured).length;
    const natives = allNatives
      .filter((m) => (tribe === null || m.tribe === tribe) && (rarity === null || m.rarity === rarity))
      // 도감은 '읽는 화면' — 등급 오름차순(일반→전설). 지금까지 정렬이 아예 없어
      // monsters.json 파일 순서 그대로였다 (2026-08-25)
      .sort((a, b) => RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] || a.name.localeCompare(b.name, 'ko'));
    if (natives.length === 0) return null;
    const open = openCodexRegions()[region.id] === true;

    const cells = () => natives.flatMap((monster, i) => {
      // 등급이 바뀌는 자리마다 구간 헤더 — 오름차순이 눈에 보이게 (grid-column: 1/-1로 한 줄 차지)
      const head = i === 0 || natives[i - 1]!.rarity !== monster.rarity
        ? [el('div.info-group-head', {}, el(`span.tag.rar-${monster.rarity}`, {}, MONSTER_RARITY_LABEL[monster.rarity]))]
        : [];
      return [...head, cell(monster)];
    });

    const cell = (monster: Monster): HTMLElement => {
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
    };

    // 접힘: 아이콘만 가로 슬라이드 — 미지(?) 종은 제외 (2026-08-23 사용자)
    const iconRow = () => {
      const discovered = natives.filter((monster) => state.codex[monster.id]?.seen || state.codex[monster.id]?.captured);
      return discovered.length > 0
        ? el('div.roster-row', {}, ...discovered.map((monster) => {
            const entry = state.codex[monster.id]!;
            const openSpecies = () => overlay.set({ kind: 'species', monsterId: monster.id });
            return entry.captured
              ? el('button.roster-icon', { title: monster.name, onclick: openSpecies }, capturedIcon(monster))
              : el('button.roster-icon', { title: '목격', onclick: openSpecies }, monsterIcon(monster.id, { silhouette: true }));
          }))
        : el('div.muted.small', {}, '아직 발견한 몬스터가 없습니다');
    };

    return el('div.card.stack-sm', {},
      el('button.roster-head', {
        onclick: () => openCodexRegions.set({ ...openCodexRegions(), [region.id]: !open }),
      },
        el('span', {}, `${region.icon} ${region.name} (${regionCaptured}/${allNatives.length})`),
        el('span.muted.small', {}, open ? '접기 ∧' : '펼치기 ∨'),
      ),
      // 지연 생성 — 지금까지는 접힘 여부와 무관하게 셀 216개와 아이콘 줄을 둘 다 만들고 하나를 버렸다
      open ? el('div.codex-grid', {}, ...cells()) : iconRow(),
    );
  });
  const visibleSections = sections.filter((s): s is HTMLElement => s !== null);

  // 필터가 걸리면 '보이는 수'를 병기 — 헤더 진행도(필터 전)와 그리드(필터 후)가 어긋나 보이던 지점.
  // 권역 칩 도입 후에는 보이는 권역 안에서 센다 (전체 모수로 세면 또 어긋난다)
  const shownCount = content.monsterList.filter(
    (m) => viewRegions.some((r) => r.id === m.habitat)
      && (tribe === null || m.tribe === tribe) && (rarity === null || m.rarity === rarity),
  ).length;
  const filtered = tribe !== null || rarity !== null;

  // 권역 칩 — 진행(포획/전체)을 함께. 집계는 섹션 헤더와 같은 기준(habitat, 초월 포함)이라 합이 어긋나지 않는다
  const tierChips = filterChips(
    regionTiers.map(({ tier, regions }) => {
      const natives = content.monsterList.filter((m) => regions.some((r) => r.id === m.habitat));
      const done = natives.filter((m) => state.codex[m.id]?.captured).length;
      return { key: String(tier), label: `${regions[0]!.icon} ${tierShortName(regions)} ${done}/${natives.length}` };
    }),
    { active: view === null ? null : String(view), onPick: (v) => codexTierView.set(v === null ? null : Number(v)) },
  );

  return [
    // 포획 수는 탭 라벨('몬스터 n/216')이 이미 말한다 — 중복 요약 카드를 지우고
    // 보조 수치만 필터 카드에 한 줄로 (탭 라벨과 겹치는 타이틀 금지 규칙, 2026-08-25)
    el('div.card.stack-sm', {},
      tierChips,
      el('div.muted.small', {},
        `목격 ${seen} · 도감 점수 ${score}${filtered ? ` · 필터 ${shownCount}종 표시` : ''}`),
      filterChips(
        (Object.entries(TRIBE_LABEL) as [Monster['tribe'], string][]).map(([key, label]) => ({ key, label })),
        { active: tribe, onPick: (v) => tribeFilter.set(v) },
      ),
      // 등급 칩은 등급색으로 — 도감은 '읽는 화면'이라 오름차순 (2026-08-25 사용자 확정)
      filterChips(
        RARITY_ASC.map((r) => ({ key: r, label: MONSTER_RARITY_LABEL[r], cls: `rar-${r}` })),
        { active: rarity, onPick: (v) => rarityFilter.set(v) },
      ),
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
        // 획득 이력은 있으나 현재 미보유 (분해 제거 전 세이브 호환)
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
        // 등급은 색으로 식별 — 평문 라벨이던 유일한 지점 (2026-08-25)
        el('span.roster-head-title', {},
          el(`span.tag.rar-${rarity}`, {}, ARTIFACT_RARITY_LABEL[rarity]),
          el('span.muted.small', {}, ` ${obtainedDefs.length}/${defs.length}`),
        ),
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
  // 업적(구 마일스톤) — 권역 4칩 + 공통 (2026-08-27: 12지역 개편으로 지역 13칩이 네 줄을 덮었다).
  // 권역 안에서는 소지역별 헤더로 사다리를 구분한다.
  const counts = capturedCounts(content, state);
  const doneCount = (items: typeof content.milestones) => items.filter((m) => state.milestones.includes(m.id)).length;
  const regionItems = (regionId: string) =>
    content.milestones.filter((m) => m.condition.kind === 'regionCaptured' && m.condition.region === regionId);
  const commonItems = content.milestones.filter((m) => m.condition.kind !== 'regionCaptured');

  const current = achieveTab();
  const achievementTabs = filterChips(
    [
      ...regionTiers.map(({ tier, regions }) => {
        const items = regions.flatMap((r) => regionItems(r.id));
        return { key: String(tier), label: `${regions[0]!.icon} ${tierShortName(regions)} ${doneCount(items)}/${items.length}` };
      }),
      { key: 'common', label: `🏅 공통 ${doneCount(commonItems)}/${commonItems.length}` },
    ],
    { active: current, onPick: (v) => { if (v !== null) achieveTab.set(v); }, allLabel: null },
  );

  const row = (milestone: (typeof content.milestones)[number]): HTMLElement => {
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
  };

  const body = current === 'common'
    ? commonItems.map(row)
    : ((regionTiers.find((t) => t.tier === Number(current)) ?? regionTiers[0]!).regions).flatMap((region) => {
        const items = regionItems(region.id);
        if (items.length === 0) return [];
        return [
          el('div.info-group-head', {},
            el('span', {}, `${region.icon} ${region.name}`),
            el('span.muted.small', {}, `${doneCount(items)}/${items.length}`),
          ),
          ...items.map(row),
        ];
      });

  return [
    el('div.card.stack-sm', {},
      achievementTabs,
      ...body,
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
    case 'rarityCaptured':
      return { have: Math.min(counts.byRarity.get(condition.rarity) ?? 0, condition.count), need: condition.count };
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
      return `서식종 ${condition.count}종 포획`;
    case 'rarityCaptured':
      return `${MONSTER_RARITY_LABEL[condition.rarity]} ${condition.count}종 포획`;
  }
}

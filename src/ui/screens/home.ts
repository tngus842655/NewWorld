/**
 * 홈 — 원정 현황(지도 + 한 줄 요약), 다음 목표, 최근 일지.
 * 상세 액션(가속·갈림길·회군·정산)은 지도 시트의 행이 담당한다 (2026-08-27 사용자 — 홈은 간략하게).
 */
import { content } from '../../content';
import { isExpeditionOut } from '../../core/expedition';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, nextPartySlotUnlock } from '../../core/progression';
import * as clock from '../../state/clock';
import { signal } from '../../state/signal';
import { nowTick, save } from '../../state/store';
import { expeditionLinesCard, mapEntryButton } from '../expeditionMap';
import { TIER_LABEL, TIER_NAME, el, fmtAgo, fmtGold, scopedEffect } from '../kit';
import { overlay, tab } from '../router';
import { playSfx } from '../sfx';

/** 최근 일지 접힘 상태 — 탭 이동·재렌더에도 유지 (접힘 기본 5건, 펼치면 아카이브 전체) */
const JOURNAL_COLLAPSED_COUNT = 5;
const journalExpanded = signal(false);

/** 다음 목표 카드 — 지역 해금 → 파티 슬롯 → 도감 완성 → 초월 순으로 지금 좇을 목표 하나만 (GDD 필러 3) */
function nextGoalCard(): HTMLElement | null {
  const state = save();
  const counts = capturedCounts(content, state);

  const lockedRegion = content.regionList.find((region) => !isRegionUnlocked(content, state, region.id));
  if (lockedRegion) {
    const check = canUnlockRegion(content, state, lockedRegion.id);
    const parts: HTMLElement[] = [];
    for (const [requiredRegion, need] of Object.entries(lockedRegion.unlock.codexCaptured ?? {})) {
      const have = Math.min(counts.byRegion.get(requiredRegion) ?? 0, need);
      const name = content.regions.get(requiredRegion)?.name ?? requiredRegion;
      parts.push(el(`div.goal-item${have >= need ? '.goal-done' : ''}`, {},
        `${have >= need ? '✅' : '▫️'} ${name} 도감 ${have}/${need}`));
    }
    for (const [materialId, need] of Object.entries(lockedRegion.unlock.materials ?? {})) {
      const have = Math.min(state.wallet.materials[materialId] ?? 0, need);
      const name = content.materials.get(materialId)?.name ?? materialId;
      parts.push(el(`div.goal-item${have >= need ? '.goal-done' : ''}`, {},
        `${have >= need ? '✅' : '▫️'} ${name} ${have}/${need}`));
    }
    return el('div.card.goal-card', { onclick: () => tab.set('expedition') },
      el('div.goal-head', {},
        el('span', {}, `🎯 다음 목표 [${lockedRegion.name} 해금]`),
        check.ok ? el('span.tag.goal-ready', {}, '조건 달성!') : null,
      ),
      el('div.goal-items', {}, ...parts),
      el('div.muted.small', {}, check.ok ? '원정 화면에서 해금할 수 있습니다' : '깊은 지역일수록 보상이 커집니다'),
    );
  }

  // 동시 파견 군(1~4군)은 지역 해금에 딸려 오므로 독립된 목표가 될 수 없다 (GDD §5.1) —
  // 지역이 다 열린 뒤 남는 유일한 해금 축은 파티 슬롯이다 (필러 3 "도감 진척 → 슬롯 해금", §9.1 골드 싱크)
  const slotUnlock = nextPartySlotUnlock(content, state);
  if (slotUnlock) {
    const codexHave = Math.min(counts.total, slotUnlock.totalCaptured);
    const goldHave = Math.min(state.wallet.gold, slotUnlock.gold);
    const codexOk = codexHave >= slotUnlock.totalCaptured;
    const goldOk = goldHave >= slotUnlock.gold;
    return el('div.card.goal-card', { onclick: () => tab.set('camp') },
      el('div.goal-head', {},
        el('span', {}, `🎯 다음 목표 [파티 슬롯 ${state.profile.partySlots} → ${slotUnlock.slots}칸]`),
        codexOk && goldOk ? el('span.tag.goal-ready', {}, '조건 달성!') : null,
      ),
      el('div.goal-items', {},
        el(`div.goal-item${codexOk ? '.goal-done' : ''}`, {},
          `${codexOk ? '✅' : '▫️'} 도감 ${codexHave}/${slotUnlock.totalCaptured}종 포획`),
        el(`div.goal-item${goldOk ? '.goal-done' : ''}`, {},
          `${goldOk ? '✅' : '▫️'} 골드 ${fmtGold(goldHave)}/${fmtGold(slotUnlock.gold)}`),
      ),
      el('div.muted.small', {},
        codexOk && goldOk ? '캠프에서 확장할 수 있습니다' : '슬롯이 늘면 3+2 이중 시너지 편성이 열립니다'),
    );
  }

  // 모수는 monsterList(219)가 아니라 nativeList(216)다 — 초월은 잡을 수 없어 목표가 안 닫힌다 (2026-08-25)
  const totalSpecies = content.nativeList.length;
  if (counts.total < totalSpecies) {
    return el('div.card.goal-card', { onclick: () => tab.set('codex') },
      el('div.goal-head', {}, el('span', {}, '🎯 다음 목표 [신대륙 도감의 완성]')),
      el('div.goal-items', {}, el('div.goal-item', {}, `▫️ 도감 ${counts.total}/${totalSpecies}종 포획 [전설은 ${TIER_LABEL.deep}에서만]`)),
    );
  }

  // 서식종을 다 채운 뒤의 목표는 초월 축 — 합성으로만 닿는 3종 (2026-08-25)
  const transcendTotal = content.transcendentList.length;
  const transcendHave = counts.byRarity.get('transcendent') ?? 0;
  if (transcendHave < transcendTotal) {
    return el('div.card.goal-card', { onclick: () => tab.set('codex') },
      el('div.goal-head', {}, el('span', {}, '🎯 다음 목표 [초월]')),
      el('div.goal-items', {}, el('div.goal-item', {},
        `▫️ 초월 ${transcendHave}/${transcendTotal}종 수집 [전설 카드 합성으로만]`)),
    );
  }
  return null;
}

export function renderHome(): HTMLElement {
  const state = save();
  // 비추적 시계 — 복귀 완료된 회군 기록은 표시에서 제외 (세이브 정리는 다음 파견 때 코어가 한다)
  const running = state.expeditions.filter((e) => isExpeditionOut(e, clock.now()));

  // 투어(GDD §11.2)가 첫 안내를 담당한다 — 배너는 투어를 건너뛴 유저의 안전망으로만
  const tutorialBanner = !state.profile.tutorialDone && state.profile.flags['tourDone'] === true
    ? running.length > 0
      ? el('div.card.banner', {},
          el('div', {}, '🧭 첫 원정대가 출발했습니다!'),
          el('div.muted.small', {}, '돌아오면 원정 일지가 기다립니다.'),
        )
      : el('div.card.banner', {},
          el('div', {}, '🧭 신대륙에 도착했습니다! 첫 정찰을 보내보세요.'),
          el('div.muted.small', {}, '첫 원정은 30초 만에 돌아옵니다.'),
          el('button.btn.btn-primary', { onclick: () => tab.set('expedition') }, '원정 보내러 가기'),
        )
    : null;

  const now = clock.now();
  const expanded = journalExpanded();
  const archive = state.journalArchive; // 정산 시 최근 20건으로 유지된다
  const recent = (expanded ? archive : archive.slice(0, JOURNAL_COLLAPSED_COUNT)).map((summary) => {
    const region = content.regions.get(summary.regionId);
    const tierName = TIER_NAME[summary.tier];
    return el('div.list-row.journal-row', {},
      el('div.journal-name', {},
        `${summary.wiped ? '💀' : '🏕️'} ${region?.name ?? summary.regionId} · ${tierName}`,
        el('span.muted.small.journal-ago', {}, fmtAgo(now - summary.endedAt)),
      ),
      summary.journal // 구 세이브 항목에는 풀 일지가 없다 — 상세 버튼 숨김
        ? el('button.btn.btn-ghost.journal-detail-btn', {
            onclick: () => overlay.set({ kind: 'journalDetail', expeditionId: summary.expeditionId }),
          }, '상세')
        : null,
    );
  });
  const journalToggle = archive.length > JOURNAL_COLLAPSED_COUNT
    ? el('button.btn.btn-ghost.journal-toggle', { onclick: () => journalExpanded.set(!expanded) },
        expanded ? '접기 ∧' : '펼치기 ∨')
    : null;

  return el('div.screen', {},
    tutorialBanner,
    // 타이틀 우측 지도 아이콘 → 전용 시트. 카드에는 한 줄 요약만 (2026-08-27 사용자)
    el('div.section-head', {},
      (() => {
        // 회군 복귀 완료는 세이브 변화 없이 시간만으로 일어난다 — 카운트도 초 단위로 따라가게 (2026-08-29)
        const title = el('h2.section-title', {});
        scopedEffect(() => {
          const count = state.expeditions.filter((e) => isExpeditionOut(e, nowTick())).length;
          title.textContent = count > 0 ? `원정 현황 (${count})` : '원정 현황';
        });
        return title;
      })(),
      mapEntryButton(),
    ),
    expeditionLinesCard(),
    nextGoalCard(),
    (() => {
      // 반복 과업 진입 (GDD §9.3) — 랭킹은 설정 탭으로 이동 (2026-08-29 사용자, 일반 공개 여부 추후 결정)
      const taskTimes = content.tasks.reduce((sum, task) => sum + (state.tasks[task.id] ?? 0), 0);
      return el('div.card.list-row', {},
        el('span', {}, `📋 반복 과업 [달성 ${taskTimes}회]`),
        // journal-detail-btn — 최근 일지 '상세' 버튼과 같은 크기 (2026-08-29 사용자)
        el('button.btn.btn-ghost.journal-detail-btn', { onclick: () => overlay.set({ kind: 'tasks' }) }, '보기'),
      );
    })(),
    el('h2.section-title', {}, archive.length > 0 ? `최근 일지 (${archive.length})` : '최근 일지'),
    recent.length > 0
      ? el('div.card', {}, ...recent, journalToggle)
      : el('div.card.empty', {}, el('span.muted', {}, '아직 기록이 없습니다')),
  );
}

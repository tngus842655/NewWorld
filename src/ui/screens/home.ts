/**
 * 홈 — 원정 현황 카드(가속·갈림길·정산 진입), 다음 목표, 최근 일지.
 * 카드 구조는 고정하고 시간 관련 표시만 scopedEffect로 갱신한다 (탭 안정성).
 */
import { content } from '../../content';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, teamCount } from '../../core/progression';
import * as clock from '../../state/clock';
import { signal } from '../../state/signal';
import { claim, nowTick, save } from '../../state/store';
import { monsterIcon } from '../components';
import { TIER_LABEL, el, fmtAgo, fmtClock, fmtRemain, scopedEffect } from '../kit';
import { overlay, tab } from '../router';
import { playSfx } from '../sfx';

/** 최근 일지 접힘 상태 — 탭 이동·재렌더에도 유지 (접힘 기본 5건, 펼치면 아카이브 전체) */
const JOURNAL_COLLAPSED_COUNT = 5;
const journalExpanded = signal(false);

function expeditionCard(expeditionId: string): HTMLElement {
  const state = save();
  const expedition = state.expeditions.find((e) => e.id === expeditionId && !e.claimed)!;
  const region = content.regions.get(expedition.regionId)!;
  const total = Math.max(1, expedition.endsAt - expedition.startedAt);
  const pendingChoices = expedition.choices.filter((c) => c === null).length;

  const fill = el('div.progress-fill');
  const remain = el('span.muted');
  const accelBtn = el('button.btn.btn-ghost.exp-accel', {
    onclick: () => overlay.set({ kind: 'accelerate', expeditionId: expedition.id }),
  }, '⏳ 가속');
  const crossroadBtn =
    expedition.choices.length > 0
      ? el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'crossroads', expeditionId: expedition.id }) },
          pendingChoices > 0 ? `🔀 갈림길 ${pendingChoices}` : '🔀 선택 완료')
      : null;
  const claimBtn = el('button.btn.btn-primary.hidden', {
    onclick: () => {
      // 미선택 갈림길이 있으면 정산 전에 일괄 선택 시트부터 (TECH §4)
      const current = save().expeditions.find((e) => e.id === expedition.id && !e.claimed);
      if (!current) return;
      if (current.choices.some((choice) => choice === null)) {
        overlay.set({ kind: 'crossroads', expeditionId: expedition.id });
        return;
      }
      const result = claim(expedition.id);
      if (result) overlay.set({ kind: 'journal', ...result });
    },
  }, '📜 원정 일지 열기');

  // 시간 흐름에 따른 갱신 — 구조는 그대로, 텍스트·클래스만 바뀐다
  scopedEffect(() => {
    const now = nowTick();
    const progress = Math.min(1, (now - expedition.startedAt) / total);
    fill.style.width = `${Math.round(progress * 100)}%`;
    const done = now >= expedition.endsAt;
    remain.textContent = done
      ? '원정대가 돌아왔습니다!'
      : `귀환까지 ${fmtRemain(expedition.endsAt - now)} · ${fmtClock(expedition.endsAt)} 귀환`;
    claimBtn.classList.toggle('hidden', !done);
    crossroadBtn?.classList.toggle('hidden', done);
    accelBtn.classList.toggle('hidden', done);
  });

  const teamName = expedition.teamId ? state.teams.find((t) => t.id === expedition.teamId)?.name : null;
  return el('div.card.exp-card', {},
    el('div.exp-head', {},
      el('div.exp-title', {}, `${region.icon} ${region.name}`),
      el('div.row-gap', {},
        teamName ? el('span.tag', {}, teamName) : null,
        el('span.tag', {}, TIER_LABEL[expedition.tier]),
      ),
    ),
    el('div.exp-party', {}, ...expedition.partyIds.map((monsterId) => monsterIcon(monsterId))),
    el('div.progress', {}, fill),
    el('div.exp-foot', {}, remain, el('div.row-gap', {}, accelBtn, crossroadBtn, claimBtn)),
  );
}

/** 다음 목표 카드 — 지역 해금 → 3번째 원정대 → 도감 완성 순으로 지금 좇을 목표 하나만 (GDD 필러 3) */
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

  const maxTeamUnlock = content.balance.teams.find((u) => u.count === 3);
  if (maxTeamUnlock?.totalCaptured !== undefined && teamCount(content, state) < 3) {
    return el('div.card.goal-card', { onclick: () => tab.set('codex') },
      el('div.goal-head', {}, el('span', {}, '🎯 다음 목표 [3번째 원정대]')),
      el('div.goal-items', {}, el('div.goal-item', {},
        `▫️ 도감 ${Math.min(counts.total, maxTeamUnlock.totalCaptured)}/${maxTeamUnlock.totalCaptured}종 포획`)),
    );
  }

  const totalSpecies = content.monsterList.length;
  if (counts.total < totalSpecies) {
    return el('div.card.goal-card', { onclick: () => tab.set('codex') },
      el('div.goal-head', {}, el('span', {}, '🎯 다음 목표 [신대륙 도감의 완성]')),
      el('div.goal-items', {}, el('div.goal-item', {}, `▫️ 도감 ${counts.total}/${totalSpecies}종 포획 [전설은 심층 탐사에서만]`)),
    );
  }
  return null;
}

export function renderHome(): HTMLElement {
  const state = save();
  const running = state.expeditions.filter((e) => !e.claimed);

  const tutorialBanner = !state.profile.tutorialDone
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
    const tierName = TIER_LABEL[summary.tier].split(' ')[0];
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
    el('h2.section-title', {}, running.length > 0 ? `원정 현황 (${running.length})` : '원정 현황'),
    running.length === 0
      ? el('div.card.empty', {},
          el('div', {}, '지금은 모두 캠프에서 쉬고 있습니다.'),
          el('button.btn.btn-primary', { onclick: () => tab.set('expedition') }, '원정 보내기'),
        )
      : el('div.stack', {}, ...running.map((e) => expeditionCard(e.id))),
    nextGoalCard(),
    (() => {
      // 반복 과업 진입 (GDD §9.3) — 랭킹은 상단바 🏆 아이콘으로 이동 (2026-08-23 사용자)
      const taskTimes = content.tasks.reduce((sum, task) => sum + (state.tasks[task.id] ?? 0), 0);
      return el('div.card.list-row', {},
        el('span', {}, `📋 반복 과업 [달성 ${taskTimes}회]`),
        el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'tasks' }) }, '보기'),
      );
    })(),
    el('h2.section-title', {}, archive.length > 0 ? `최근 일지 (${archive.length})` : '최근 일지'),
    recent.length > 0
      ? el('div.card', {}, ...recent, journalToggle)
      : el('div.card.empty', {}, el('span.muted', {}, '아직 기록이 없습니다')),
  );
}

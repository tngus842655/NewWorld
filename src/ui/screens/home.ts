/**
 * 홈 — 원정 현황 카드, 귀환 정산 진입, (DEV) 시간 가속.
 * 카드 구조는 고정하고 시간 관련 표시만 scopedEffect로 갱신한다 (탭 안정성).
 */
import { content } from '../../content';
import { canUnlockRegion, capturedCounts, isRegionUnlocked, teamCount } from '../../core/progression';
import { scoreBreakdown } from '../../core/score';
import * as clock from '../../state/clock';
import { claim, nowTick, save } from '../../state/store';
import { monsterIcon } from '../components';
import { TIER_LABEL, el, fmtAgo, fmtClock, fmtGold, fmtRemain, scopedEffect } from '../kit';
import { openRankingBoard } from '../rankingSheets';
import { overlay, tab } from '../router';

function expeditionCard(expeditionId: string): HTMLElement {
  const state = save();
  const expedition = state.expeditions.find((e) => e.id === expeditionId && !e.claimed)!;
  const region = content.regions.get(expedition.regionId)!;
  const total = Math.max(1, expedition.endsAt - expedition.startedAt);
  const pendingChoices = expedition.choices.filter((c) => c === null).length;

  const fill = el('div.progress-fill');
  const remain = el('span.muted');
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
  });

  return el('div.card.exp-card', {},
    el('div.exp-head', {},
      el('div.exp-title', {}, `${region.icon} ${region.name}`),
      el('span.tag', {}, TIER_LABEL[expedition.tier]),
    ),
    el('div.exp-party', {}, ...expedition.partyIds.map((monsterId) => monsterIcon(monsterId))),
    el('div.progress', {}, fill),
    el('div.exp-foot', {}, remain, el('div.row-gap', {}, crossroadBtn, claimBtn)),
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
        el('span', {}, `🎯 다음 목표 — ${lockedRegion.name} 해금`),
        check.ok ? el('span.tag.goal-ready', {}, '조건 달성!') : null,
      ),
      el('div.goal-items', {}, ...parts),
      el('div.muted.small', {}, check.ok ? '원정 화면에서 해금할 수 있습니다' : '깊은 지역일수록 보상이 커집니다'),
    );
  }

  const maxTeamUnlock = content.balance.teams.find((u) => u.count === 3);
  if (maxTeamUnlock?.totalCaptured !== undefined && teamCount(content, state) < 3) {
    return el('div.card.goal-card', { onclick: () => tab.set('codex') },
      el('div.goal-head', {}, el('span', {}, '🎯 다음 목표 — 3번째 원정대')),
      el('div.goal-items', {}, el('div.goal-item', {},
        `▫️ 도감 ${Math.min(counts.total, maxTeamUnlock.totalCaptured)}/${maxTeamUnlock.totalCaptured}종 포획`)),
    );
  }

  const totalSpecies = content.monsterList.length;
  if (counts.total < totalSpecies) {
    return el('div.card.goal-card', { onclick: () => tab.set('codex') },
      el('div.goal-head', {}, el('span', {}, '🎯 다음 목표 — 신대륙 도감의 완성')),
      el('div.goal-items', {}, el('div.goal-item', {}, `▫️ 도감 ${counts.total}/${totalSpecies}종 포획 — 전설은 심층 탐사에서만`)),
    );
  }
  return null;
}

export function renderHome(): HTMLElement {
  const state = save();
  const running = state.expeditions.filter((e) => !e.claimed);
  const capturedCount = Object.values(state.codex).filter((c) => c.captured).length;

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
  const recent = state.journalArchive.slice(0, 5).map((summary) => {
    const region = content.regions.get(summary.regionId);
    const tierName = TIER_LABEL[summary.tier].split(' ')[0];
    return el('div.list-row', {},
      el('div', {},
        el('div', {}, `${summary.wiped ? '💀' : '🏕️'} ${region?.name ?? summary.regionId} · ${tierName}`),
        el('div.muted.small', {}, fmtAgo(now - summary.endedAt)),
      ),
      el('span.muted.small', {}, `골드 ${fmtGold(summary.gold)} · 신규 ${summary.capturedCount} · 유물 ${summary.artifactCount}`),
    );
  });

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
      // 랭킹·반복 과업 진입 (GDD §9.3)
      const total = scoreBreakdown(content, state).total;
      const taskTimes = content.tasks.reduce((sum, task) => sum + (state.tasks[task.id] ?? 0), 0);
      return el('div.card', {},
        el('div.list-row', {},
          el('span', {}, `🏆 랭킹 — 종합 ${fmtGold(total)}점`),
          el('button.btn.btn-ghost', {
            onclick: () => { openRankingBoard(); overlay.set({ kind: 'ranking' }); },
          }, '보기'),
        ),
        el('div.list-row', {},
          el('span', {}, `📋 반복 과업 — 달성 ${taskTimes}회`),
          el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'tasks' }) }, '보기'),
        ),
      );
    })(),
    el('h2.section-title', {}, '최근 일지'),
    recent.length > 0 ? el('div.card', {}, ...recent) : el('div.card.empty', {}, el('span.muted', {}, '아직 기록이 없습니다')),
    el('button.codex-link', { onclick: () => tab.set('codex') }, `📖 도감 ${capturedCount}/${content.monsterList.length}`),
    import.meta.env.DEV
      ? el('div.card.devbar', {},
          el('span.muted.small', {}, 'DEV 시간 가속'),
          el('button.btn.btn-ghost', { onclick: () => clock.addDevSkew(30 * 60_000) }, '+30분'),
          el('button.btn.btn-ghost', { onclick: () => clock.addDevSkew(2 * 3600_000) }, '+2시간'),
          el('button.btn.btn-ghost', { onclick: () => clock.addDevSkew(8 * 3600_000) }, '+8시간'),
        )
      : null,
  );
}

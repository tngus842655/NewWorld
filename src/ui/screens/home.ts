/**
 * 홈 — 원정 현황 카드, 귀환 정산 진입, (DEV) 시간 가속.
 * 카드 구조는 고정하고 시간 관련 표시만 scopedEffect로 갱신한다 (탭 안정성).
 */
import { content } from '../../content';
import * as clock from '../../state/clock';
import { claim, nowTick, save } from '../../state/store';
import { monsterIcon } from '../components';
import { TIER_LABEL, el, fmtGold, fmtRemain, scopedEffect } from '../kit';
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
    remain.textContent = done ? '원정대가 돌아왔습니다!' : `귀환까지 ${fmtRemain(expedition.endsAt - now)}`;
    claimBtn.classList.toggle('hidden', !done);
    crossroadBtn?.classList.toggle('hidden', done);
  });

  return el('div.card.exp-card', {},
    el('div.exp-head', {},
      el('div.exp-title', {}, region.name),
      el('span.tag', {}, TIER_LABEL[expedition.tier]),
    ),
    el('div.exp-party', {}, ...expedition.partyUids.map((uid) => {
      const owned = state.roster.find((m) => m.uid === uid);
      return owned ? monsterIcon(owned.monsterId) : null;
    })),
    el('div.progress', {}, fill),
    el('div.exp-foot', {}, remain, el('div.row-gap', {}, crossroadBtn, claimBtn)),
  );
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

  const recent = state.journalArchive.slice(0, 5).map((summary) => {
    const region = content.regions.get(summary.regionId);
    return el('div.list-row', {},
      el('span', {}, `${region?.name ?? summary.regionId} ${summary.wiped ? '💀' : '🏕️'}`),
      el('span.muted', {}, `골드 ${fmtGold(summary.gold)} · 신규 ${summary.capturedCount} · 유물 ${summary.artifactCount}`),
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
    el('h2.section-title', {}, '최근 일지'),
    recent.length > 0 ? el('div.card', {}, ...recent) : el('div.card.empty', {}, el('span.muted', {}, '아직 기록이 없습니다')),
    el('div.muted.small.center', {}, `도감 ${capturedCount}/52`),
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

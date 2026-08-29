/**
 * 원정 가속 시트 (2026-08-23) — 모래시계를 골라 진행 중 원정의 남은 시간을 줄인다.
 * 모래시계는 등급 5단계(몬스터·유물과 동일)로 테두리 색을 구분한다.
 */
import { content } from '../content';
import type { HourglassDef } from '../content/schema';
import { adUsesLeft } from '../core/ads';
import { adsAvailable, showRewardedAd } from '../platform/ads';
import { signal } from '../state/signal';
import { devGrantHourglasses, grantAdInstantReturn, nowTick, save, useHourglassOn } from '../state/store';
import { hourglassIcon } from './components';
import { el, fmtRemain, josa, toast } from './kit';
import { sheetShell } from './overlays';
import { closeOverlay, overlay } from './router';
import { playSfx } from './sfx';

const adLoading = signal(false); // 광고 로드 중 — 시트가 초 단위로 재렌더되므로 시그널로

export function hourglassDuration(def: HourglassDef): string {
  return def.minutes >= 60 ? `${def.minutes / 60}시간` : `${def.minutes}분`;
}

export function accelerateSheet(expeditionId: string): HTMLElement | null {
  const state = save();
  const now = nowTick(); // 남은 시간 표시가 초 단위로 갱신되게
  const expedition = state.expeditions.find((e) => e.id === expeditionId && !e.claimed);
  if (!expedition) return null; // 정산됐거나 사라진 원정 — 시트 닫힘
  const region = content.regions.get(expedition.regionId);
  const done = expedition.endsAt <= now;

  const remain = expedition.endsAt - now;

  const rows = content.hourglassList.map((def) => {
    const owned = state.wallet.hourglasses[def.id] ?? 0;
    // 코어는 단축 결과를 현재 시각으로 클램프하고 모래시계는 그대로 1개 소모한다 —
    // 남은 시간보다 긴 것을 쓰면 초과분이 그냥 사라진다. 누르기 전에 알려준다 (2026-08-25 사용자).
    // 1분 미만 초과는 알리지 않는다 — 남은 시간이 줄면 거의 항상 몇 초씩 넘쳐서 경고가 무뎌진다.
    const excess = def.minutes * 60_000 - remain;
    const wasteful = !done && excess >= 60_000;
    return el('div.list-row.hg-row', {},
      el('div.hg-body', {},
        // 미니 아이콘을 이름 옆 인라인으로 — 상점과 동일한 스케일 (등급은 테두리 색으로만)
        el('div.hg-name', {}, hourglassIcon(def, { small: true }), def.name),
        el('div.muted.small', {}, `${hourglassDuration(def)} 단축 · 보유 ${owned}개`),
        wasteful
          ? el('div.small.hg-waste', {}, `⚠️ 남은 시간보다 깁니다 [초과 ${josa(fmtRemain(excess), '은', '는')} 사라집니다]`)
          : null,
      ),
      el('button.btn.btn-primary.hg-use', {
        disabled: owned <= 0 || done,
        onclick: () => {
          const result = useHourglassOn(expeditionId, def.id);
          if (!result) return;
          playSfx('confirm');
          if (result.finished) {
            toast(`⏳ ${result.hourglass.name} 사용 [원정대가 돌아왔습니다!]`, 'ok');
            closeOverlay(); // 홈 카드의 일지 열기 버튼이 보이게
          } else {
            toast(`⏳ ${result.hourglass.name} 사용 [${hourglassDuration(result.hourglass)} 단축!]`, 'ok');
          }
        },
      }, '사용'),
    );
  });

  // 광고 즉시 귀환 (GDD §9.2 — 1일 3회). 광고 불가 환경에서는 행 자체를 숨긴다
  const adReturnsLeft = adUsesLeft(content, state, 'instantReturn', now);
  const adRow = adsAvailable() && !done
    ? el('div.list-row.hg-row', {},
        el('div.hg-body', {},
          el('div.hg-name', {}, '📺 광고 보고 즉시 귀환'),
          el('div.muted.small', {}, `남은 시간 전부 단축 · 오늘 ${adReturnsLeft}회 남음`),
        ),
        el('button.btn.btn-primary.hg-use', {
          disabled: adReturnsLeft <= 0 || adLoading(),
          onclick: () => {
            adLoading.set(true);
            void showRewardedAd().then((result) => {
              adLoading.set(false);
              if (result === 'rewarded') {
                if (grantAdInstantReturn(expeditionId)) {
                  playSfx('confirm');
                  closeOverlay(); // 홈 카드의 일지 열기 버튼이 보이게
                }
              } else if (result === 'dismissed') {
                toast('광고를 끝까지 봐야 보상을 받아요', 'error');
              } else {
                toast('지금은 광고를 불러올 수 없습니다 — 잠시 후 다시', 'error');
              }
            });
          },
        }, adLoading() ? '준비 중…' : '시청'),
      )
    : null;

  return sheetShell('⏳ 원정 가속',
    el('div.card.list-row', {},
      el('div', {},
        el('div', {}, `${region?.icon ?? ''} ${region?.name ?? expedition.regionId}`),
        el('div.muted.small', {}, done ? '원정대가 돌아왔습니다!' : `귀환까지 ${fmtRemain(expedition.endsAt - now)}`),
      ),
    ),
    el('div.card.stack-sm', {}, ...rows, adRow),
    el('div.card.list-row', {},
      el('span.muted.small', {}, '모래시계는 상점에서 판매합니다'),
      el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'shop' }) }, '상점 열기'),
    ),
    import.meta.env.DEV
      ? el('button.btn.btn-ghost', { onclick: devGrantHourglasses }, 'DEV [모래시계 각 +1]')
      : null,
  );
}

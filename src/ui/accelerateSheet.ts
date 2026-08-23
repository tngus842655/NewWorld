/**
 * 원정 가속 시트 (2026-08-23) — 모래시계를 골라 진행 중 원정의 남은 시간을 줄인다.
 * 모래시계는 등급 5단계(몬스터·유물과 동일)로 테두리 색을 구분한다.
 */
import { content } from '../content';
import type { HourglassDef } from '../content/schema';
import { devGrantHourglasses, nowTick, save, useHourglassOn } from '../state/store';
import { hourglassIcon } from './components';
import { el, fmtRemain, toast } from './kit';
import { sheetShell } from './overlays';
import { closeOverlay, overlay } from './router';
import { playSfx } from './sfx';

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

  const rows = content.hourglassList.map((def) => {
    const owned = state.wallet.hourglasses[def.id] ?? 0;
    return el('div.list-row.hg-row', {},
      el('div.hg-body', {},
        // 미니 아이콘을 이름 옆 인라인으로 — 상점과 동일한 스케일 (등급은 테두리 색으로만)
        el('div.hg-name', {}, hourglassIcon(def, { small: true }), def.name),
        el('div.muted.small', {}, `${hourglassDuration(def)} 단축 · 보유 ${owned}개`),
      ),
      el('button.btn.btn-primary.hg-use', {
        disabled: owned <= 0 || done,
        onclick: () => {
          const result = useHourglassOn(expeditionId, def.id);
          if (!result) return;
          playSfx('confirm');
          if (result.finished) {
            toast(`⏳ ${result.hourglass.name} 사용 — 원정대가 돌아왔습니다!`, 'ok');
            closeOverlay(); // 홈 카드의 일지 열기 버튼이 보이게
          } else {
            toast(`⏳ ${result.hourglass.name} 사용 — ${hourglassDuration(result.hourglass)} 단축!`, 'ok');
          }
        },
      }, '사용'),
    );
  });

  return sheetShell('⏳ 원정 가속',
    el('div.card.list-row', {},
      el('div', {},
        el('div', {}, `${region?.icon ?? ''} ${region?.name ?? expedition.regionId}`),
        el('div.muted.small', {}, done ? '원정대가 돌아왔습니다!' : `귀환까지 ${fmtRemain(expedition.endsAt - now)}`),
      ),
    ),
    el('div.card.stack-sm', {}, ...rows),
    el('div.card.list-row', {},
      el('span.muted.small', {}, '모래시계는 다이아 상점에서 구할 수 있습니다'),
      el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'shop' }) }, '상점 열기'),
    ),
    import.meta.env.DEV
      ? el('button.btn.btn-ghost', { onclick: devGrantHourglasses }, 'DEV — 모래시계 각 +1')
      : null,
  );
}

/**
 * 앱 셸 — 헤더 + 화면 컨테이너 + 하단 탭 + 오버레이. effect가 화면을 다시 그린다.
 */
import { canCheckIn } from '../core/attendance';
import { effect } from '../state/signal';
import { ctx, save } from '../state/store';
import { el, withScope } from './kit';
import { renderOverlay } from './overlays';
import { openRankingBoard } from './rankingSheets';
import { resetShop } from './shopSheet';
import { overlay, tab, type Overlay, type Tab } from './router';
import { playSfx } from './sfx';
import { renderCamp } from './screens/camp';
import { renderCodex } from './screens/codex';
import { renderExpedition } from './screens/expedition';
import { renderHome } from './screens/home';
import { renderSettings } from './screens/settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '🏕️' },
  { id: 'expedition', label: '원정', icon: '🧭' },
  { id: 'camp', label: '캠프', icon: '🎒' },
  { id: 'codex', label: '도감', icon: '📖' },
  { id: 'settings', label: '설정', icon: '⚙️' },
];

function renderScreen(current: Tab): HTMLElement {
  switch (current) {
    case 'home': return renderHome();
    case 'expedition': return renderExpedition();
    case 'codex': return renderCodex();
    case 'camp': return renderCamp();
    case 'settings': return renderSettings();
  }
}

export function mountApp(root: HTMLElement): void {
  const header = el('header.appbar', {});
  const container = el('main.container', {});
  const tabbar = el('nav.tabbar', {});
  const overlayHost = el('div.overlay-host', {});
  root.replaceChildren(header, container, tabbar, overlayHost);

  effect(() => {
    const state = save();
    header.replaceChildren(
      // 타이틀 대신 진입 아이콘들 (2026-08-23 사용자) — 랭킹·상점 전체 화면
      el('div.appbar-icons', {},
        el('button.appbar-rank', {
          title: '랭킹 보기',
          onclick: () => {
            playSfx('tap');
            openRankingBoard();
            overlay.set({ kind: 'ranking' });
          },
        }, '🏆'),
        el('button.appbar-rank', {
          title: '상점',
          onclick: () => {
            playSfx('tap');
            resetShop();
            overlay.set({ kind: 'shop' });
          },
        }, '🏪'),
        el('button.appbar-rank', {
          title: '출석 달력',
          onclick: () => {
            playSfx('tap');
            overlay.set({ kind: 'attendance' });
          },
          // 비추적 시계 — 매초 헤더 재렌더 방지 (도장 후엔 save 변경으로 즉시 갱신)
        }, '📅', canCheckIn(state, ctx.now()) ? el('span.attend-dot', {}) : null),
      ),
      // 재화는 홈 화면 상단으로 이동 (2026-08-23 사용자) — 재화가 커지면 앱바가 줄바꿈되던 문제
    );
  });

  let disposeScreen: (() => void) | null = null;
  effect(() => {
    const current = tab();
    const scrollTop = container.scrollTop;
    disposeScreen?.();
    const { value, dispose } = withScope(() => renderScreen(current));
    disposeScreen = dispose;
    container.replaceChildren(value);
    container.scrollTop = scrollTop;
  });

  effect(() => {
    const current = tab();
    tabbar.replaceChildren(
      ...TABS.map(({ id, label, icon }) =>
        el(`button.tab${current === id ? '.active' : ''}`, {
          onclick: () => {
            if (current !== id) playSfx('tap');
            tab.set(id);
          },
        },
          el('span.tab-icon', {}, icon),
          el('span.tab-label', {}, label),
        ),
      ),
    );
  });

  let prevOverlay: Overlay = null;
  effect(() => {
    const current = overlay();
    const node = renderOverlay(current);
    // 같은 시트의 재렌더(편성 탭·합성 등)는 스크롤을 유지하고 등장 애니메이션을 다시 틀지 않는다
    const sameKind = current !== null && current.kind === prevOverlay?.kind;
    const prevScroll = sameKind ? (overlayHost.querySelector('.sheet')?.scrollTop ?? 0) : 0;
    if (sameKind) {
      const sheet = node?.querySelector<HTMLElement>('.sheet');
      if (sheet) sheet.style.animation = 'none';
    }
    overlayHost.replaceChildren(...(node ? [node] : []));
    if (sameKind && prevScroll > 0) {
      const sheet = overlayHost.querySelector('.sheet');
      if (sheet) sheet.scrollTop = prevScroll;
    }
    document.body.classList.toggle('overlay-open', node !== null);
    // 열림·닫힘·전환(갈림길→일지) 시점 효과음 — 종류가 같은 재렌더는 무음
    if (current && current.kind !== prevOverlay?.kind) {
      playSfx(current.kind === 'crossroads' ? 'question' : 'open');
    } else if (!current && prevOverlay) {
      playSfx('close');
    }
    prevOverlay = current;
  });
}

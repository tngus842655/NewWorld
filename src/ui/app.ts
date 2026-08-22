/**
 * 앱 셸 — 헤더 + 화면 컨테이너 + 하단 탭 + 오버레이. effect가 화면을 다시 그린다.
 */
import { effect } from '../state/signal';
import { save } from '../state/store';
import { el, fmtGold, withScope } from './kit';
import { renderOverlay } from './overlays';
import { overlay, tab, type Tab } from './router';
import { renderCamp } from './screens/camp';
import { renderCodex } from './screens/codex';
import { renderExpedition } from './screens/expedition';
import { renderHome } from './screens/home';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '🏕️' },
  { id: 'expedition', label: '원정', icon: '🧭' },
  { id: 'codex', label: '도감', icon: '📖' },
  { id: 'camp', label: '캠프', icon: '🎒' },
];

function renderScreen(current: Tab): HTMLElement {
  switch (current) {
    case 'home': return renderHome();
    case 'expedition': return renderExpedition();
    case 'codex': return renderCodex();
    case 'camp': return renderCamp();
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
      el('div.appbar-title', {}, 'NewWorld'),
      el('div.appbar-wallet', {},
        el('span', {}, `💰 ${fmtGold(state.wallet.gold)}`),
        el('span', {}, `✨ ${fmtGold(state.wallet.dust)}`),
        el('span', {}, `🪤 ${state.wallet.lures}`),
      ),
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
        el(`button.tab${current === id ? '.active' : ''}`, { onclick: () => tab.set(id) },
          el('span.tab-icon', {}, icon),
          el('span.tab-label', {}, label),
        ),
      ),
    );
  });

  effect(() => {
    const node = renderOverlay(overlay());
    overlayHost.replaceChildren(...(node ? [node] : []));
    document.body.classList.toggle('overlay-open', node !== null);
  });
}

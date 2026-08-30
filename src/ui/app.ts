/**
 * 앱 셸 — 헤더 + 화면 컨테이너 + 하단 탭 + 오버레이. effect가 화면을 다시 그린다.
 */
import { canCheckIn } from '../core/attendance';
import { effect, signal } from '../state/signal';
import { ctx, save } from '../state/store';
import type { SaveState } from '../core/types';
import { el, fmtCompact, fmtGold, withScope } from './kit';
import { renderOverlay } from './overlays';
import { resetShop } from './shopSheet';
import { overlay, tab, type Overlay, type Tab } from './router';
import { playSfx } from './sfx';
import { renderCamp } from './screens/camp';
import { renderCodex } from './screens/codex';
import { renderExpedition } from './screens/expedition';
import { renderHome } from './screens/home';
import { renderSettings } from './screens/settings';

// ── 재화 지갑 (앱바, 2026-08-25 사용자 요청으로 홈 카드에서 복귀) ──
// 탭하면 얻기·쓰기 설명이 뜬다. 별도 '재화 안내 시트'를 지우고 이 말풍선이 그 역할을 대체한다 (2026-08-23).
const selCurrency = signal<string | null>(null);
const CURRENCIES = [
  { id: 'gold', icon: '💰', name: '골드', gain: '조우 승리 · 보물 · 일지 정산 · 도감 마일스톤', use: '몬스터 레벨업·각성 · 파티 슬롯 확장 · 미끼 제작' },
  { id: 'dust', icon: '✨', name: '가루', gain: '과업·마일스톤·출석·상점', use: '유물 강화' },
  { id: 'lures', icon: '🪤', name: '미끼', gain: '캠프에서 제작 (지역 재료 + 골드) · 상점', use: '파견에 자동 적재 [희귀 이상 몬스터 포획률 ×2]' },
  { id: 'diamonds', icon: '💎', name: '다이아', gain: '월간 출석 (충전은 정식 출시 후)', use: '다이아 상점 [뽑기·모래시계·패키지]' },
] as const;

type CurrencyId = (typeof CURRENCIES)[number]['id'];

/** 앱바 폭이 한정적이라 4종 모두 축약 — 다이아가 가장 넓었다 (💎 999999 = 77px) */
function currencyValue(state: SaveState, id: CurrencyId): string {
  return fmtCompact(rawCurrency(state, id));
}

function rawCurrency(state: SaveState, id: CurrencyId): number {
  const { wallet } = state;
  return id === 'gold' ? wallet.gold : id === 'dust' ? wallet.dust : id === 'lures' ? wallet.lures : wallet.diamonds;
}

function walletBar(state: SaveState): HTMLElement {
  const sel = selCurrency();
  return el('div.appbar-wallet', {},
    ...CURRENCIES.map((c) =>
      el(`button.wallet-item${sel === c.id ? '.active' : ''}`, {
        title: c.name,
        onclick: () => { playSfx('tap'); selCurrency.set(sel === c.id ? null : c.id); },
      }, `${c.icon} ${currencyValue(state, c.id)}`)),
  );
}

function currencyTip(state: SaveState): HTMLElement | null {
  const tip = CURRENCIES.find((c) => c.id === selCurrency());
  if (!tip) return null;
  return el('div.wallet-tip.appbar-tip', {},
    el('div.wallet-tip-title', {}, `${tip.icon} ${tip.name}`,
      el('span.muted.small', {}, `  보유 ${fmtGold(rawCurrency(state, tip.id))}`)), // 말풍선은 정확한 값 — 축약은 앱바 줄에서만
    el('div.small.muted', {}, `얻기 [${tip.gain}]`),
    el('div.small.wallet-tip-use', {}, `쓰기 [${tip.use}]`),
  );
}

/**
 * 상점 진입 버튼 — 3D 가판대 아이콘 (2026-08-29 사용자, 원정 지도와 같은 Adventure Game 팩으로 톤 통일).
 * 에셋 실패 시 이모지 폴백 (mapEntryButton과 같은 패턴)
 */
function shopEntryButton(): HTMLElement {
  const img = el<'img'>('img');
  img.src = '/assets/ui/shop-stall.webp';
  img.alt = '상점';
  const button = el('button.appbar-rank', {
    title: '상점',
    onclick: () => {
      playSfx('tap');
      resetShop();
      overlay.set({ kind: 'shop' });
    },
  }, img);
  img.onerror = () => { img.remove(); button.prepend('🏪'); };
  return button;
}

/**
 * 출석 달력 진입 버튼 — 3D 달력 아이콘 (2026-08-29 사용자). Adventure Game 팩에 달력이 없어
 * Brian Savero 팩에서 크림 몸체+빨간 밴드로 톤을 맞췄다 (빨간 날짜 한 칸 = 출석 도장 모티프)
 */
function attendanceEntryButton(state: SaveState): HTMLElement {
  const img = el<'img'>('img');
  img.src = '/assets/ui/attendance-calendar.webp';
  img.alt = '출석 달력';
  const button = el('button.appbar-rank', {
    title: '출석 달력',
    tour: 'attendance',
    onclick: () => {
      playSfx('tap');
      overlay.set({ kind: 'attendance' });
    },
    // 비추적 시계 — 매초 헤더 재렌더 방지 (도장 후엔 save 변경으로 즉시 갱신)
  }, img, canCheckIn(state, ctx.now()) ? el('span.attend-dot', {}) : null);
  img.onerror = () => { img.remove(); button.prepend('📅'); };
  return button;
}

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
    const tip = currencyTip(state);
    header.replaceChildren(
      // 타이틀 대신 진입 아이콘들 (2026-08-23 사용자) — 상점·출석.
      // 랭킹 🏆는 스토어 출시를 앞두고 앱바에서 뺐다 (2026-08-29 사용자 — 일반 공개 여부 추후 결정, 진입은 설정 탭)
      // 원정 지도 진입은 홈 '원정 현황' 타이틀 우측 아이콘 (2026-08-27 사용자 — 앱바가 아니라 홈 안쪽)
      el('div.appbar-icons', {},
        shopEntryButton(),
        attendanceEntryButton(state),
      ),
      // 재화를 앱바로 복귀 (2026-08-25 사용자) — 2026-08-23에 "커지면 줄바꿈"을 이유로 홈 카드로 내렸었다.
      // 축약 표기(fmtCompact, 최대 6글자)로 그 원인을 없앴고 아이콘 간격도 좁혔다.
      walletBar(state),
      // 탭한 재화의 설명 — 앱바 아래로 떨어지는 말풍선 (홈 카드에 있던 기능을 그대로 옮겼다)
      ...(tip ? [tip] : []),
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
          tour: `tab-${id}`, // 온보딩 투어 스포트라이트 대상 (GDD §11.2)
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
  let disposeOverlay: (() => void) | null = null;
  effect(() => {
    const current = overlay();
    // 시트도 화면처럼 스코프 이펙트를 수거한다 (2026-08-27) — 지도 시트의 초 단위 마커·시간 갱신이
    // 시트가 닫히거나 바뀐 뒤에도 영구 effect로 살아남지 않게 (kit.ts scopedEffect는 스코프 밖이면 안 죽는다)
    disposeOverlay?.();
    const { value: node, dispose } = withScope(() => renderOverlay(current));
    disposeOverlay = dispose;
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

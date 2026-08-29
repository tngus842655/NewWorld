/**
 * 로그인 게이트 — 회원 전용 정책 (2026-08-29 사용자: 비회원 이용 차단).
 * 세션이 없으면 게임 대신 이 화면만 보인다. 로그인은 리디렉션이라 성공 시 페이지가
 * 새로 뜨며 main.ts가 게임을 마운트한다. DEV에서는 ?dev-guest로 우회 가능 (main.ts).
 */
import { signInWithGoogle } from '../state/cloud';
import { googleG } from './components';
import { el } from './kit';

export function renderGate(root: HTMLElement): void {
  const logo = el<'img'>('img');
  logo.src = '/assets/ui/expedition-map.webp';
  logo.alt = 'NewWorld';
  const logoBox = el('div.gate-logo', {}, logo);
  logo.onerror = () => { logo.remove(); logoBox.append('🧭'); };

  root.replaceChildren(
    el('div.gate', {},
      logoBox,
      el('h1.gate-title', {}, 'NewWorld'),
      el('div.gate-sub', {}, '몬스터 포획 원정 RPG'),
      el('button.google-btn', {
        onclick: () => void signInWithGoogle(),
      }, googleG('google-g'), 'Google로 계속하기'),
      // 약관·방침 — 로그인 없이 열람 가능해야 한다 (#/... 해시 → main.ts가 공개 페이지로 라우팅)
      el('div.gate-links', {},
        el('button.gate-link', { onclick: () => { window.location.hash = '#/terms'; } }, '이용약관'),
        el('span.gate-link-dot', {}, '·'),
        el('button.gate-link', { onclick: () => { window.location.hash = '#/privacy'; } }, '개인정보처리방침'),
      ),
    ),
  );
}

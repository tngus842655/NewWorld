/**
 * 로그인 게이트 — 회원 전용 정책 (2026-08-29 사용자: 비회원 이용 차단).
 * 세션이 없으면 게임 대신 이 화면만 보인다. 로그인은 리디렉션이라 성공 시 페이지가
 * 새로 뜨며 main.ts가 게임을 마운트한다. DEV에서는 ?dev-guest로 우회 가능 (main.ts).
 * 배경은 풀블리드 키아트(login-background.png — 게임명 포함)라 별도 로고·타이틀이 없고,
 * 버튼·링크는 하단 스크림 위에 얹힌다 (styles.css .gate).
 */
import { describeBanUntil, type BanInfo } from '../state/ban';
import { signInWithGoogle, signOutGoogle } from '../state/cloud';
import { googleG } from './components';
import { el } from './kit';

/**
 * 이용 제한 안내 (검토 ⑥) — banInfo가 잡히면 게임 대신 이 화면 (main.ts).
 * 클라 안내일 뿐 실효 강제는 서버(saves RLS·submit-score). 임시 제한은 기한이 지나면
 * 다음 부팅에서 자동 해제된다 (조회가 null을 돌려줌).
 */
export function renderBanned(root: HTMLElement, ban: BanInfo): void {
  root.replaceChildren(
    el('div.gate', {},
      el('div.card.ban-card', {},
        el('h2', {}, '🚫 이용이 제한되었습니다'),
        el('p', {}, `기간: ${describeBanUntil(ban.until)}`),
        ...(ban.reason ? [el('p', {}, `사유: ${ban.reason}`)] : []),
        el('p.muted.small', {}, '문의: tngus842655@gmail.com'),
        el('button.btn.btn-ghost', { onclick: () => void signOutGoogle() }, '로그아웃'),
      ),
    ),
  );
}

export function renderGate(root: HTMLElement): void {
  root.replaceChildren(
    el('div.gate', {},
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

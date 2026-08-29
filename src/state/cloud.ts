/**
 * 인증 전용 모듈 — 구글 로그인(Supabase Auth) 세션 관리 (ROADMAP M5, 2026-08-29).
 * ⚠️ 여기서는 store를 import하지 않는다: 게이트(비로그인) 화면이 이 모듈을 쓰는데,
 * store는 로드되는 순간 세이브를 생성·저장해버린다 — 탈퇴 직후 빈 세이브가 되살아나던
 * 원인 (2026-08-29 실사고). 세이브 동기화·탈퇴 등 store 결합 로직은 cloudSync.ts에.
 * 회원 전용: 로그아웃(명시적·유령 세션 정리 포함)은 SIGNED_OUT → 새로고침 → 게이트.
 */
import { Capacitor } from '@capacitor/core';
import { toast } from '../ui/kit';
import { signal } from './signal';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

export const cloudSession = signal<Session | null>(null);

/**
 * 관리자 여부 (검토 ④) — profiles.is_admin (본인 행 select). 서버가 정본이고 컬럼은
 * 대시보드에서만 켤 수 있다. 이 플래그는 정보 메뉴 노출 같은 UI 가드 전용 — 민감한 동작의
 * 권한 판정은 반드시 서버(RLS·엣지 함수)가 한다.
 */
export const isAdmin = signal(false);

/** DEV 한정 ?dev-admin — 관리자 메뉴 노출을 로그인 없이 검증 (dev-guest와 짝, 프로드 번들에서는 제거됨) */
const DEV_ADMIN = import.meta.env.DEV && new URLSearchParams(location.search).has('dev-admin');

async function refreshAdminFlag(session: Session | null): Promise<void> {
  if (DEV_ADMIN) {
    isAdmin.set(true);
    return;
  }
  if (!session) {
    isAdmin.set(false);
    return;
  }
  const { data } = await supabase.from('profiles').select('is_admin').eq('id', session.user.id).single();
  isAdmin.set(data?.is_admin === true);
}

/** 네이티브 앱의 OAuth 복귀 딥링크 — AndroidManifest의 intent-filter와 반드시 같아야 한다 */
const NATIVE_REDIRECT = 'com.expeditionmonsters.app://auth-callback';

export async function signInWithGoogle(): Promise<void> {
  // 네이티브(Capacitor): 웹뷰 내 구글 OAuth는 차단(disallowed_useragent) — 시스템 브라우저
  // (커스텀 탭)로 나갔다 딥링크로 복귀한다 (ROADMAP M5). 복귀 처리는 initAuth의 appUrlOpen.
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
    });
    if (error || !data.url) {
      toast(`구글 로그인 실패 [${error?.message ?? '인증 URL 없음'}]`, 'error');
      return;
    }
    await Browser.open({ url: data.url });
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) toast(`구글 로그인 실패 [${error.message}]`, 'error');
}

/** 딥링크 복귀 — PKCE ?code=를 세션으로 교환하고 재부팅한다 (웹의 리디렉션 왕복과 같은 그림) */
async function handleAuthDeepLink(url: string): Promise<void> {
  if (!url.startsWith(NATIVE_REDIRECT)) return;
  // 커스텀 스킴은 URL 파서가 환경마다 다르게 읽는다 — 쿼리 문자열을 직접 잘라 파싱
  const query = (url.split('?')[1] ?? '').split('#')[0]!;
  const params = new URLSearchParams(query);
  const { Browser } = await import('@capacitor/browser');
  void Browser.close().catch(() => { /* 커스텀 탭이 이미 닫혔으면 그만 */ });
  const code = params.get('code');
  if (!code) {
    toast(`구글 로그인 실패 [${params.get('error_description') ?? params.get('error') ?? '코드 없음'}]`, 'error');
    return;
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    toast(`구글 로그인 실패 [${error.message}]`, 'error');
    return;
  }
  window.location.reload(); // 게이트에 멈춘 화면 → 세션 확보 상태로 재부팅 → 게임 마운트
}

export async function signOutGoogle(): Promise<void> {
  await supabase.auth.signOut(); // SIGNED_OUT 이벤트 → 새로고침 → 게이트 (initAuth)
}

/** OAuth 리디렉션이 에러를 들고 돌아온 경우 — 조용히 삼키면 "그냥 안 됨"으로 보인다 (2026-08-29 실사례) */
function surfaceAuthError(): void {
  const params = new URLSearchParams(window.location.search || window.location.hash.replace(/^#/, '?'));
  const code = params.get('error_code') ?? params.get('error');
  if (!code) return;
  const desc = params.get('error_description') ?? '';
  toast(`구글 로그인 실패 [${code}] ${desc}`, 'error');
  history.replaceState(null, '', window.location.pathname); // 새로고침 때 같은 토스트 반복 방지
}

/** 부팅 시 1회 (main.ts) — 초기 세션을 돌려준다 (null이면 게이트). 게임 상태는 건드리지 않는다 */
export async function initAuth(): Promise<Session | null> {
  surfaceAuthError();
  // getSession은 리디렉션 복귀 시 코드 교환(detectSessionInUrl)까지 끝난 세션을 준다
  const { data } = await supabase.auth.getSession();
  cloudSession.set(data.session);
  void refreshAdminFlag(data.session);
  // 네이티브: OAuth 복귀 딥링크 수신 — 앱이 떠 있으면 appUrlOpen(singleTask 재진입),
  // 브라우저에 나간 사이 죽었으면 launchUrl로 들어온다. launchUrl은 재부팅 후에도 같은 값을
  // 돌려주므로 세션이 없을 때만 본다 (성공 직후 reload가 쓰고 버린 코드를 재교환하지 않게)
  if (Capacitor.isNativePlatform()) {
    const { App } = await import('@capacitor/app');
    void App.addListener('appUrlOpen', ({ url }) => { void handleAuthDeepLink(url); });
    if (!data.session) {
      const launch = await App.getLaunchUrl();
      if (launch?.url) void handleAuthDeepLink(launch.url);
    }
  }
  supabase.auth.onAuthStateChange((event, session) => {
    cloudSession.set(session);
    if (event === 'SIGNED_IN') void refreshAdminFlag(session); // 토큰 갱신마다 재조회할 필요는 없다
    // 회원 전용 (2026-08-29) — 로그아웃은 게이트로 돌아간다
    if (event === 'SIGNED_OUT') window.location.reload();
  });
  return data.session;
}

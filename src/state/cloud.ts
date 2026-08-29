/**
 * 인증 전용 모듈 — 구글 로그인(Supabase Auth) 세션 관리 (ROADMAP M5, 2026-08-29).
 * ⚠️ 여기서는 store를 import하지 않는다: 게이트(비로그인) 화면이 이 모듈을 쓰는데,
 * store는 로드되는 순간 세이브를 생성·저장해버린다 — 탈퇴 직후 빈 세이브가 되살아나던
 * 원인 (2026-08-29 실사고). 세이브 동기화·탈퇴 등 store 결합 로직은 cloudSync.ts에.
 * 회원 전용: 로그아웃(명시적·유령 세션 정리 포함)은 SIGNED_OUT → 새로고침 → 게이트.
 */
import { toast } from '../ui/kit';
import { signal } from './signal';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

export const cloudSession = signal<Session | null>(null);

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) toast(`구글 로그인 실패 [${error.message}]`, 'error');
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
  supabase.auth.onAuthStateChange((event, session) => {
    cloudSession.set(session);
    // 회원 전용 (2026-08-29) — 로그아웃은 게이트로 돌아간다
    if (event === 'SIGNED_OUT') window.location.reload();
  });
  return data.session;
}

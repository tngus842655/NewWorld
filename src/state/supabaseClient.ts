/**
 * Supabase 공용 클라이언트 — 인증(구글)·클라우드 세이브가 쓴다.
 * anon 키는 공개용: RLS·엣지 함수 검증으로 보호되는 클라이언트 키 (비밀 아님).
 * 랭킹(ranking.ts)은 로그인 없이도 동작해야 해서 원시 fetch를 유지하고 상수만 여기서 가져간다.
 */
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://sbprvqtpshzrferjauxs.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHJ2cXRwc2h6cmZlcmphdXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5Mzc4MzQsImV4cCI6MjEwMjUxMzgzNH0.OsSh0PN4NZohDL0KKyplDSiDelx5olUrFwwHKg2fYHw';

// PKCE: 웹뷰·브라우저 리디렉션 플로에서 권장되는 방식. 세션은 localStorage에 유지된다.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce' },
});

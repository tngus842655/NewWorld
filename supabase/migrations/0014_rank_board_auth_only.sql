-- 리더보드 열람을 로그인 유저로 제한 (2026-08-30 사용자) — 회원 전용 게임이라 익명 열람 창구를 닫는다.
-- rank_board는 뷰라 RLS 대신 롤 권한으로 조인다. authenticated는 유지 (클라는 세션 토큰으로 읽음).

revoke select on public.rank_board from anon;

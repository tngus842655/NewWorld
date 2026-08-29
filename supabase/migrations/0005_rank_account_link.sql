-- 랭킹 신원을 계정에 연결 — 탈퇴 잔존 데이터 근절 (2026-08-29, ROADMAP M5 "계정 병합")
-- 배경: rank_scores는 익명 신원(playerId+secret)만 알아서, 탈퇴가 "현재 세이브의 신원과
-- 해시가 일치하는 행" 하나만 지울 수 있었다. 세이브 초기화·가져오기·기기 이동으로 신원이
-- 바뀌면 옛 행이 영구 잔존한다 (2026-08-29 실사고: 탈퇴 후 행 2개 잔존).
-- 로그인 세션의 submit-score가 user_id를 기록하고, auth.users 삭제가 cascade로 행을 지운다.
-- 익명 제출(user_id null)은 기존대로 계정과 무관하게 유지된다.
-- 클라 select 권한은 주지 않는다 (secret_hash와 동일 — rank_board 뷰에도 노출하지 않는다).
alter table public.rank_scores
  add column user_id uuid references auth.users (id) on delete cascade;

create index rank_scores_user_id_idx on public.rank_scores (user_id);

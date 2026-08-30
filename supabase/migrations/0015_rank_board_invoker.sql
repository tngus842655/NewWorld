-- rank_board를 security invoker 뷰로 전환 (2026-08-30 사용자 — 대시보드 UNRESTRICTED 배지 해소).
-- definer 뷰는 소유자 권한으로 돌아 RLS를 우회하므로 Supabase가 경고 배지를 붙인다.
-- invoker로 바꾸면 호출자의 RLS·권한을 타므로, 원본(rank_scores)을 다음처럼 연다:
--   RLS: 로그인 유저 select 허용(행 전체 — 리더보드는 공개 데이터)
--   컬럼 권한: 안전 컬럼만 grant — secret_hash·user_id는 직접 조회해도 permission denied
-- 관리자 제외(구 0013 뷰 필터)는 invoker에서는 profiles 열람 권한 문제가 생기므로
-- **제출 시점(submit-score v4)** 으로 이동 — 관리자면 행을 쓰지 않고 기존 행도 지운다.

-- 1) 기존 관리자 행 정리 (뷰 필터 제거 전에)
delete from public.rank_scores r
using public.profiles p
where p.id = r.user_id and p.is_admin;

-- 2) rank_scores 읽기 개방 (로그인 유저 · 안전 컬럼만)
create policy "rank-scores-read" on public.rank_scores
  for select to authenticated using (true);
revoke select on table public.rank_scores from anon, authenticated;
grant select (player_id, nickname, total, expedition, monster, artifact, task, power, updated_at)
  on public.rank_scores to authenticated;

-- 3) invoker 뷰 재생성 — 익명은 차단 유지 (0014 계승)
drop view public.rank_board;
create view public.rank_board with (security_invoker = true) as
select player_id, nickname, total, expedition, monster, artifact, task, power, updated_at
from public.rank_scores;
revoke all on public.rank_board from anon;
grant select on public.rank_board to authenticated;

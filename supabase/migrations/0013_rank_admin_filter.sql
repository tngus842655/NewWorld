-- 랭킹에서 관리자 계정 제외 (2026-08-30 사용자) — 운영 계정 점수가 리더보드를 오염시키지 않게.
-- 제출(submit-score)은 그대로 두고 노출만 뷰에서 거른다 — 규칙이 한 곳에 모이고 되돌리기 쉽다.
-- user_id가 없는 익명 잔재 행은 그대로 노출 (관리자 판별 불가 — 회원 전용 전환 후엔 새로 안 생긴다).

create or replace view public.rank_board as
select player_id, nickname, total, expedition, monster, artifact, task, power, updated_at
from public.rank_scores r
where not exists (
  select 1 from public.profiles p where p.id = r.user_id and p.is_admin
);

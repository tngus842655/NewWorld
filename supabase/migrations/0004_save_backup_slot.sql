-- 세이브 덮어쓰기 안전망 (2026-08-29) — 기기 전환 화해(reconcile)나 수동 '불러오기'에서
-- 한쪽 진행을 버리기로 한 순간, 버려질 세이브를 previous_*에 1세대 보관한다.
-- 실수로 덮어쓴 유저의 지원 요청 복구용. 정상 미러 업로드는 건드리지 않는다.
alter table public.saves
  add column if not exists previous_data jsonb,
  add column if not exists previous_saved_at bigint;

comment on column public.saves.previous_data is '버려진 직전 세이브 (화해·복원 결정 시점 1세대 백업)';
comment on column public.saves.previous_saved_at is '버려진 세이브의 클라 저장 시각(ms)';

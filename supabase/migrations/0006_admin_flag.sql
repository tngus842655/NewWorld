-- 관리자 플래그 (검토 목록 ④, 2026-08-30) — 설정 탭 데이터 뷰(몬스터·유물 정보) 관리자
-- 전용 전환의 토대이자, 이후 공지 작성·문의 답변 권한 판별의 정본.
--
-- ⚠️ RLS(profiles-own-update)만으로는 유저가 자기 행의 is_admin을 켤 수 있다.
-- 컬럼 권한으로 차단: 테이블 insert/update 권한을 회수하고 클라가 써도 되는 컬럼만 grant.
-- (insert도 잠그는 이유: 가입 트리거가 누락된 계정이 is_admin=true로 자가 생성하는 구멍)
-- 관리자 지정은 대시보드(service role) SQL로만.

alter table public.profiles add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is '관리자 여부 — 지정은 대시보드(service role) 전용, 클라는 읽기만';

revoke insert, update on table public.profiles from anon, authenticated;
grant insert (id, nickname, last_seen_at), update (id, nickname, last_seen_at)
  on public.profiles to authenticated;

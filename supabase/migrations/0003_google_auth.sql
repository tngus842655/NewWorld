-- 구글 로그인(Supabase Auth) 전환 — M5 계정 시스템 (2026-08-29, ROADMAP §M5)
-- 휴면 앱인토스 스키마(0001, toss_user_key 기준)를 auth.users 기준으로 재작업.
-- 세 테이블 모두 0행 확인 후 재생성 (rank_scores는 건드리지 않는다).
-- expeditions 미러(귀환 푸시용)는 푸시 트랙과 함께 보류 — 필요해질 때 새 마이그레이션으로.

drop table if exists public.expeditions;
drop table if exists public.saves;
drop table if exists public.profiles;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.profiles is '구글 로그인 유저 프로필 (auth.users 1:1) — 가입 트리거로 자동 생성';

create table public.saves (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null,             -- SaveState 통째 (LWW 동기화, 진실은 클라)
  version int not null,            -- SaveState.version — 복원 시 클라가 migrateSave로 검증
  client_saved_at bigint not null, -- 클라 lastSavedAt(ms) — 로컬 vs 클라우드 비교 기준
  updated_at timestamptz not null default now()
);

comment on table public.saves is '클라우드 세이브 — last-write-wins, 진실은 클라 (ROADMAP M5)';

alter table public.profiles enable row level security;
alter table public.saves enable row level security;

-- 본인 행만 접근 — 구글 로그인 세션(auth.uid())이 곧 프로필 id
create policy "profiles-own-select" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles-own-insert" on public.profiles
  for insert with check ((select auth.uid()) = id); -- 트리거 누락 시 클라 자가 복구용
create policy "profiles-own-update" on public.profiles
  for update using ((select auth.uid()) = id);

create policy "saves-own-all" on public.saves
  for all using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- 유저 생성 = 구글 첫 로그인: auth.users 삽입 시 프로필 행 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

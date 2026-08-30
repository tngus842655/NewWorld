-- 공지사항 (검토 목록 ⑨, 2026-08-30) — 접속 시 최신 공지 1건 팝업, '다시 보지 않기'는
-- 클라 localStorage에 공지 id 저장 (새 공지 = 더 큰 id 가 오면 다시 띄운다).
-- 작성은 관리자만 — v1은 대시보드 SQL이 기본, RLS는 인게임 관리자 UI를 미리 허용해 둔다:
--   insert into public.notices (title, body) values ('점검 안내', '8/31 02:00~04:00 점검입니다');
--   내리기: update public.notices set active = false where id = 1;

create table public.notices (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz, -- null = 무기한
  created_at timestamptz not null default now()
);

alter table public.notices enable row level security;

-- 읽기: 로그인 유저 전체, 게시 창 안의 활성 공지만 (회원 전용 게임이라 anon 불필요)
create policy "notices-read" on public.notices
  for select to authenticated
  using (active and starts_at <= now() and (ends_at is null or ends_at > now()));

-- 관리자: 전체 열람 + 작성·수정·삭제 (profiles.is_admin — 0006이 클라 변경을 막는 정본)
create policy "notices-admin-read" on public.notices
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));
create policy "notices-admin-insert" on public.notices
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));
create policy "notices-admin-update" on public.notices
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));
create policy "notices-admin-delete" on public.notices
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

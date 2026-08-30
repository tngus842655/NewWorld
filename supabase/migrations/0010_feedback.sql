-- 건의·버그 제보 (검토 목록 ⑩, 2026-08-30) — 비공개 1:1 문의함 (사용자 확정: 공개 게시판 아님).
-- 유저는 등록 + 본인 글 열람만, 관리자는 전체 열람 + 답변(reply)·상태 변경.
-- v1 답변은 대시보드 SQL:
--   update public.feedback set reply = '답변 내용', status = 'done', replied_at = now() where id = 1;
-- 컬럼 권한(0006 profiles와 같은 수법): insert는 세 컬럼만 — status/reply를 등록 시점에 위조 못 한다.
-- update는 관리자 컬럼만 grant — RLS(admin)와 이중 잠금 (본문 수정은 유저·관리자 모두 불가).

create table public.feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('suggestion', 'bug')),
  body text not null check (char_length(body) between 2 and 2000),
  status text not null default 'open' check (status in ('open', 'done')),
  reply text,
  created_at timestamptz not null default now(),
  replied_at timestamptz
);

alter table public.feedback enable row level security;

create policy "feedback-own-insert" on public.feedback
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "feedback-own-select" on public.feedback
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "feedback-admin-select" on public.feedback
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

create policy "feedback-admin-update" on public.feedback
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));

revoke insert, update on table public.feedback from anon, authenticated;
grant insert (user_id, category, body) on public.feedback to authenticated;
grant update (status, reply, replied_at) on public.feedback to authenticated; -- RLS가 관리자만 통과시킨다

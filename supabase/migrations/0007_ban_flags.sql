-- 이용 제한(블랙리스트) (검토 목록 ⑥, 2026-08-30) — 버그 악용 유저 임시/영구 차단·해제.
-- banned_until: null = 정상, 'infinity' = 영구, 미래 시각 = 임시 (지나면 자동 해제).
-- 지정·해제는 대시보드(service role) SQL로만:
--   임시:  update public.profiles set banned_until = now() + interval '7 days', banned_reason = '...' where id = '...';
--   영구:  update public.profiles set banned_until = 'infinity', banned_reason = '...' where id = '...';
--   해제:  update public.profiles set banned_until = null, banned_reason = null where id = '...';
-- 0006이 profiles의 insert/update를 컬럼 단위 grant로 잠갔으므로 새 컬럼은 자동으로 클라 변경 불가.
-- 본인 select는 유지 — 클라가 제한 사유·기간을 안내 화면에 띄운다.

alter table public.profiles
  add column banned_until timestamptz,
  add column banned_reason text;

comment on column public.profiles.banned_until is '이용 제한 만료 — null 정상 / infinity 영구 / 미래 시각 임시';

-- 서버 강제 1: 제한 중에는 클라우드 세이브 접근(업로드·다운로드) 차단.
-- 게이트는 클라 안내일 뿐 — 조작된 클라도 진행을 올릴 수 없어야 제한이 실효.
drop policy "saves-own-all" on public.saves;
create policy "saves-own-all" on public.saves
  for all using (
    (select auth.uid()) = profile_id
    and not exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.banned_until > now()
    )
  )
  with check (
    (select auth.uid()) = profile_id
    and not exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.banned_until > now()
    )
  );

-- 서버 강제 2(랭킹 제출 차단)는 submit-score 엣지 함수에서 — 함수 사본과 같은 커밋.

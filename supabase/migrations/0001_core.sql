-- NewWorld M4 — 코어 스키마 (DATA.md §4)
-- 원칙: 콘텐츠는 DB에 넣지 않는다(클라 JSON이 원본). DB는 유저 상태와 푸시 스케줄만.
-- RLS는 여기서 켜두고, 정책은 인증 방식 확정과 함께 0002에서 추가한다.
-- (정책 없는 RLS = anon 전면 차단이 기본값이라 안전)

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  toss_user_key text unique not null,          -- 앱인토스 로그인 식별자
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.profiles is '앱인토스 유저 프로필 (toss_user_key 1:1)';

create table public.saves (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null,                         -- SaveState 통째 (LWW 동기화)
  version int not null,
  updated_at timestamptz not null default now()
);

comment on table public.saves is '클라이언트 SaveState 미러 — last-write-wins, 진실은 클라';

create table public.expeditions (
  id uuid primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  region_id text not null,
  tier text not null check (tier in ('scout', 'standard', 'deep')),
  ends_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'done', 'claimed')),
  return_push_sent boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.expeditions is '귀환 푸시 스케줄링용 미러 — 게임 진실은 세이브 쪽';

-- pg_cron이 매분 조회하는 핫패스: 아직 안 보낸 완료 원정
create index expeditions_due on public.expeditions (ends_at) where status = 'running';
create index expeditions_profile on public.expeditions (profile_id);

alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.expeditions enable row level security;

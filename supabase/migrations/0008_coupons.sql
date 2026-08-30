-- 쿠폰 (검토 목록 ⑦, 2026-08-30) — 코드 입력 시 재화 지급 (다이아·골드·가루·미끼·재료).
-- 발급은 대시보드 SQL로:
--   insert into public.coupons (code, goods, expires_at, max_redemptions, memo)
--   values ('WELCOME300', '{"diamonds":300}', now() + interval '30 days', 1000, '런칭 기념');
--   (goods 키: gold / dust / diamonds / lures / materials{"재료id":개수} — core/coupon.ts 스키마)
-- 사용 규칙: 인당 1회(coupon_redemptions PK), 총 수량 한도(max_redemptions, null=무제한),
-- 만료(expires_at, null=무기한). 판정·차감은 redeem_coupon() 한 트랜잭션에서 원자적으로.

create table public.coupons (
  code text primary key,             -- 대문자·숫자·하이픈 — 입력은 서버가 upper 정규화
  goods jsonb not null,
  expires_at timestamptz,            -- null = 무기한
  max_redemptions int,               -- null = 무제한
  redeemed_count int not null default 0,
  memo text,
  created_at timestamptz not null default now()
);

create table public.coupon_redemptions (
  coupon_code text not null references public.coupons (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (coupon_code, user_id) -- 인당 1회
);

-- RLS 켜고 정책 없음 = 전면 차단 — 접근은 service role(redeem-coupon 엣지 함수)만
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

create or replace function public.redeem_coupon(p_code text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  select * into c from public.coupons where code = p_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if c.max_redemptions is not null and c.redeemed_count >= c.max_redemptions then
    return jsonb_build_object('ok', false, 'error', 'exhausted');
  end if;
  begin
    insert into public.coupon_redemptions (coupon_code, user_id) values (p_code, p_user);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already');
  end;
  update public.coupons set redeemed_count = redeemed_count + 1 where code = p_code;
  return jsonb_build_object('ok', true, 'goods', c.goods);
end;
$$;

-- security definer 함수는 기본으로 public 실행 가능 — 서비스 롤 전용으로 잠근다
revoke execute on function public.redeem_coupon(text, uuid) from public, anon, authenticated;

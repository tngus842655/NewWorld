-- 다이아 감사 뷰 (검토 ⑤, 2026-08-30) — 세이브 원장(diamondLog) vs 서버 정본 대조.
-- 조회는 service role 전용 (대시보드 SQL / MCP): select * from diamond_audit order by balance desc;
-- 보는 법:
--   mismatch      true = 원장 합계 ≠ 잔액 → 메모리로 잔액만 조작 (즉시 블랙 후보)
--   unverified_iap iap:* 원장 합계 − 검증 영수증 합계 → 양수 크면 가짜 결제 의심
--                  (1층 시크릿 설정 전 소프트 신뢰 지급분도 여기 잡힌다 — 도입 시점 참작)
--   attendance_over true = 출석 다이아가 이론 상한(월 800 = 50+100+150+200+300) 초과 → 날짜 조작
--   devsim_total   0이 아니면 프로드 세이브에 DEV 시뮬 충전 흔적 (그 자체가 이상)
--   legacy_total   v14 원장 도입 이전 잔액 (출처 미상 — 판단 시 참작)
-- ⚠️ 출석 상한 800·상품→다이아 표는 balance.json·DIAMOND_PACKS와 손으로 동기화 — 바꾸면 여기도.

create or replace view public.diamond_audit as
with ledger as (
  select
    s.profile_id,
    coalesce((s.data->>'version')::int, 0) as save_version,
    coalesce((s.data->'wallet'->>'diamonds')::bigint, 0) as balance,
    coalesce((s.data->>'diamondLogBase')::bigint, 0) as base,
    coalesce(s.data->'diamondLog', '[]'::jsonb) as log
  from public.saves s
),
sums as (
  select
    l.profile_id,
    l.save_version,
    l.balance,
    l.base + coalesce((select sum((e->>'delta')::bigint) from jsonb_array_elements(l.log) e), 0) as ledger_sum,
    coalesce((select sum((e->>'delta')::bigint) from jsonb_array_elements(l.log) e where e->>'source' like 'iap:%'), 0) as iap_total,
    coalesce((select sum((e->>'delta')::bigint) from jsonb_array_elements(l.log) e where e->>'source' like 'attendance:%'), 0) as attendance_total,
    coalesce((select sum((e->>'delta')::bigint) from jsonb_array_elements(l.log) e where e->>'source' like 'coupon:%'), 0) as coupon_total,
    coalesce((select sum((e->>'delta')::bigint) from jsonb_array_elements(l.log) e where e->>'source' like 'dev-sim:%'), 0) as devsim_total,
    coalesce((select sum((e->>'delta')::bigint) from jsonb_array_elements(l.log) e where e->>'source' = 'legacy'), 0) as legacy_total,
    coalesce((select -sum((e->>'delta')::bigint) from jsonb_array_elements(l.log) e where e->>'source' like 'shop:%'), 0) as shop_spent
  from ledger l
),
receipts as (
  select user_id, sum(case product_id
    when 'diamonds_300' then 300 when 'diamonds_550' then 550 when 'diamonds_1000' then 1000
    when 'diamonds_4000' then 4000 when 'diamonds_7000' then 7000 when 'diamonds_15000' then 15000
    else 0 end) as receipt_diamonds
  from public.iap_receipts
  where purchase_state = 0
  group by user_id
)
select
  u.email,
  p.nickname,
  m.save_version,
  m.balance,
  m.ledger_sum,
  -- v14 이전 세이브는 원장이 없다 — null = 아직 판정 대상 아님 (오탐 방지)
  case when m.save_version >= 14 then m.balance <> m.ledger_sum end as mismatch,
  m.iap_total,
  coalesce(r.receipt_diamonds, 0) as receipt_diamonds,
  m.iap_total - coalesce(r.receipt_diamonds, 0) as unverified_iap,
  m.attendance_total,
  greatest(1, ceil(extract(epoch from (now() - p.created_at)) / 2592000))::bigint * 800 as attendance_ceiling,
  m.attendance_total > greatest(1, ceil(extract(epoch from (now() - p.created_at)) / 2592000))::bigint * 800 as attendance_over,
  m.coupon_total,
  m.devsim_total,
  m.legacy_total,
  m.shop_spent,
  p.banned_until,
  m.profile_id
from sums m
join public.profiles p on p.id = m.profile_id
join auth.users u on u.id = m.profile_id
left join receipts r on r.user_id = m.profile_id;

-- service role 전용 — 뷰는 소유자(postgres) 권한으로 돌므로 클라 롤에서 회수
revoke all on public.diamond_audit from anon, authenticated;

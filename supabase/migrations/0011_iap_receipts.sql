-- 결제 영수증 대장 (검토 ⑤ 1층, 2026-08-30) — verify-purchase 엣지 함수가
-- Google Play Developer API 검증을 통과한 거래를 기록한다. 다이아 원장의 iap:* 항목과
-- 대조하는 서버측 정본 (0012 diamond_audit).
-- 탈퇴해도 영수증은 남긴다 (set null) — 결제 기록은 CS·감사 자료다.

create table public.iap_receipts (
  purchase_token text primary key,
  user_id uuid references auth.users (id) on delete set null,
  product_id text not null,
  order_id text,
  purchase_state int not null, -- 0 구매 완료 / 1 취소 / 2 보류 (구글 API purchaseState)
  verified_at timestamptz not null default now()
);

create index iap_receipts_user on public.iap_receipts (user_id);

-- RLS 켜고 정책 없음 = 전면 차단 — 접근은 service role(엣지 함수·감사)만
alter table public.iap_receipts enable row level security;

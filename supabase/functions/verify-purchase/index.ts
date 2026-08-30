// 결제 영수증 검증 (검토 ⑤ 1층, 2026-08-30) — Google Play Developer API로 구매 토큰 진위 확인.
// 통과 시 iap_receipts에 기록하고 ok — 클라는 ok(또는 판정 불가 skip)일 때만 지급한다.
// 'invalid' = 구글이 무효 판정(가짜 결제·취소) → 클라 지급 금지.
// 'not-configured' = GOOGLE_PLAY_SA_JSON 시크릿 미설정 → 클라는 소프트 신뢰로 폴백 (결제 안 막음).
// 시크릿: 대시보드 Edge Functions → Secrets → GOOGLE_PLAY_SA_JSON = 서비스 계정 키 JSON 통째.
// 2026-08-30 가동 확인: 시크릿·Play 콘솔 권한(play-verify@newworld-507003) 설정 완료,
// 가짜 토큰 400(Invalid Value) 판정까지 검증 — 검증 모드 ON. 남은 확인은 라이선스 테스터 실결제.
// 수정 시 MCP deploy_edge_function으로 재배포할 것 — 서버 배포본이 실행 진실, 이 파일은 저장소 사본.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'npm:jose@5';

const PACKAGE_NAME = 'com.expeditionmonsters.app';
const VALID_PRODUCTS = new Set([
  'diamonds_300', 'diamonds_550', 'diamonds_1000', 'diamonds_4000', 'diamonds_7000', 'diamonds_15000',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // x-client-info 필수 — functions.invoke가 붙인다 (redeem-coupon 실사고와 동일)
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** 서비스 계정 JWT → 액세스 토큰 (androidpublisher 스코프) */
async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string | null> {
  const key = await importPKCS8(sa.private_key, 'RS256');
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid-request' });
  }
  const productId = String(body['productId'] ?? '');
  const purchaseToken = String(body['purchaseToken'] ?? '');
  if (!VALID_PRODUCTS.has(productId) || purchaseToken.length < 8 || purchaseToken.length > 512) {
    return json(400, { ok: false, error: 'invalid-request' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: tokenUser } = await supabase.auth.getUser(token);
  const userId = tokenUser?.user?.id;
  if (!userId) return json(401, { ok: false, error: 'auth' });

  const saRaw = Deno.env.get('GOOGLE_PLAY_SA_JSON');
  if (!saRaw) return json(200, { ok: false, error: 'not-configured' });

  let purchase: { purchaseState?: number; orderId?: string };
  try {
    const sa = JSON.parse(saRaw);
    const accessToken = await googleAccessToken(sa);
    if (!accessToken) return json(200, { ok: false, error: 'google-auth' });
    const verifyRes = await fetch(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (verifyRes.status === 404 || verifyRes.status === 400) {
      // 구글이 모르는 토큰 = 위조 (또는 상품-토큰 불일치) — 지급 금지 판정
      return json(200, { ok: false, error: 'invalid' });
    }
    if (!verifyRes.ok) return json(200, { ok: false, error: 'google-error' });
    purchase = await verifyRes.json();
  } catch {
    return json(200, { ok: false, error: 'google-error' });
  }

  // purchaseState: 0 구매 완료 / 1 취소 / 2 보류 — 완료만 지급
  if (purchase.purchaseState !== 0) return json(200, { ok: false, error: 'invalid' });

  const { error: writeError } = await supabase.from('iap_receipts').upsert({
    purchase_token: purchaseToken,
    user_id: userId,
    product_id: productId,
    order_id: purchase.orderId ?? null,
    purchase_state: 0,
    verified_at: new Date().toISOString(),
  });
  if (writeError) return json(200, { ok: false, error: 'server' });

  return json(200, { ok: true, orderId: purchase.orderId ?? null });
});

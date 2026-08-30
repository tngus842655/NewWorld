// 쿠폰 사용 (검토 ⑦, 2026-08-30) — 본인 JWT 필수, 판정·차감은 redeem_coupon RPC가 원자적으로.
// 응답의 goods는 클라 core/coupon.ts가 스키마 검증 후 지급한다.
// 수정 시 MCP deploy_edge_function으로 재배포할 것 — 서버 배포본이 실행 진실, 이 파일은 저장소 사본.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // ⚠️ x-client-info 필수 — supabase-js functions.invoke가 이 헤더를 붙이는데, 허용 목록에
  // 없으면 프리플라이트 통과 후 본요청이 브라우저에서 차단된다 (2026-08-30 실기기 실사고 —
  // 서버 로그에 OPTIONS만 남고 POST가 없다). raw fetch를 쓰는 submit-score는 해당 없음.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid' });
  }

  // 대소문자 무시 — 저장은 대문자 정본
  const code = String(body['code'] ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) return json(400, { ok: false, error: 'invalid' });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: tokenUser } = await supabase.auth.getUser(token);
  const userId = tokenUser?.user?.id;
  if (!userId) return json(401, { ok: false, error: 'auth' });

  // 이용 제한 검사 (검토 ⑥ 공통 패턴) — 'infinity' 비교는 SQL에 위임
  const { data: banned } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .gt('banned_until', new Date().toISOString())
    .maybeSingle();
  if (banned) return json(403, { ok: false, error: 'banned' });

  const { data, error } = await supabase.rpc('redeem_coupon', { p_code: code, p_user: userId });
  if (error) return json(500, { ok: false, error: 'server' });
  return json(200, data as Record<string, unknown>);
});

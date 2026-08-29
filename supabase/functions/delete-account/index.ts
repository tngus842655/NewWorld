// 회원 탈퇴 (2026-08-29, Google Play 계정 삭제 요건) — 본인 JWT 검증 후 auth 유저를 삭제한다.
// profiles·saves·랭킹(user_id 연결분, 0005)은 FK on delete cascade로 함께 지워진다.
// 계정에 연결되지 않은 익명 랭킹 행은 본문 신원(playerId+secret)이 해시 일치할 때만 삭제
// (실패해도 탈퇴는 진행). 세이브 초기화·가져오기로 신원이 바뀌면 이 경로로는 못 지운다 —
// 로그인 제출분은 cascade가 보장 (2026-08-29 실사고: 신원 불일치로 행 2개 잔존).
// 수정 시 MCP deploy_edge_function으로 재배포할 것 — 서버 배포본이 실행 진실, 이 파일은 저장소 사본.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // x-client-info: supabase-js functions.invoke가 자동으로 붙인다 — 빠뜨리면 프리플라이트에서 차단 (2026-08-29 실사고)
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function bad(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return bad(405, 'POST only');

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 게이트웨이 verify_jwt를 통과한 토큰이라도, 반드시 그 토큰의 주인만 삭제한다
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return bad(401, 'invalid token');

  // 랭킹 행 삭제 — 신원 해시가 일치할 때만. 어떤 실패도 탈퇴 자체를 막지 않는다
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const playerId = String(body['playerId'] ?? '');
    const secret = String(body['secret'] ?? '');
    if (/^[0-9a-f]{8,64}$/.test(playerId) && secret.length >= 8 && secret.length <= 128) {
      const secretHash = await sha256(`${playerId}:${secret}`);
      const { error: rankError } = await admin
        .from('rank_scores').delete().eq('player_id', playerId).eq('secret_hash', secretHash);
      // supabase-js는 throw하지 않는다 — error를 안 보면 침묵 실패 (2026-08-29 원인 조사에서 확인)
      if (rankError) console.warn('rank cleanup failed:', rankError.message);
    }
  } catch { /* 본문 없음·파싱 실패 — 랭킹 삭제만 건너뛴다 */ }

  const { error } = await admin.auth.admin.deleteUser(userData.user.id);
  if (error) return bad(500, 'delete failed');

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});

// 랭킹 점수 제출 (2026-08-23, GDD §9.3)
// 익명 신원: playerId + secret. 최초 제출이 secret 해시를 등록하고, 이후 제출은 해시가 일치해야 한다.
// v1 소프트 신뢰 — 서버는 타입·상한만 검증한다 (로컬 게임 특성상 위조 원천 차단은 불가).
// v2 (2026-08-29): 로그인 세션 제출이면 user_id를 함께 기록 — auth.users on delete cascade로
// 탈퇴가 행을 지운다 (0005_rank_account_link). 익명 제출은 user_id를 보내지 않아 기존 연결을 보존한다.
// 수정 시 MCP deploy_edge_function으로 재배포할 것 — 서버 배포본이 실행 진실, 이 파일은 저장소 사본.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SCORE_CAP = 5_000_000; // 이론상 도달 불가한 상한 — 명백한 위조만 컷

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad(400, 'invalid json');
  }

  const playerId = String(body['playerId'] ?? '');
  const secret = String(body['secret'] ?? '');
  const nickname = String(body['nickname'] ?? '').trim().slice(0, 12);
  const scores = body['scores'] as Record<string, unknown> | undefined;
  if (!/^[0-9a-f]{8,64}$/.test(playerId)) return bad(400, 'bad playerId');
  if (secret.length < 8 || secret.length > 128) return bad(400, 'bad secret');
  if (nickname.length < 2) return bad(400, 'bad nickname');
  if (!scores || typeof scores !== 'object') return bad(400, 'bad scores');

  const fields = ['total', 'expedition', 'monster', 'artifact', 'task', 'power'] as const;
  const row: Record<string, number> = {};
  for (const field of fields) {
    const value = scores[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > SCORE_CAP) {
      return bad(400, `bad score: ${field}`);
    }
    row[field] = value;
  }

  const secretHash = await sha256(`${playerId}:${secret}`);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 로그인 세션 제출이면 행을 계정에 연결 — anon key 호출은 getUser가 실패해 익명으로 남는다
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: tokenUser } = await supabase.auth.getUser(token);
  const userId = tokenUser?.user?.id ?? null;

  const { data: existing, error: readError } = await supabase
    .from('rank_scores')
    .select('secret_hash')
    .eq('player_id', playerId)
    .maybeSingle();
  if (readError) return bad(500, 'read failed');
  if (existing && existing.secret_hash !== secretHash) return bad(403, 'identity mismatch');

  const { error: writeError } = await supabase.from('rank_scores').upsert({
    player_id: playerId,
    secret_hash: secretHash,
    nickname,
    ...row,
    ...(userId ? { user_id: userId } : {}), // 미포함 시 기존 user_id 유지 (merge-duplicates)
    updated_at: new Date().toISOString(),
  });
  if (writeError) return bad(500, 'write failed');

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});

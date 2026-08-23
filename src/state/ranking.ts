/**
 * 랭킹 서버 연동 (Supabase, 2026-08-23) — 비크리티컬: 실패는 조용히 무시, 게임은 완전 오프라인 동작.
 * 신원: 세이브의 playerId/secret (익명 — 추후 구글 로그인 연동 예정, 세이브 내보내기로 기기 이동).
 * 쓰기는 submit-score 엣지 함수만, 읽기는 rank_board 뷰 (RLS로 원본 테이블 차단).
 */
import { content } from '../content';
import { scoreBreakdown } from '../core/score';
import type { SaveState } from '../core/types';

const SUPABASE_URL = 'https://sbprvqtpshzrferjauxs.supabase.co';
// 공개용 anon 키 — RLS·엣지 함수 검증으로 보호되는 클라이언트 키 (비밀 아님)
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHJ2cXRwc2h6cmZlcmphdXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5Mzc4MzQsImV4cCI6MjEwMjUxMzgzNH0.OsSh0PN4NZohDL0KKyplDSiDelx5olUrFwwHKg2fYHw';

const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

export type RankCategory = 'total' | 'expedition' | 'monster' | 'artifact' | 'task' | 'power';

export interface BoardRow {
  player_id: string;
  nickname: string;
  total: number;
  expedition: number;
  monster: number;
  artifact: number;
  task: number;
  power: number;
}

let lastSubmitted = ''; // 같은 점수는 재전송하지 않는다

/** 현재 세이브의 점수를 제출 — 실패해도 게임에는 영향 없음 */
export async function submitScore(save: SaveState): Promise<boolean> {
  const scores = scoreBreakdown(content, save);
  const payload = JSON.stringify({
    playerId: save.profile.playerId,
    secret: save.profile.playerSecret,
    nickname: save.profile.nickname,
    scores,
  });
  if (payload === lastSubmitted) return true;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: payload,
    });
    if (res.ok) lastSubmitted = payload;
    return res.ok;
  } catch {
    return false;
  }
}

/** 카테고리별 상위 50명 + 내 순위 (50위 밖이면 카운트 질의로 계산) */
export async function fetchBoard(
  category: RankCategory,
  playerId: string,
): Promise<{ rows: BoardRow[]; myRank: number | null } | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rank_board?select=*&order=${category}.desc,updated_at.asc&limit=50`,
      { headers: HEADERS },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as BoardRow[];

    const inBoard = rows.findIndex((row) => row.player_id === playerId);
    if (inBoard >= 0) return { rows, myRank: inBoard + 1 };

    const mineRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rank_board?select=${category}&player_id=eq.${playerId}`,
      { headers: HEADERS },
    );
    const mine = mineRes.ok ? ((await mineRes.json()) as Record<string, number>[]) : [];
    if (mine.length === 0) return { rows, myRank: null };

    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rank_board?select=player_id&${category}=gt.${mine[0]![category]}`,
      { headers: { ...HEADERS, Prefer: 'count=exact', Range: '0-0' } },
    );
    const totalAbove = Number(countRes.headers.get('content-range')?.split('/')[1]);
    return { rows, myRank: Number.isFinite(totalAbove) ? totalAbove + 1 : null };
  } catch {
    return null;
  }
}

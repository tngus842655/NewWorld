/**
 * 건의·버그 제보 (검토 ⑩, 2026-08-30) — 비공개 1:1 문의함. 서버 RLS가 본인 글만 보여주고,
 * status/reply 컬럼은 권한상 유저가 쓸 수 없다 (0010). 답변은 v1 대시보드 SQL.
 */
import { cloudSession } from './cloud';
import { supabase } from './supabaseClient';

export type FeedbackCategory = 'suggestion' | 'bug';

export interface FeedbackEntry {
  id: number;
  category: FeedbackCategory;
  body: string;
  status: 'open' | 'done';
  reply: string | null;
  created_at: string;
}

// DEV 한정 (dev-guest — 세션 없음): localStorage 시뮬로 등록·목록 흐름을 검증 (쿠폰 DEV_SIM과 같은 관례)
const DEV_SIM = () => import.meta.env.DEV && !cloudSession();
const DEV_KEY = 'newworld-dev-feedback';

export async function fetchMyFeedback(): Promise<FeedbackEntry[] | null> {
  if (DEV_SIM()) {
    return (JSON.parse(localStorage.getItem(DEV_KEY) ?? '[]') as FeedbackEntry[]).reverse();
  }
  if (!cloudSession()) return null;
  const { data, error } = await supabase
    .from('feedback')
    .select('id, category, body, status, reply, created_at')
    .order('id', { ascending: false })
    .limit(20);
  return error ? null : (data as FeedbackEntry[]);
}

export async function submitFeedback(category: FeedbackCategory, body: string): Promise<boolean> {
  if (DEV_SIM()) {
    const list = JSON.parse(localStorage.getItem(DEV_KEY) ?? '[]') as FeedbackEntry[];
    list.push({ id: list.length + 1, category, body, status: 'open', reply: null, created_at: new Date().toISOString() });
    localStorage.setItem(DEV_KEY, JSON.stringify(list));
    return true;
  }
  const session = cloudSession();
  if (!session) return false;
  const { error } = await supabase.from('feedback').insert({ user_id: session.user.id, category, body });
  return !error;
}

/**
 * 공지 팝업 (검토 ⑨, 2026-08-30) — 접속 시 최신 공지 1건. '다시 보지 않기'를 누르면
 * 그 공지 id를 기기에 저장하고, 더 큰 id(신규 공지)가 와야 다시 띄운다.
 * 그냥 닫으면 다음 접속에 또 보인다. 조회 실패(오프라인)는 조용히 스킵 — 로컬 우선.
 * 게시 창(활성·기간)은 서버 RLS(notices-read)가 거른다.
 */
import { showNotice } from '../ui/dialog';
import { cloudSession } from './cloud';
import { supabase } from './supabaseClient';

const DISMISSED_KEY = 'newworld-notice-dismissed';

interface Notice {
  id: number;
  title: string;
  body: string;
}

export async function checkNotice(): Promise<void> {
  let notice: Notice | null = null;
  // DEV 한정 ?dev-notice — 서버 없이 팝업·억제 흐름 검증 (dev-guest와 짝)
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('dev-notice')) {
    notice = { id: 999_999, title: '점검 안내 (DEV)', body: 'DEV 검증용 공지입니다.\n줄바꿈도 이렇게 보입니다.' };
  } else {
    if (!cloudSession()) return; // 공지는 로그인 유저 대상 (회원 전용 게임)
    try {
      const { data } = await supabase
        .from('notices')
        .select('id, title, body')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return;
      notice = data as Notice;
    } catch {
      return; // 오프라인·일시 장애 — 공지는 비크리티컬
    }
  }
  const dismissed = Number(localStorage.getItem(DISMISSED_KEY) ?? '0');
  if (notice.id <= dismissed) return;
  const dismiss = await showNotice(notice.title, notice.body);
  if (dismiss) localStorage.setItem(DISMISSED_KEY, String(notice.id));
}

/**
 * 문의하기 시트 (검토 ⑩) — 작성(건의/버그 + 본문) 위, 내 문의 목록(상태·답변) 아래.
 * 비공개 1:1: 목록은 서버 RLS가 본인 글만 준다. 랭킹 시트의 로드 패턴을 따른다.
 */
import { fetchMyFeedback, submitFeedback, type FeedbackCategory, type FeedbackEntry } from '../state/feedback';
import { signal } from '../state/signal';
import { el, toast } from './kit';
import { sheetShell } from './overlays';
import { playSfx } from './sfx';

const CATEGORY_LABEL: Record<FeedbackCategory, string> = { suggestion: '💡 건의', bug: '🐞 버그' };
const STATUS_LABEL = { open: '접수', done: '답변 완료' } as const;

type ListState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; entries: FeedbackEntry[] };

const list = signal<ListState>({ phase: 'loading' });
// 카테고리는 시그널이 아니라 모듈 변수 + 버튼 클래스 직접 토글 — 시그널이면 재렌더가
// 작성 중 textarea 초안을 날린다 (panels.ts controlled 모드와 같은 함정)
let category: FeedbackCategory = 'suggestion';
let loadToken = 0;
let sending = false;

async function loadList(): Promise<void> {
  const token = ++loadToken;
  list.set({ phase: 'loading' });
  const entries = await fetchMyFeedback();
  if (token !== loadToken) return;
  list.set(entries ? { phase: 'ready', entries } : { phase: 'error' });
}

/** 문의 시트를 열 때 호출 — 카테고리 리셋 + 목록 조회 시작 */
export function openFeedback(): void {
  category = 'suggestion';
  void loadList();
}

function fmtDate(iso: string): string {
  const at = new Date(iso);
  return `${at.getMonth() + 1}.${at.getDate()}`;
}

export function feedbackSheet(): HTMLElement {
  const current = list();

  const input = el<'textarea'>('textarea.dialog-input.feedback-input', {
    placeholder: '내용을 적어주세요 (버그는 상황·화면을 함께 적어주시면 큰 도움이 됩니다)',
  });

  const catButtons = (['suggestion', 'bug'] as const).map((cat) =>
    el(`button.btn.btn-sm.${cat === category ? 'btn-primary' : 'btn-ghost'}`, {
      onclick: () => {
        category = cat;
        catButtons.forEach((button, index) => {
          button.classList.toggle('btn-primary', (['suggestion', 'bug'] as const)[index] === cat);
          button.classList.toggle('btn-ghost', (['suggestion', 'bug'] as const)[index] !== cat);
        });
      },
    }, CATEGORY_LABEL[cat]),
  );

  const send = async (): Promise<void> => {
    const body = input.value.trim();
    if (body.length < 2) {
      toast('내용을 2자 이상 적어주세요', 'error');
      return;
    }
    if (sending) return; // 연타 방지 — 재렌더 전 이중 제출
    sending = true;
    const ok = await submitFeedback(category, body.slice(0, 2000));
    sending = false;
    toast(ok ? '접수되었습니다 — 확인 후 답변드릴게요' : '전송에 실패했습니다 — 잠시 후 다시 시도해 주세요', ok ? 'ok' : 'error');
    if (ok) {
      playSfx('tap');
      input.value = '';
      void loadList(); // 목록 갱신이 시트를 재렌더한다
    }
  };

  const entryView = (entry: FeedbackEntry) =>
    el('div.feedback-entry', {},
      el('div.feedback-entry-head', {},
        el('span.tag', {}, CATEGORY_LABEL[entry.category]),
        el(`span.tag.${entry.status === 'done' ? 'tag-ok' : ''}`, {}, STATUS_LABEL[entry.status]),
        el('span.muted.small', {}, fmtDate(entry.created_at)),
      ),
      el('div.feedback-entry-body', {}, entry.body),
      entry.reply ? el('div.feedback-reply', {}, `↳ ${entry.reply}`) : null,
    );

  return sheetShell('💬 문의하기',
    el('div.sheet-body', {},
      el('div.card', {},
        el('div.row-gap', {}, ...catButtons),
        input,
        el('button.btn.btn-primary', { onclick: () => void send() }, '보내기'),
      ),
      el('h3.section-title', {}, '내 문의'),
      current.phase === 'loading'
        ? el('div.muted.small', {}, '불러오는 중…')
        : current.phase === 'error'
          ? el('div.muted.small', {}, '목록을 불러오지 못했습니다 — 연결을 확인해 주세요')
          : current.entries.length === 0
            ? el('div.muted.small', {}, '아직 문의가 없습니다')
            : el('div.feedback-list', {}, ...current.entries.map(entryView)),
    ),
  );
}

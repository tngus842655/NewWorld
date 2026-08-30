/**
 * 확인·입력 다이얼로그 — 네이티브 confirm/prompt 대체 (M4 완성도).
 * 오버레이(1층 시트)와 독립된 최상위 레이어라 유물 상세 시트 위에서도 뜬다.
 * Promise로 결과만 돌려주고 DOM은 스스로 정리한다.
 */
import { el } from './kit';
import { playSfx } from './sfx';

interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** false = 배경 탭으로 닫히지 않는다 — 실수 탭이 곧 선택이 되면 안 되는 결정용 (기기 전환 화해 등) */
  dismissible?: boolean;
}

function mount(card: HTMLElement, onCancel: () => void, dismissible = true): HTMLElement {
  const backdrop = el('div.dialog-backdrop', {
    onclick: (event) => { if (dismissible && event.target === event.currentTarget) onCancel(); },
  }, card);
  document.body.append(backdrop);
  playSfx('open');
  return backdrop;
}

/** 확인/취소 — 확정 시 true. 배경 탭·취소는 false */
export function askConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (ok: boolean) => {
      backdrop.remove();
      if (!ok) playSfx('close');
      resolve(ok);
    };
    const card = el('div.dialog', {},
      el('div.dialog-title', {}, opts.title),
      el('div.dialog-message', {}, opts.message),
      el('div.dialog-actions', {},
        el('button.btn.btn-ghost', { onclick: () => close(false) }, opts.cancelLabel ?? '취소'),
        el(`button.btn.${opts.danger ? 'btn-danger' : 'btn-primary'}`, { onclick: () => close(true) }, opts.confirmLabel ?? '확인'),
      ),
    );
    const backdrop = mount(card, () => close(false), opts.dismissible ?? true);
  });
}

/** 공지 팝업 (검토 ⑨) — resolve true = '다시 보지 않기' (다음 신규 공지까지 억제) */
export function showNotice(title: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (dismiss: boolean) => {
      backdrop.remove();
      playSfx('close');
      resolve(dismiss);
    };
    const card = el('div.dialog.dialog-notice', {},
      el('div.dialog-title', {}, `📢 ${title}`),
      el('div.dialog-message.notice-body', {}, body),
      el('div.dialog-actions', {},
        el('button.btn.btn-ghost', { onclick: () => close(true) }, '다시 보지 않기'),
        el('button.btn.btn-primary', { onclick: () => close(false) }, '닫기'),
      ),
    );
    const backdrop = mount(card, () => close(false));
  });
}

interface TextOpts {
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
}

/** 여러 줄 텍스트 입력 — 확정 시 입력값, 취소·빈 값은 null */
export function askText(opts: TextOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const close = (value: string | null) => {
      backdrop.remove();
      if (value === null) playSfx('close');
      resolve(value);
    };
    const input = el<'textarea'>('textarea.dialog-input', { placeholder: opts.placeholder ?? '' });
    const card = el('div.dialog', {},
      el('div.dialog-title', {}, opts.title),
      opts.message ? el('div.dialog-message', {}, opts.message) : null,
      input,
      el('div.dialog-actions', {},
        el('button.btn.btn-ghost', { onclick: () => close(null) }, '취소'),
        el('button.btn.btn-primary', {
          onclick: () => {
            const value = input.value.trim();
            close(value.length > 0 ? value : null);
          },
        }, opts.confirmLabel ?? '확인'),
      ),
    );
    const backdrop = mount(card, () => close(null));
    input.focus();
  });
}

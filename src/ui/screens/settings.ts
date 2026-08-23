/**
 * 설정 — 효과음, 확률 정보(등급별 — 추후 관리자 페이지로 대체 예정), 세이브 관리.
 * 캠프에 섞여 있던 설정을 분리해 캠프는 "성장·제작"에 집중시킨다.
 */
import { exportSave, importSave } from '../../state/save';
import { resetSave, save, toggleSound } from '../../state/store';
import { askConfirm, askText } from '../dialog';
import { el, toast } from '../kit';
import { overlay } from '../router';
import { playSfx } from '../sfx';

export function renderSettings(): HTMLElement {
  const state = save();

  return el('div.screen', {},
    el('h2.section-title', {}, '게임'),
    el('div.card', {},
      el('div.list-row', {},
        el('span', {}, '효과음'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            toggleSound();
            // 켠 직후에만 확인음 (끄면 즉시 무음이 곧 피드백)
            if (save().settings.sound) playSfx('tap');
          },
        }, state.settings.sound ? '🔊 켬' : '🔇 끔'),
      ),
      el('div.list-row', {},
        el('span', {}, '확률 정보'),
        el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'odds' }) }, '보기'),
      ),
    ),

    el('h2.section-title', {}, '세이브'),
    el('div.card', {},
      el('div.list-row', {},
        el('span', {}, '세이브 내보내기'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            void navigator.clipboard?.writeText(exportSave(save())).then(
              () => toast('세이브를 클립보드에 복사했습니다', 'ok'),
              () => toast('클립보드 복사 실패', 'error'),
            );
          },
        }, '복사'),
      ),
      el('div.list-row', {},
        el('span', {}, '세이브 가져오기'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            void askText({
              title: '세이브 가져오기',
              message: '내보내기로 복사한 세이브 JSON을 붙여넣으세요. 현재 진행은 덮어써집니다.',
              placeholder: '{"version":1,…}',
              confirmLabel: '불러오기',
            }).then((text) => {
              if (!text) return;
              const imported = importSave(text);
              if (imported) {
                save.set(imported);
                toast('세이브를 불러왔습니다', 'ok');
              } else {
                toast('올바른 세이브가 아닙니다', 'error');
              }
            });
          },
        }, '붙여넣기'),
      ),
      el('div.list-row', {},
        el('span.muted', {}, '처음부터 (되돌릴 수 없음)'),
        el('button.btn.btn-danger', {
          onclick: () => {
            void askConfirm({
              title: '새 게임',
              message: '정말 새 게임을 시작할까요? 현재 진행이 사라집니다.',
              confirmLabel: '초기화',
              danger: true,
            }).then((ok) => { if (ok) resetSave(); });
          },
        }, '초기화'),
      ),
    ),
  );
}

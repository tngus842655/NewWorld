/**
 * 설정 — 효과음, 확률 정보(등급별 — 추후 관리자 페이지로 대체 예정), 세이브 관리.
 * 캠프에 섞여 있던 설정을 분리해 캠프는 "성장·제작"에 집중시킨다.
 */
import { cloudSession, lastUploadedAt, restoreFromCloud, signInWithGoogle, signOutGoogle, uploadNow } from '../../state/cloud';
import { exportSave, importSave } from '../../state/save';
import { resetSave, save, setNickname, toggleSound } from '../../state/store';
import { askConfirm, askText } from '../dialog';
import { el, toast } from '../kit';
import { openRankingBoard } from '../rankingSheets';
import { overlay } from '../router';
import { playSfx } from '../sfx';

// 이 번들이 브라우저에 로드된 시각 — 옛 번들을 실행 중인 창을 판별하는 용도 (새로고침 시 갱신)
const CODE_LOADED_AT = new Date();

// 구글 공식 'G' 로고 (4색, 브랜딩 가이드 SVG) — 로그인 버튼·계정 행 공용
const GOOGLE_G_SVG =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">'
  + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
  + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
  + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
  + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
  + '</svg>';

function googleG(cls: 'google-g' | 'google-g-sm'): HTMLElement {
  return el(`span.${cls}`, { html: GOOGLE_G_SVG });
}

export function renderSettings(): HTMLElement {
  const state = save();

  return el('div.screen', {},
    el('h2.section-title', {}, '게임'),
    el('div.card', {},
      el('div.list-row', {},
        el('span', {}, `👤 닉네임 [${state.profile.nickname}]`),
        el('button.btn.btn-ghost', {
          onclick: () => {
            void askText({
              title: '닉네임 변경',
              message: '랭킹에 표시될 이름 (2~12자)',
              placeholder: state.profile.nickname,
              confirmLabel: '변경',
            }).then((text) => { if (text) setNickname(text); });
          },
        }, '변경'),
      ),
      // 랭킹 — 앱바 🏆에서 이동 (2026-08-29 사용자, 스토어 출시 전 일반 공개 여부 미정이라 설정으로 숨김)
      el('div.list-row', {},
        el('span', {}, '🏆 랭킹'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            openRankingBoard();
            overlay.set({ kind: 'ranking' });
          },
        }, '보기'),
      ),
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
      el('div.list-row', {},
        el('span', {}, '속성 정보'),
        el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'elementInfo' }) }, '보기'),
      ),
      // 전체 데이터 뷰 2종 — 추후 관리자 전용 메뉴로 전환 예정 (관리자 페이지 대체 전 임시 진입점)
      el('div.list-row', {},
        el('span', {}, '몬스터 정보'),
        el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'monsterInfo' }) }, '보기'),
      ),
      el('div.list-row', {},
        el('span', {}, '유물 정보'),
        el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'artifactInfo' }) }, '보기'),
      ),
    ),

    // 계정 — 구글 로그인 + 클라우드 세이브 (ROADMAP M5, 2026-08-29). 로그인은 선택: 없어도 완전 오프라인 동작
    el('h2.section-title', {}, '계정'),
    el('div.card', {},
      ...((): (HTMLElement | null)[] => {
        const session = cloudSession();
        if (!session) {
          return [
            el('div.muted.small', {}, '구글로 로그인하면 세이브가 클라우드에 자동 백업되고, 기기를 바꿔도 이어서 할 수 있습니다.'),
            // 구글 브랜딩 가이드의 밝은 버튼 — 공식 G 로고 + "Google로 계속하기" (2026-08-29 사용자)
            el('button.google-btn', {
              onclick: () => { playSfx('tap'); void signInWithGoogle(); },
            }, googleG('google-g'), 'Google로 계속하기'),
          ];
        }
        const uploaded = lastUploadedAt();
        return [
          el('div.list-row', {},
            el('span.account-email', {}, googleG('google-g-sm'), session.user.email ?? '구글 계정'),
            el('button.btn.btn-ghost.btn-sm', { onclick: () => void signOutGoogle() }, '로그아웃'),
          ),
          el('div.list-row', {},
            el('span.muted.small', {},
              uploaded ? `☁️ 마지막 백업 ${new Date(uploaded).toLocaleTimeString('ko-KR')}` : '☁️ 자동 백업 대기 중'),
            el('div.row-gap', {},
              el('button.btn.btn-ghost.btn-sm', {
                onclick: () => {
                  void uploadNow().then((ok) =>
                    toast(ok ? '☁️ 클라우드에 백업했습니다' : '백업 실패 — 연결을 확인해 주세요', ok ? 'ok' : 'error'));
                },
              }, '지금 백업'),
              el('button.btn.btn-ghost.btn-sm', { onclick: () => void restoreFromCloud() }, '불러오기'),
            ),
          ),
        ];
      })(),
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
    el('div.center.small.muted', {},
      `코드 로드 ${CODE_LOADED_AT.toLocaleTimeString('ko-KR')} · 세이브 v${state.version}`),
  );
}

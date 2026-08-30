/**
 * 설정 — 효과음, 확률 정보(등급별 — 추후 관리자 페이지로 대체 예정), 세이브 관리.
 * 캠프에 섞여 있던 설정을 분리해 캠프는 "성장·제작"에 집중시킨다.
 */
import { cloudSession, isAdmin, signInWithGoogle, signOutGoogle } from '../../state/cloud';
import { deleteAccount, lastUploadedAt, restoreFromCloud, uploadNow } from '../../state/cloudSync';
import { NIGHT_END_HOUR, NIGHT_START_HOUR } from '../../platform/returnAlarms';
import { redeemCoupon } from '../../state/coupon';
import { save, setNickname, toggleNightAlarms, toggleSound } from '../../state/store';
import { googleG } from '../components';
import { askConfirm, askText } from '../dialog';
import { el, toast } from '../kit';
import { openRankingBoard } from '../rankingSheets';
import { overlay } from '../router';
import { playSfx } from '../sfx';

// 이 번들이 브라우저에 로드된 시각 — 옛 번들을 실행 중인 창을 판별하는 용도 (새로고침 시 갱신)
const CODE_LOADED_AT = new Date();

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
      // 야간 귀환 알림 (검토 목록 ③) — 끔(기본)이면 21~08시 도착 알림은 울리지 않는다
      el('div.list-row', {},
        el('span', {}, `야간 알림 (${NIGHT_START_HOUR}~${String(NIGHT_END_HOUR).padStart(2, '0')}시)`),
        el('button.btn.btn-ghost', {
          onclick: () => {
            toggleNightAlarms();
            playSfx('tap');
          },
        }, state.settings.nightAlarms ? '🌙 켬' : '🔕 끔'),
      ),
      // 쿠폰 (검토 ⑦) — 판정은 서버가 원자적으로, 지급은 응답 goods를 검증 후 로컬 세이브에
      el('div.list-row', {},
        el('span', {}, '🎟️ 쿠폰'),
        el('button.btn.btn-ghost', {
          onclick: () => {
            void askText({
              title: '쿠폰 입력',
              message: '쿠폰 번호를 입력하세요 (영문·숫자·하이픈)',
              placeholder: 'WELCOME-300',
              confirmLabel: '사용',
            }).then(async (text) => {
              if (!text) return;
              const result = await redeemCoupon(text);
              toast(result.message, result.ok ? 'ok' : 'error');
              if (result.ok) playSfx('tap');
            });
          },
        }, '입력'),
      ),
      el('div.list-row', {},
        el('span', {}, '확률 정보'),
        el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'odds' }) }, '보기'),
      ),
      el('div.list-row', {},
        el('span', {}, '속성 정보'),
        el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'elementInfo' }) }, '보기'),
      ),
      // 전체 데이터 뷰 2종 — 관리자 전용 (검토 ④, 2026-08-30). 확률 정보는 확률형 아이템
      // 고지 의무(유료 뽑기)라 유저 공개 유지. isAdmin은 UI 노출 가드일 뿐 — 민감 동작 아님
      ...(isAdmin() ? [
        el('div.list-row', {},
          el('span', {}, '🛠️ 몬스터 정보'),
          el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'monsterInfo' }) }, '보기'),
        ),
        el('div.list-row', {},
          el('span', {}, '🛠️ 유물 정보'),
          el('button.btn.btn-ghost', { onclick: () => overlay.set({ kind: 'artifactInfo' }) }, '보기'),
        ),
      ] : []),
      // 약관·방침 — 게이트와 같은 공개 페이지로 (해시 라우팅, main.ts)
      el('div.list-row', {},
        el('span', {}, '약관·개인정보처리방침'),
        el('div.row-gap', {},
          el('button.btn.btn-ghost.btn-sm', { onclick: () => { window.location.hash = '#/terms'; } }, '약관'),
          el('button.btn.btn-ghost.btn-sm', { onclick: () => { window.location.hash = '#/privacy'; } }, '방침'),
        ),
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
            el('button.btn.btn-ghost.btn-sm', {
              // 회원 전용 정책 (2026-08-29) — 로그아웃하면 로그인 게이트로 돌아간다
              onclick: () => {
                void askConfirm({
                  title: '로그아웃',
                  message: '로그아웃하면 로그인 화면으로 돌아갑니다.\n세이브는 이 기기와 클라우드에 안전하게 남습니다.',
                  confirmLabel: '로그아웃',
                }).then((ok) => { if (ok) void signOutGoogle(); });
              },
            }, '로그아웃'),
          ),
          el('div.list-row', {},
            // 시각은 시:분까지만 — 초까지 쓰면 버튼이 줄바꿈으로 밀려 내려온다 (2026-08-29 사용자)
            el('span.muted.small.cloud-stamp', {},
              uploaded
                ? `☁️ ${new Date(uploaded).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 저장됨`
                : '☁️ 자동 저장 대기'),
            el('div.row-gap.nowrap', {},
              el('button.btn.btn-ghost.btn-sm', {
                onclick: () => {
                  void uploadNow().then((ok) =>
                    toast(ok ? '☁️ 클라우드에 저장했습니다' : '저장 실패 — 연결을 확인해 주세요', ok ? 'ok' : 'error'));
                },
              }, '저장'),
              el('button.btn.btn-ghost.btn-sm', { onclick: () => void restoreFromCloud() }, '불러오기'),
            ),
          ),
          // 회원 탈퇴 (Google Play 계정 삭제 요건) — "탈퇴" 입력을 요구하는 이중 확인
          el('div.list-row', {},
            el('span.muted.small', {}, '회원 탈퇴 — 계정·게임 데이터 영구 삭제'),
            el('button.btn.btn-danger.btn-sm', {
              onclick: () => {
                void askText({
                  title: '회원 탈퇴',
                  message: '계정과 게임 데이터(클라우드·이 기기 세이브·랭킹)가 모두 삭제되며 복구할 수 없습니다.\n계속하려면 "탈퇴할게요"라고 입력하세요.',
                  placeholder: '탈퇴할게요',
                  confirmLabel: '영구 삭제',
                }).then(async (text) => {
                  if (text === null) return;
                  if (text.trim() !== '탈퇴할게요') {
                    toast('"탈퇴할게요"라고 정확히 입력해야 합니다', 'error');
                    return;
                  }
                  const ok = await deleteAccount();
                  if (!ok) toast('탈퇴 처리에 실패했습니다 — 연결을 확인해 주세요', 'error');
                  // 성공 시 로그아웃 이벤트가 게이트로 새로고침한다
                });
              },
            }, '탈퇴'),
          ),
        ];
      })(),
    ),

    // 세이브 섹션은 2026-08-29 통째로 제거 — 내보내기/가져오기는 클라우드 세이브(구글 로그인)가
    // 기기 이동을 대체한 잔재(가져오기는 랭킹 신원 교체 사고 벡터 — 같은 날 랭킹 잔존 사고),
    // 초기화는 탈퇴가 사실상 대체(계정·클라우드·로컬 전부 삭제 후 새 출발)
    el('div.center.small.muted', {},
      `코드 로드 ${CODE_LOADED_AT.toLocaleTimeString('ko-KR')} · 세이브 v${state.version}`),
  );
}

/**
 * 엔트리 포인트 — 콘텐츠는 import 시점에 검증되고, 세이브 로드는 store가 담당한다.
 * store 계열은 동적 import: 세이브 로드 실패(구버전 번들·손상)를 잡아 새 게임으로 덮지 않고
 * 안내 화면을 띄우기 위함 (2026-08-23 — save.ts loadSave 참고).
 */
import './styles.css';

const app = document.getElementById('app');

async function boot(): Promise<void> {
  if (!app) return;
  try {
    // 약관·개인정보처리방침 — 로그인 이전에도 접근 가능한 공개 페이지 (스토어 등록 URL 겸용)
    const legalPage = window.location.hash === '#/terms' ? 'terms' : window.location.hash === '#/privacy' ? 'privacy' : null;
    if (legalPage) {
      const { renderLegal } = await import('./ui/legal');
      renderLegal(app, legalPage);
      return;
    }

    // 앱 업데이트 안내 (네이티브 전용, 게이트·게임 공통) — 새 버전이 스토어에 있으면 팝업
    void import('./platform/appUpdate').then(({ initAppUpdatePrompt }) => initAppUpdatePrompt()).catch(() => undefined);

    // 회원 전용 (2026-08-29 사용자) — 세션 없으면 로그인 게이트에서 멈춘다.
    // 게이트 경로에서는 store를 로딩하지 않는다: store는 로드 즉시 세이브를 생성·저장하므로
    // 탈퇴 직후의 빈 localStorage에 유령 세이브가 되살아난다 (2026-08-29 실사고).
    // 로그인은 리디렉션 왕복이라 성공하면 어차피 새 페이지로 여기를 다시 지난다.
    // DEV 한정 ?dev-guest 우회 — 로그인 없는 브라우저 자동 검증용 (프로드 번들에서는 제거됨)
    const { initAuth, banInfo } = await import('./state/cloud');
    const session = await initAuth();
    const devGuest = import.meta.env.DEV && new URLSearchParams(location.search).has('dev-guest');
    if (!session && !devGuest) {
      const { renderGate } = await import('./ui/gate');
      renderGate(app);
      return;
    }

    const [{ save }, { mountApp }, { effect }, { preloadAllSfx, setSfxEnabled }, { initCloudSync }] = await Promise.all([
      import('./state/store'),
      import('./ui/app'),
      import('./state/signal'),
      import('./ui/sfx'),
      import('./state/cloudSync'),
    ]);
    mountApp(app);
    // 이용 제한 (검토 ⑥) — 조회는 비동기(오프라인에도 게임은 돈다), 잡히는 즉시 안내 화면으로 교체.
    // 실효 강제는 서버 몫 (saves RLS·submit-score) — 이 화면은 사유·기간 안내다
    effect(() => {
      const ban = banInfo();
      if (ban) void import('./ui/gate').then(({ renderBanned }) => renderBanned(app, ban));
    });
    // 효과음: 설정 미러 + 첫 제스처(자동재생 정책 통과 시점)에 전량 프리로드
    effect(() => setSfxEnabled(save().settings.sound));
    document.addEventListener('pointerdown', () => preloadAllSfx(), { once: true });
    // 클라우드 세이브 동기화 — 로그인 화해 + 자동 업로드 (게임 경로 전용)
    initCloudSync();
    // 귀환 로컬 알림 (네이티브 전용 — 웹에서는 무동작). 실패해도 게임은 그대로 돈다
    void import('./platform/returnAlarms').then(({ initReturnAlarms }) => initReturnAlarms()).catch(() => undefined);
    // 실결제 (네이티브 전용) — 광고 제거 상품 조회·소유 복원
    void import('./platform/iap').then(({ initIap }) => initIap()).catch(() => undefined);
  } catch (err) {
    const box = document.createElement('div');
    box.className = 'boot-error';
    const title = document.createElement('h2');
    title.textContent = '⚠️ 실행할 수 없습니다';
    const message = document.createElement('p');
    message.textContent = err instanceof Error ? err.message : String(err);
    const reload = document.createElement('button');
    reload.className = 'btn btn-primary';
    reload.textContent = '새로고침';
    reload.onclick = () => location.reload();
    box.append(title, message, reload);
    app.replaceChildren(box);
  }
}

// 해시 전환(게이트↔약관 등)은 재부팅으로 처리 — SPA 라우터 없이 페이지 3장을 감당하는 최소 장치
window.addEventListener('hashchange', () => window.location.reload());

void boot();

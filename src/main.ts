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
    const [{ save }, { mountApp }, { effect }, { preloadAllSfx, setSfxEnabled }] = await Promise.all([
      import('./state/store'),
      import('./ui/app'),
      import('./state/signal'),
      import('./ui/sfx'),
    ]);
    mountApp(app);
    // 효과음: 설정 미러 + 첫 제스처(자동재생 정책 통과 시점)에 전량 프리로드
    effect(() => setSfxEnabled(save().settings.sound));
    document.addEventListener('pointerdown', () => preloadAllSfx(), { once: true });
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

void boot();

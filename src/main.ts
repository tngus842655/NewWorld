/**
 * 엔트리 포인트 — 콘텐츠는 import 시점에 검증되고, 세이브 로드는 store가 담당한다.
 */
import './styles.css';
import { effect } from './state/signal';
import { save } from './state/store';
import { mountApp } from './ui/app';
import { preloadAllSfx, setSfxEnabled } from './ui/sfx';

const app = document.getElementById('app');
if (app) mountApp(app);

// 효과음: 설정 미러 + 첫 제스처(자동재생 정책 통과 시점)에 전량 프리로드
effect(() => setSfxEnabled(save().settings.sound));
document.addEventListener('pointerdown', () => preloadAllSfx(), { once: true });

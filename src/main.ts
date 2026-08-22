/**
 * 엔트리 포인트 — 콘텐츠는 import 시점에 검증되고, 세이브 로드는 store가 담당한다.
 */
import './styles.css';
import { mountApp } from './ui/app';

const app = document.getElementById('app');
if (app) mountApp(app);

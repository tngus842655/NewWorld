/**
 * 로컬 영속화 — localStorage + 마이그레이션. 클라우드 동기화는 M4.
 */
import type { SaveState } from '../core/types';
import { migrateSave } from './migrations';

export const SAVE_KEY = 'newworld-save-v1';

export function loadSave(): SaveState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return migrateSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistSave(state: SaveState, at: number): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...state, lastSavedAt: at }));
  } catch {
    // 저장 실패(용량 등)는 게임을 멈출 사유가 아니다 — M4에서 리포팅 연결
  }
}

export function exportSave(state: SaveState): string {
  return JSON.stringify(state);
}

export function importSave(text: string): SaveState | null {
  try {
    return migrateSave(JSON.parse(text));
  } catch {
    return null;
  }
}

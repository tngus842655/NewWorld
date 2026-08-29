/**
 * 로컬 영속화 — localStorage + 마이그레이션. 클라우드 동기화는 cloudSync.ts (M5).
 * 내보내기/가져오기(클립보드 JSON)는 2026-08-29 제거 — 클라우드 세이브가 기기 이동을 대체.
 */
import type { SaveState } from '../core/types';
import { migrateSave } from './migrations';

export const SAVE_KEY = 'newworld-save-v1';
export const RESCUE_KEY = `${SAVE_KEY}.rescue`;

/**
 * null = 세이브 없음 (새 게임 시작이 맞다).
 * 세이브가 **있는데** 읽지 못하면(미래 버전 = 흔히 스테일 번들, 또는 손상) 절대 null을 돌려주지 않는다 —
 * 새 게임이 persist로 원본을 덮어쓰는 사고(2026-08-23 실제 발생)를 막기 위해 원본을 구조 슬롯에 보존하고 throw.
 * main.ts가 잡아서 안내 화면을 띄운다. 정상 번들로 새로고침하면 원본 그대로 이어진다.
 */
export function loadSave(): SaveState | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  let state: SaveState | null = null;
  try {
    state = migrateSave(JSON.parse(raw));
  } catch {
    state = null;
  }
  if (state) return state;
  try {
    localStorage.setItem(RESCUE_KEY, raw);
  } catch { /* 구조 백업 실패해도 원본(SAVE_KEY)은 건드리지 않았다 */ }
  throw new Error('세이브를 읽을 수 없습니다 — 구버전 코드이거나 데이터 손상입니다. 원본은 보존했습니다. 새로고침해 주세요.');
}

export function persistSave(state: SaveState, at: number): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...state, lastSavedAt: at }));
  } catch {
    // 저장 실패(용량 등)는 게임을 멈출 사유가 아니다 — M4에서 리포팅 연결
  }
}

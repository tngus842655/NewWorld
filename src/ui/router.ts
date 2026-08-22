/**
 * 라우팅 — 하단 탭 4개 + 오버레이 스택 1층 (M2 범위).
 */
import type { Journal } from '../core/types';
import { signal } from '../state/signal';

export type Tab = 'home' | 'expedition' | 'codex' | 'camp';

export type Overlay =
  | { kind: 'journal'; journal: Journal; newMilestones: string[] }
  | { kind: 'monster'; uid: string }
  | { kind: 'artifact'; uid: string }
  | { kind: 'crossroads'; expeditionId: string }
  | null;

export const tab = signal<Tab>('home');
export const overlay = signal<Overlay>(null);

export function closeOverlay(): void {
  overlay.set(null);
}

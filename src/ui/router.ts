/**
 * 라우팅 — 하단 탭 4개 + 오버레이 스택 1층 (M2 범위).
 */
import type { Journal } from '../core/types';
import { signal } from '../state/signal';

export type Tab = 'home' | 'expedition' | 'codex' | 'camp' | 'settings';

export type Overlay =
  | { kind: 'journal'; journal: Journal; newMilestones: string[] }
  | { kind: 'monster'; monsterId: string } // 종 단위 (2026-08-23)
  | { kind: 'artifact'; uid: string }
  | { kind: 'crossroads'; expeditionId: string }
  | { kind: 'species'; monsterId: string } // 도감 종 정보 (성장 액션 없음 — 캠프 상세와 목적 분리)
  | { kind: 'help' }                       // 재화 안내
  | { kind: 'fusion' }                     // 카드 합성 (GDD §4.5)
  | { kind: 'artifactFusion' }             // 유물 합성 (GDD §4.5 — 카드 합성과 동일 규칙)
  | { kind: 'partyPick' }                  // 원정 파티 슬롯 선택 팝업
  | { kind: 'artifactPick' }               // 원정 유물 슬롯 선택 팝업
  | { kind: 'odds' }                       // 확률 정보 (등급별 — 추후 관리자 페이지로 대체 예정)
  | { kind: 'elementInfo' }                // 속성 정보 (상성 구조·배수·지역별 유불리 — 유저 공개)
  | { kind: 'monsterInfo' }                // 전체 몬스터 데이터 뷰 (추후 관리자 전용)
  | { kind: 'artifactInfo' }               // 전체 유물 데이터 뷰 (추후 관리자 전용)
  | null;

export const tab = signal<Tab>('home');
export const overlay = signal<Overlay>(null);

export function closeOverlay(): void {
  overlay.set(null);
}

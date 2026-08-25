/**
 * 라우팅 — 하단 탭 4개 + 오버레이 스택 1층 (M2 범위).
 */
import type { Journal } from '../core/types';
import { signal } from '../state/signal';

export type Tab = 'home' | 'expedition' | 'codex' | 'camp' | 'settings';

export type Overlay =
  | { kind: 'journal'; journal: Journal; newMilestones: string[] }
  | { kind: 'journalDetail'; expeditionId: string } // 최근 일지 재열람 — journalArchive에서 조회
  | { kind: 'accelerate'; expeditionId: string }   // 원정 가속 — 모래시계 사용 팝업

  | { kind: 'monster'; monsterId: string } // 종 단위 (2026-08-23)
  | { kind: 'artifact'; itemId: string } // 종 단위 (v6, 2026-08-23)
  | { kind: 'crossroads'; expeditionId: string }
  | { kind: 'species'; monsterId: string } // 도감 종 정보 (성장 액션 없음 — 캠프 상세와 목적 분리)
  | { kind: 'ranking' }                    // 랭킹 — 내 점수 + 리더보드 (GDD §9.3)
  | { kind: 'shop' }                       // 상점 — 골드/다이아 (GDD §9.4)
  | { kind: 'attendance' }                 // 월간 출석 달력 (v8 — 다이아 획득처)
  | { kind: 'tasks' }                      // 반복 과업 진행 현황
  | { kind: 'fusion' }                     // 카드 합성 (GDD §4.5)
  | { kind: 'artifactFusion' }             // 유물 합성 (GDD §4.5 — 카드 합성과 동일 규칙)
  | { kind: 'teamEdit'; teamId: string }   // 군 편성 시트 (2026-08-23 군 시스템)
  | { kind: 'accountBonus' }               // 영구 보너스 — 조련·공명 계단 (GDD §4.6)
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

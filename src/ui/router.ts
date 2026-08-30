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
  | { kind: 'recharge' }                   // 다이아 충전 — 실결제 전용 화면 (다이아관 '충전' 버튼, 닫으면 상점 복귀)
  | { kind: 'attendance' }                 // 월간 출석 달력 (v8 — 다이아 획득처)
  | { kind: 'tasks' }                      // 반복 과업 진행 현황
  | { kind: 'fusion' }                     // 카드 합성 (GDD §4.5)
  | { kind: 'artifactFusion' }             // 유물 합성 (GDD §4.5 — 카드 합성과 동일 규칙)
  | { kind: 'teamEdit'; teamId: string }   // 군 편성 시트 (2026-08-23 군 시스템)
  | { kind: 'accountBonus' }               // 영구 보너스 — 조련·공명 계단 (GDD §4.6)
  | { kind: 'map' }                        // 원정 지도 — 여정 시각화 전용 뷰 (앱바 🗺️ 진입, 2026-08-27)
  | { kind: 'odds' }                       // 확률 정보 (등급별 — 추후 관리자 페이지로 대체 예정)
  | { kind: 'elementInfo' }                // 속성 정보 (상성 구조·배수·지역별 유불리 — 유저 공개)
  | { kind: 'releaseNotes' }               // 업데이트 내역 — 파일 관리형 (검토 ⑧, content/releaseNotes.ts)
  | { kind: 'feedback' }                   // 문의하기 — 비공개 1:1 건의·버그 제보 (검토 ⑩)
  | { kind: 'monsterInfo' }                // 전체 몬스터 데이터 뷰 (추후 관리자 전용)
  | { kind: 'artifactInfo' }               // 전체 유물 데이터 뷰 (추후 관리자 전용)
  | null;

export const tab = signal<Tab>('home');
export const overlay = signal<Overlay>(null);

export function closeOverlay(): void {
  overlay.set(null);
}

// ── 해시 페이지에서 돌아올 탭 (2026-08-30 사용자) ──────────────────────────────
// 약관·방침(#/terms, #/privacy)은 새 페이지가 아니라 같은 문서의 해시 전환이고,
// main.ts가 해시 전환을 새로고침으로 처리하므로 tab 시그널이 통째로 날아간다.
// 그래서 설정에서 약관을 열었다가 돌아오면 언제나 홈에서 시작했다.
// sessionStorage에 1회용으로 남겼다가 부팅 때 소비한다 — 앱을 껐다 켜면 세션이 새로 시작하므로
// 엉뚱한 탭에서 시작할 일이 없고, 브라우저 뒤로가기·화면 안의 '돌아가기' 둘 다 같은 부팅 경로를 탄다.
const RETURN_TAB_KEY = 'nw:returnTab';
const TAB_IDS: readonly Tab[] = ['home', 'expedition', 'codex', 'camp', 'settings'];

export function rememberTab(current: Tab): void {
  // 프라이빗 모드 등 저장소가 막힌 환경 — 홈에서 시작할 뿐이라 조용히 넘긴다
  try { sessionStorage.setItem(RETURN_TAB_KEY, current); } catch { /* 무시 */ }
}

/** 저장된 복귀 탭을 읽고 즉시 지운다 (1회용) */
export function consumeReturnTab(): Tab | null {
  try {
    const saved = sessionStorage.getItem(RETURN_TAB_KEY);
    sessionStorage.removeItem(RETURN_TAB_KEY);
    return TAB_IDS.find((t) => t === saved) ?? null;
  } catch {
    return null;
  }
}

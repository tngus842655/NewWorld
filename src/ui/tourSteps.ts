/**
 * 온보딩 투어 — 단계 정의 (GDD §11.2, 2026-08-30). 순수부: DOM 없음, 테스트 대상.
 * 진행 판정은 상태 술어로 파생한다 — "첫 미완료 단계"가 현재 단계. 스텝 카운터를 저장하지
 * 않으므로 재시작·이탈(시트 닫기 등)에도 자연 복구된다. 일회성 사실만 profile.flags.tour*.
 * 렌더·차단은 ui/tour.ts (DOM부)가 담당한다.
 */
import type { SaveState } from '../core/types';

export interface TourUi {
  tab: string; // 현재 하단 탭 (home/expedition/camp/codex/settings)
  overlayKind: string | null; // 열려 있는 오버레이 kind (router)
}

export interface TourStep {
  id: string;
  /** data-tour 대상 — 없으면 중앙 카드 스텝 */
  target?: string;
  text: string;
  /** 카드 스텝의 진행 버튼 라벨 — 누르면 setFlag 기록 */
  button?: string;
  /** 카드 버튼 또는 observe 관찰로 기록할 플래그 이름 */
  setFlag?: string;
  /** 이 조건이 관찰되면 setFlag를 기록한다 (예: 지도 오버레이 열림) */
  observe?: (state: SaveState, ui: TourUi) => boolean;
  /** 대상이 화면에 없거나 비활성일 때 보여줄 대기 카드 (예: 귀환 대기) */
  waitText?: string;
  /** 대상이 시트(오버레이) 안에 있다 — 오버레이가 열려도 투어를 숨기지 않는다 */
  inOverlay?: boolean;
  done: (state: SaveState, ui: TourUi) => boolean;
}

const flag = (state: SaveState, name: string): boolean => state.profile.flags[name] === true;
const dispatched = (state: SaveState): boolean =>
  state.expeditions.length > 0 || Object.values(state.stats.expeditions).some((n) => n > 0);
const leveled = (state: SaveState): boolean => state.roster.some((m) => m.level > 1 || m.star > 1);
const claimed = (state: SaveState): boolean => state.journalArchive.length > 0;
const attended = (state: SaveState): boolean => state.attendance.days.length > 0;

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'intro',
    text: '신대륙에 오신 걸 환영합니다, 개척자님!\n첫 원정대를 함께 꾸려볼까요?',
    button: '시작하기',
    setFlag: 'tourIntro',
    done: (s) => flag(s, 'tourIntro'),
  },
  {
    id: 'go-expedition',
    target: 'go-expedition',
    text: '먼저 원정을 보내볼게요.\n이 버튼을 눌러주세요.',
    done: (s, ui) => ui.tab === 'expedition' || dispatched(s),
  },
  {
    id: 'dispatch',
    target: 'dispatch',
    text: '물안개 해안으로 첫 정찰을 보냅니다.\n첫 원정은 30초 만에 돌아와요!',
    done: (s) => dispatched(s),
  },
  {
    id: 'home-for-map',
    target: 'tab-home',
    text: '홈으로 돌아가 볼까요?',
    done: (s, ui) => ui.tab === 'home' || flag(s, 'tourMap'),
  },
  {
    id: 'map',
    target: 'map',
    text: '지도에서 원정대의 여정을\n실시간으로 볼 수 있어요.',
    setFlag: 'tourMap',
    observe: (_s, ui) => ui.overlayKind === 'map',
    done: (s) => flag(s, 'tourMap'),
  },
  {
    id: 'tab-camp',
    target: 'tab-camp',
    text: '기다리는 동안 캠프를 둘러봐요.',
    done: (s, ui) => ui.tab === 'camp' || leveled(s),
  },
  {
    id: 'camp-monster',
    target: 'camp-monster',
    text: '몬스터를 눌러 상세를 열어보세요.',
    done: (s, ui) => ui.overlayKind === 'monster' || leveled(s),
  },
  {
    id: 'levelup',
    target: 'levelup',
    inOverlay: true,
    text: '골드로 레벨업! 전투력이 오릅니다.',
    done: (s) => leveled(s),
  },
  {
    id: 'tab-codex',
    target: 'tab-codex',
    text: '이번엔 도감을 볼까요?',
    done: (s, ui) => ui.tab === 'codex' || flag(s, 'tourCodex'),
  },
  {
    id: 'codex-info',
    text: '잡은 몬스터가 모두 여기 모입니다.\n도감을 채우면 새 지역이 열려요!',
    button: '다음',
    setFlag: 'tourCodex',
    done: (s) => flag(s, 'tourCodex'),
  },
  {
    id: 'home-for-journal',
    target: 'tab-home',
    text: '원정대가 돌아올 시간이에요.\n홈으로 가볼까요?',
    done: (s, ui) => ui.tab === 'home' || claimed(s),
  },
  {
    id: 'journal',
    target: 'journal',
    waitText: '원정대가 돌아오는 중…\n잠시만 기다려주세요 (약 30초)',
    text: '원정대가 돌아왔어요!\n일지를 열어 결과를 확인하세요.',
    done: (s) => claimed(s),
  },
  {
    id: 'attendance',
    target: 'attendance',
    text: '마지막으로 출석 달력!\n매일 접속하면 보상을 드려요.',
    done: (s) => attended(s),
  },
  {
    id: 'finale',
    text: '준비 끝! 이제 신대륙은 개척자님의 것.\n깊은 지역일수록 강한 몬스터가 기다립니다.',
    button: '모험 시작!',
    setFlag: 'tourDone',
    done: (s) => flag(s, 'tourDone'),
  },
];

/** 투어 활성 여부 — 완료 전이며, (이미 시작했거나) 첫 정산 전 신규 계정 */
export function tourActive(state: SaveState): boolean {
  if (flag(state, 'tourDone')) return false;
  return flag(state, 'tourStarted') || !state.profile.tutorialDone;
}

/** 현재 단계 = 첫 미완료 단계. 전부 완료면 null (finale의 tourDone이 활성도 끈다) */
export function pickTourStep(state: SaveState, ui: TourUi): TourStep | null {
  return TOUR_STEPS.find((step) => !step.done(state, ui)) ?? null;
}

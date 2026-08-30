/**
 * 온보딩 투어 — DOM 엔진 (GDD §11.2, 2026-08-30). 단계 정의·판정은 tourSteps.ts (순수부).
 *
 * 구조: 딤 패널 4장(상/하/좌/우)이 화면을 덮고 대상 버튼 자리만 뚫는다 — 뚫린 곳만 눌린다.
 * 대상 추적은 rAF 루프에서 매 프레임 rect 재계산 (재렌더·스크롤·애니메이션 전부 추종).
 * 다른 오버레이(일지 연출·시트)가 열려 있고 대상이 그 안에 없으면 투어는 숨고 막지 않는다.
 * z: 시트(40) < 투어(50) < 다이얼로그(55) — 레벨업 스텝은 시트 위에 뜨고, 건너뛰기 확인은 투어 위에.
 */
import { save, setTourFlags } from '../state/store';
import { effect } from '../state/signal';
import { askConfirm } from './dialog';
import { el } from './kit';
import { overlay, tab } from './router';
import { playSfx } from './sfx';
import { TOUR_STEPS, pickTourStep, tourActive, type TourStep, type TourUi } from './tourSteps';

const PAD = 6; // 스포트라이트 구멍 여유

let root: HTMLElement | null = null;
let rafId = 0;
let currentStepId = ''; // 말풍선 재구성 최소화용

function ui(): TourUi {
  return { tab: tab(), overlayKind: overlay()?.kind ?? null };
}

/** 대상 요소 — 화면에 실제로 보이는 것만 (hidden 클래스·0크기 제외) */
function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const node = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  if (!node || node.classList.contains('hidden')) return null;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? node : null;
}

function buildRoot(): HTMLElement {
  const make = (cls: string) => el(`div.${cls}`, {});
  const node = el('div.tour-root', {},
    make('tour-shield tour-shield-top'),
    make('tour-shield tour-shield-bottom'),
    make('tour-shield tour-shield-left'),
    make('tour-shield tour-shield-right'),
    make('tour-ring'),
    el('div.tour-bubble', {}),
  );
  document.body.append(node);
  return node;
}

function skipButton(): HTMLElement {
  return el('button.tour-skip', {
    onclick: () => {
      void askConfirm({
        title: '가이드 건너뛰기',
        message: '언제든 직접 둘러보실 수 있어요.\n가이드를 건너뛸까요?',
        confirmLabel: '건너뛰기',
      }).then((ok) => { if (ok) setTourFlags({ tourDone: true }); });
    },
  }, '건너뛰기');
}

/** 중앙 카드 (intro·안내·대기·finale) — 구멍 없이 전체 딤 */
function renderCard(step: TourStep, waiting: boolean): void {
  if (!root) return;
  const [top, bottom, left, right] = shields();
  Object.assign(top.style, { inset: '0', width: '100%', height: '100%' });
  for (const shield of [bottom, left, right]) Object.assign(shield.style, { width: '0', height: '0' });
  ring().style.display = 'none';

  const stepKey = step.id + (waiting ? ':wait' : '');
  if (currentStepId === stepKey) return;
  currentStepId = stepKey;
  const bubble = bubbleEl();
  bubble.className = 'tour-bubble tour-card';
  bubble.replaceChildren(
    el('div.tour-text', {}, waiting ? step.waitText! : step.text),
    ...(!waiting && step.button
      ? [el('button.btn.btn-primary', {
          onclick: () => {
            playSfx('confirm');
            if (step.setFlag) setTourFlags({ [step.setFlag]: true });
          },
        }, step.button)]
      : []),
    skipButton(),
  );
  Object.assign(bubble.style, { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' });
}

/** 스포트라이트 — 대상 주위 4패널 + 링 + 말풍선 */
function renderSpotlight(step: TourStep, target: HTMLElement): void {
  if (!root) return;
  const rect = target.getBoundingClientRect();
  const x = rect.left - PAD;
  const y = rect.top - PAD;
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const [top, bottom, left, right] = shields();
  Object.assign(top.style, { inset: '', left: '0', top: '0', width: '100%', height: `${Math.max(0, y)}px` });
  Object.assign(bottom.style, { left: '0', top: `${y + h}px`, width: '100%', height: `${Math.max(0, vh - y - h)}px` });
  Object.assign(left.style, { left: '0', top: `${y}px`, width: `${Math.max(0, x)}px`, height: `${h}px` });
  Object.assign(right.style, { left: `${x + w}px`, top: `${y}px`, width: `${Math.max(0, vw - x - w)}px`, height: `${h}px` });

  const ringEl = ring();
  ringEl.style.display = '';
  Object.assign(ringEl.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });

  const bubble = bubbleEl();
  if (currentStepId !== step.id) {
    currentStepId = step.id;
    bubble.className = 'tour-bubble';
    bubble.replaceChildren(el('div.tour-text', {}, step.text), skipButton());
  }
  // 대상이 화면 위쪽이면 아래에, 아래쪽이면 위에
  const below = rect.top + rect.height / 2 < vh / 2;
  Object.assign(bubble.style, {
    left: '50%',
    transform: 'translateX(-50%)',
    top: below ? `${y + h + 12}px` : '',
    bottom: below ? '' : `${vh - y + 12}px`,
  });
}

const shields = (): [HTMLElement, HTMLElement, HTMLElement, HTMLElement] => {
  const list = root!.querySelectorAll<HTMLElement>('.tour-shield');
  return [list[0]!, list[1]!, list[2]!, list[3]!];
};
const ring = (): HTMLElement => root!.querySelector<HTMLElement>('.tour-ring')!;
const bubbleEl = (): HTMLElement => root!.querySelector<HTMLElement>('.tour-bubble')!;

/** 한 번의 평가+렌더 — 반환값: 투어가 계속 활성인가 */
function update(): boolean {
  const state = save();
  if (!tourActive(state)) {
    teardown();
    return false;
  }
  const context = ui();
  const step = pickTourStep(state, context);
  if (!step) {
    teardown();
    return false;
  }
  // 관찰 플래그 — 예: 지도 오버레이가 열리면 tourMap 기록
  if (step.observe && step.setFlag && state.profile.flags[step.setFlag] !== true && step.observe(state, context)) {
    setTourFlags({ [step.setFlag]: true });
  }

  // 다른 오버레이가 열려 있고 대상이 그 안이 아니면 — 숨고 막지 않는다 (일지 연출·시트 조작 자유)
  if (context.overlayKind !== null && !step.inOverlay) {
    if (root) root.style.display = 'none';
    return true;
  }

  if (!root) root = buildRoot();
  root.style.display = '';

  if (!step.target) {
    renderCard(step, false);
  } else {
    const target = findTarget(step);
    if (target) renderSpotlight(step, target);
    else if (step.waitText) renderCard(step, true);
    else root.style.display = 'none'; // 재렌더 틈 — 다음 갱신에 복구
  }
  return true;
}

/** rAF 루프 — 위치 추적 전용. 숨은 탭에서는 멈추지만 시그널 갱신(update 직접 호출)이 논리를 이끈다 */
function tick(): void {
  rafId = 0;
  if (update()) rafId = requestAnimationFrame(tick);
}

function teardown(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  root?.remove();
  root = null;
  currentStepId = '';
}

/** 게임 마운트 후 1회 (main.ts) — 신규 계정이면 투어 시작 */
export function initTour(): void {
  const state = save();
  if (!tourActive(state)) return;
  if (state.profile.flags['tourStarted'] !== true) setTourFlags({ tourStarted: true });
  // 시그널 변화(세이브·탭·오버레이)가 즉시 갱신을 이끌고, rAF는 프레임 단위 rect 추종만 맡는다
  // (rAF만 믿으면 숨은 탭·백그라운드 복귀에서 루프가 영영 안 돈다 — 2026-08-30 E2E에서 실증)
  effect(() => {
    save();
    tab();
    overlay();
    if (update() && !rafId) rafId = requestAnimationFrame(tick);
  });
  // 30초 귀환 대기(journal 스텝)처럼 시그널 없이 시간만으로 바뀌는 상태 대비 — 저빈도 보조 틱
  const interval = setInterval(() => {
    if (!update()) clearInterval(interval);
  }, 500);
}

/** 스텝 총수 — 진행 표기용 (finale 제외한 인덱스 계산은 UI 취향) */
export const TOUR_STEP_COUNT = TOUR_STEPS.length;

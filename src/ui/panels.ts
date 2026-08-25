/**
 * 목록 분할 공용 헬퍼 — 빅탭 / 칩 선택기 / 필터 칩 / 필터 구간 (2026-08-25).
 *
 * 확정된 가독성 규칙(모바일 375px 전제): 한두 화면을 넘으면 탭으로 나누고, 탭 안에서도 길면 칩으로 압축한다.
 * 원래 overlays.ts 안에만 있어 정보 시트 4곳에서만 쓰였다. 화면(캠프·도감)과 편성 시트도 쓰도록 리프 모듈로 뺀다.
 *
 * ── uncontrolled vs controlled ──
 * 기본(uncontrolled)은 DOM 클래스 토글만으로 동작한다 — 선택 상태를 어디에도 저장하지 않으므로
 * **재렌더되면 첫 항목으로 돌아간다.** 확률·몬스터정보·유물정보처럼 열려 있는 동안 save()가 바뀌지 않는
 * 읽기 전용 시트에서만 안전하다.
 *
 * 화면(app.ts의 effect가 save() 변경마다 통째로 다시 그린다)과 행동이 있는 시트에서는 반드시
 * `active`/`onPick`을 넘겨 controlled로 쓴다. 안 그러면 몬스터를 편성에 넣을 때마다 탭이 첫 탭으로 튕긴다.
 *
 * 이 모듈은 등급을 모른다 — 라벨과 색 클래스(cls)를 호출부가 주입한다. 등급이 늘어도 여기는 그대로다.
 */
import { el } from './kit';
import { playSfx } from './sfx';

export interface Panel<K extends string = string> {
  key: K;
  label: string;
  /** 라벨에 붙일 부가 클래스 — 등급색은 `rar-heroic` 처럼 (선행 점 없이) */
  cls?: string;
  view: HTMLElement;
}

export interface PanelOpts<K extends string> {
  /** 넘기면 controlled — 선택 상태는 호출부(시그널)가 들고, 클릭은 onPick으로만 알린다 */
  active?: K;
  onPick?: (key: K) => void;
  /** uncontrolled일 때의 초기 선택 인덱스 (기본 0) */
  initial?: number;
  /** 탭이 많아 한 줄에 안 들어갈 때 가로 스크롤 허용 */
  scroll?: boolean;
  /** 클릭 효과음 (기본 켬) */
  sfx?: boolean;
}

/** 한 노드는 한 헬퍼만 소유한다 — 같은 view를 두 헬퍼에 넘기면 .hidden 토글이 서로를 덮어쓴다. */
function panelGroup<K extends string>(
  items: Panel<K>[],
  opts: PanelOpts<K> | undefined,
  barClass: `div.${string}`,
  buttonClass: `button.${string}`,
): HTMLElement[] {
  const { active, onPick, initial = 0, scroll = false, sfx = true } = opts ?? {};
  const controlled = active !== undefined;
  const activeIndex = controlled
    ? Math.max(0, items.findIndex((item) => item.key === active))
    : Math.min(Math.max(0, initial), Math.max(0, items.length - 1));

  items.forEach((item, i) => item.view.classList.toggle('hidden', i !== activeIndex));

  const buttons = items.map((item, i) =>
    el(`${buttonClass}${i === activeIndex ? '.active' : ''}${item.cls ? `.${item.cls}` : ''}`, {
      onclick: () => {
        if (sfx) playSfx('tap');
        if (controlled) {
          onPick?.(item.key); // 재렌더는 호출부가 — 여기서 DOM을 건드리면 두 진실이 생긴다
          return;
        }
        buttons.forEach((button, j) => button.classList.toggle('active', j === i));
        items.forEach((panel, j) => panel.view.classList.toggle('hidden', j !== i));
        onPick?.(item.key);
      },
    }, item.label));

  const bar = el(`${barClass}${scroll ? '.scroll' : ''}`, {}, ...buttons);
  return [bar, ...items.map((item) => item.view)];
}

/** 빅탭 묶음 — 화면·시트의 1차 분할축. [탭바, ...패널]을 반환한다. */
export function tabPanels<K extends string>(items: Panel<K>[], opts?: PanelOpts<K>): HTMLElement[] {
  return panelGroup(items, opts, 'div.big-tabs', 'button.big-tab');
}

/**
 * 탭바만 — 패널을 미리 만들지 않고 **목록 하나를 탭이 갈아끼우는** 구조용 (항상 controlled).
 * 216종처럼 패널 N개를 다 만들면 낭비인 경우에 쓴다. 선택 상태는 호출부 시그널이 든다.
 */
export function tabBar<K extends string>(
  /** dot: 지금 할 수 있는 일이 있다는 알림 점 (수치를 붙이기 애매한 탭용 — 앱바 출석 점과 같은 관용) */
  items: { key: K; label: string; title?: string; dot?: boolean }[],
  opts: { active: K; onPick: (key: K) => void; scroll?: boolean; sfx?: boolean },
): HTMLElement {
  const { active, onPick, scroll = false, sfx = true } = opts;
  return el(`div.big-tabs${scroll ? '.scroll' : ''}`, {},
    ...items.map((item) =>
      el(`button.big-tab${item.key === active ? '.active' : ''}`, {
        title: item.title ?? item.label,
        onclick: () => {
          if (sfx) playSfx('tap');
          onPick(item.key);
        },
      },
        item.label,
        item.dot ? el('span.tab-dot') : null,
      ),
    ),
  );
}

/** 칩 선택기 — 탭 안을 한 번 더 좁히는 2차 분할축. [칩줄, ...패널]을 반환한다. */
export function chipPanels<K extends string>(items: Panel<K>[], opts?: PanelOpts<K>): HTMLElement[] {
  return panelGroup(items, opts, 'div.chips-wrap', 'button.chip');
}

export interface FilterChipsOpts<K extends string> {
  active: K | null;
  onPick: (key: K | null) => void;
  /** 전체 선택 칩의 라벨 (기본 '전체'). null을 주면 '전체' 칩을 없앤다 */
  allLabel?: string | null;
  sfx?: boolean;
}

/**
 * 필터 칩 한 줄 — 항상 controlled (선택이 목록 전체를 다시 그리므로 호출부가 상태를 들어야 한다).
 * 활성 칩을 다시 누르면 해제된다.
 */
export function filterChips<K extends string>(
  items: { key: K; label: string; cls?: string }[],
  opts: FilterChipsOpts<K>,
): HTMLElement {
  const { active, onPick, allLabel = '전체', sfx = true } = opts;
  const tap = (next: K | null) => () => {
    if (sfx) playSfx('tap');
    onPick(next);
  };
  return el('div.chips-wrap', {},
    allLabel === null ? null : el(`button.chip${active === null ? '.active' : ''}`, { onclick: tap(null) }, allLabel),
    ...items.map((item) =>
      el(`button.chip${active === item.key ? '.active' : ''}${item.cls ? `.${item.cls}` : ''}`, {
        onclick: tap(active === item.key ? null : item.key),
      }, item.label),
    ),
  );
}

/**
 * 필터 칩 + 구간 목록 — 칩이 구간 단위로 표시/숨김만 토글한다 (목록을 다시 만들지 않는다).
 * 읽기 전용 시트용. 행동이 있는 화면에서는 filterChips + 호출부 필터링을 쓸 것.
 */
export function filterSections<K extends string>(
  sections: Panel<K>[],
  opts?: { allLabel?: string; sfx?: boolean },
): HTMLElement[] {
  const { allLabel = '전체', sfx = true } = opts ?? {};
  const filters: { label: string; cls?: string; match: K | null }[] = [
    { label: allLabel, match: null },
    ...sections.map((section) => ({ label: section.label, cls: section.cls, match: section.key })),
  ];
  const chips = filters.map((filter, i) =>
    el(`button.chip${i === 0 ? '.active' : ''}${filter.cls ? `.${filter.cls}` : ''}`, {
      onclick: () => {
        if (sfx) playSfx('tap');
        chips.forEach((chip, j) => chip.classList.toggle('active', j === i));
        sections.forEach((section) =>
          section.view.classList.toggle('hidden', filter.match !== null && section.key !== filter.match));
      },
    }, filter.label));
  return [el('div.chips-wrap', {}, ...chips), ...sections.map((section) => section.view)];
}

/**
 * UI 킷 — DOM 헬퍼(el), 스코프 이펙트, 토스트, 공용 포맷터. 사용자 노출 문자열의 집결지.
 */
import type { ArtifactRarity, Element, MonsterRarity, Tier, Tribe } from '../content/schema';
import { effect } from '../state/signal';
import { playSfx } from './sfx';

// ── 스코프 이펙트 ────────────────────────────────────────────────────────────
// 화면 단위 렌더가 만든 세부 이펙트(시간 표시 등)를 다음 렌더에서 일괄 해제한다.
// 구조를 다시 만들지 않고 텍스트·클래스만 갱신해 탭 중 요소가 사라지는 일을 막는다.
let scope: (() => void)[] | null = null;

export function withScope<T>(fn: () => T): { value: T; dispose: () => void } {
  const prev = scope;
  const list: (() => void)[] = [];
  scope = list;
  try {
    return { value: fn(), dispose: () => list.forEach((d) => d()) };
  } finally {
    scope = prev;
  }
}

/** 현재 스코프에 등록되는 effect — 스코프 밖이면 일반 effect처럼 살아남는다 */
export function scopedEffect(fn: () => void): void {
  const dispose = effect(fn);
  scope?.push(dispose);
}

// ── DOM 헬퍼 ─────────────────────────────────────────────────────────────────
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  spec: `${K}` | `${K}.${string}`,
  attrs: Partial<{
    onclick: (event: MouseEvent) => void;
    oninput: (event: Event) => void;
    disabled: boolean;
    title: string;
    html: string;
    value: string;
    placeholder: string;
  }> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag as K);
  if (classes.length > 0) node.className = classes.join(' ');
  if (attrs.onclick) node.addEventListener('click', attrs.onclick as EventListener);
  if (attrs.oninput) node.addEventListener('input', attrs.oninput);
  if (attrs.disabled !== undefined && 'disabled' in node) (node as HTMLButtonElement).disabled = attrs.disabled;
  if (attrs.title) node.title = attrs.title;
  if (attrs.html !== undefined) node.innerHTML = attrs.html;
  if (attrs.value !== undefined && 'value' in node) (node as HTMLInputElement).value = attrs.value;
  if (attrs.placeholder !== undefined && 'placeholder' in node) (node as HTMLInputElement).placeholder = attrs.placeholder;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

// ── 토스트 ───────────────────────────────────────────────────────────────────
export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  if (kind === 'error') playSfx('error');
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div');
    host.id = 'toasts';
    document.body.append(host);
  }
  const item = el(`div.toast.${kind === 'error' ? 'toast-error' : 'toast-ok'}`, {}, message);
  host.append(item);
  setTimeout(() => item.classList.add('show'), 10);
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 300);
  }, 2600);
}

// ── 라벨·색 ──────────────────────────────────────────────────────────────────
export const ELEMENT_LABEL: Record<Element, string> = {
  fire: '🔥 화염', nature: '🌿 자연', frost: '❄️ 냉기', light: '☀️ 빛', dark: '🌑 어둠',
};
export const ELEMENT_EMOJI: Record<Element, string> = {
  fire: '🔥', nature: '🌿', frost: '❄️', light: '☀️', dark: '🌑',
};
export const TRIBE_LABEL: Record<Tribe, string> = {
  beast: '야수', spirit: '정령', undead: '언데드', aquatic: '수생', flying: '비행', construct: '기계',
};
export const TRIBE_EMOJI: Record<Tribe, string> = {
  beast: '🐾', spirit: '✨', undead: '💀', aquatic: '💧', flying: '🪽', construct: '⚙️',
};
/** 등급 라벨 — 몬스터·유물 공용 5단계 (2026-08-23 통일) */
export const RARITY_LABEL: Record<MonsterRarity, string> = {
  common: '일반', uncommon: '고급', rare: '희귀', heroic: '영웅', legendary: '전설',
};
export const MONSTER_RARITY_LABEL: Record<MonsterRarity, string> = RARITY_LABEL;
export const ARTIFACT_RARITY_LABEL: Record<ArtifactRarity, string> = RARITY_LABEL;
/** 등급 서열 — 정렬은 반드시 이 랭크로 (id 알파벳순은 뒤집힌다) */
export const ARTIFACT_RARITY_ORDER: Record<ArtifactRarity, number> = {
  common: 0, uncommon: 1, rare: 2, heroic: 3, legendary: 4,
};
export const TIER_LABEL: Record<Tier, string> = {
  scout: '정찰 · 15분', standard: '원정 · 2시간', deep: '심층 탐사 · 8시간',
};
export const SLOT_LABEL: Record<string, string> = {
  weapon: '무기', armor: '방어구', banner: '깃발', charm: '부적',
};

// ── 포맷터 ───────────────────────────────────────────────────────────────────
export function fmtGold(value: number): string {
  return value.toLocaleString('ko-KR');
}

export function fmtRemain(ms: number): string {
  if (ms <= 0) return '완료!';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

export function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** 타임스탬프 → "21:05" (24시간제) */
export function fmtClock(ts: number): string {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 지난 시각 → "방금 전 · 3분 전 · 2시간 전 · 어제 · 3일 전" */
export function fmtAgo(ms: number): string {
  if (ms < 60_000) return '방금 전';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '어제' : `${days}일 전`;
}

export function stars(count: number): string {
  return '★'.repeat(count);
}

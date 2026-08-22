/**
 * 자체 반응형 프리미티브 (TECH.md §5) — signal / computed / effect / batch 4개뿐.
 * 가상 DOM 없음: 화면은 "구독하는 렌더 함수"다.
 */

interface EffectNode {
  run: () => void;
  deps: Set<Set<EffectNode>>;
  disposed: boolean;
}

let active: EffectNode | null = null;
let batchDepth = 0;
const pending = new Set<EffectNode>();

export interface Signal<T> {
  (): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs = new Set<EffectNode>();
  const read = (() => {
    if (active) {
      subs.add(active);
      active.deps.add(subs);
    }
    return value;
  }) as Signal<T>;
  read.set = (next: T) => {
    if (Object.is(next, value)) return;
    value = next;
    for (const node of [...subs]) {
      if (node.disposed) subs.delete(node);
      else pending.add(node);
    }
    if (batchDepth === 0) flush();
  };
  read.update = (fn) => read.set(fn(value));
  return read;
}

function flush(): void {
  let guard = 0;
  while (pending.size > 0) {
    if (++guard > 1000) throw new Error('signal: 순환 갱신 감지 (1000회 초과)');
    const batchRun = [...pending];
    pending.clear();
    for (const node of batchRun) {
      if (!node.disposed) node.run();
    }
  }
}

function unsubscribe(node: EffectNode): void {
  for (const dep of node.deps) dep.delete(node);
  node.deps.clear();
}

/** 의존 자동 추적 부수효과. 반환값은 dispose 함수. */
export function effect(fn: () => void): () => void {
  const node: EffectNode = {
    deps: new Set(),
    disposed: false,
    run: () => {
      unsubscribe(node);
      const prev = active;
      active = node;
      try {
        fn();
      } finally {
        active = prev;
      }
    },
  };
  node.run();
  return () => {
    node.disposed = true;
    unsubscribe(node);
  };
}

/** 파생값 — 내부적으로 signal + effect (eager 재계산) */
export function computed<T>(fn: () => T): () => T {
  const out = signal<T>(undefined as T);
  effect(() => out.set(fn()));
  return () => out();
}

/** 여러 set을 묶어 한 번만 전파 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

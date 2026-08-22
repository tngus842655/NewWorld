import { describe, expect, it } from 'vitest';
import { batch, computed, effect, signal } from '../src/state/signal';

describe('signal 레이어', () => {
  it('effect가 의존을 추적하고 변경 시 재실행된다', () => {
    const count = signal(1);
    const seen: number[] = [];
    effect(() => seen.push(count()));
    count.set(2);
    count.set(2); // 동일 값 — 재실행 없음
    count.set(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('dispose 후에는 재실행되지 않는다', () => {
    const count = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      count();
      runs++;
    });
    count.set(1);
    dispose();
    count.set(2);
    expect(runs).toBe(2);
  });

  it('조건 분기로 의존이 바뀌면 이전 의존은 해제된다', () => {
    const flag = signal(true);
    const a = signal('a');
    const b = signal('b');
    let runs = 0;
    effect(() => {
      runs++;
      if (flag()) a();
      else b();
    });
    expect(runs).toBe(1);
    flag.set(false); // 이제 b만 의존
    expect(runs).toBe(2);
    a.set('a2'); // 더 이상 의존 아님
    expect(runs).toBe(2);
    b.set('b2');
    expect(runs).toBe(3);
  });

  it('computed는 파생값을 전파한다', () => {
    const count = signal(2);
    const doubled = computed(() => count() * 2);
    const seen: number[] = [];
    effect(() => seen.push(doubled()));
    count.set(5);
    expect(doubled()).toBe(10);
    expect(seen).toEqual([4, 10]);
  });

  it('batch는 여러 set을 한 번의 전파로 묶는다', () => {
    const a = signal(1);
    const b = signal(1);
    let runs = 0;
    effect(() => {
      a();
      b();
      runs++;
    });
    batch(() => {
      a.set(2);
      b.set(2);
    });
    expect(runs).toBe(2); // 초기 1 + batch 1
  });
});

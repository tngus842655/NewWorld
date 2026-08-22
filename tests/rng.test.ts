import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, pickWeighted, randInt, streamRng } from '../src/core/rng';

describe('결정론 난수', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = mulberry32(hashSeed('abc'));
    const b = mulberry32(hashSeed('abc'));
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('스트림이 분리된다 — 한 스트림 소비가 다른 스트림에 영향 없음', () => {
    const capture1 = streamRng('seed', 'capture');
    const first = capture1();

    const sequence = streamRng('seed', 'sequence');
    for (let i = 0; i < 50; i++) sequence(); // 다른 스트림을 잔뜩 소비
    const capture2 = streamRng('seed', 'capture');
    expect(capture2()).toBe(first);
  });

  it('randInt는 양끝 포함 범위를 지킨다', () => {
    const rng = streamRng('seed', 'int');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = randInt(rng, 1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });

  it('pickWeighted는 가중치 0 항목을 뽑지 않는다', () => {
    const rng = streamRng('seed', 'weighted');
    const items = [
      { id: 'a', w: 0 },
      { id: 'b', w: 1 },
    ];
    for (let i = 0; i < 200; i++) {
      expect(pickWeighted(rng, items, (x) => x.w).id).toBe('b');
    }
  });
});

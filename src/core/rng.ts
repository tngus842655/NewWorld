/**
 * 결정론 난수 — mulberry32 + 용도별 스트림 분리 (TECH.md §6).
 * 한 스트림의 roll 횟수 변화가 다른 스트림 결과를 흔들지 않게 한다.
 */

export type Rng = () => number; // [0, 1)

/** FNV-1a 32bit 문자열 해시 */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 파견 시드 + 용도명 → 독립 스트림 */
export function streamRng(seed: string, stream: string): Rng {
  return mulberry32(hashSeed(`${seed}/${stream}`));
}

/** min~max 정수 (양끝 포함) */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** 가중치 추첨 — weights 합이 0이면 균등 추첨 */
export function pickWeighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  if (items.length === 0) throw new Error('pickWeighted: 빈 목록');
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) {
    const idx = Math.min(items.length - 1, Math.floor(rng() * items.length));
    return items[idx]!;
  }
  let roll = rng() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1]!;
}

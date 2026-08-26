/**
 * 권역(tier) 내비게이션 공용 — 원정·도감이 같은 묶음·라벨을 쓴다 (2026-08-27).
 * regionList가 order 정렬이라 각 묶음의 첫 지역이 권역 진입 지역이다.
 */
import { content } from '../content';
import type { Region } from '../content/schema';

export const regionTiers: { tier: number; regions: Region[] }[] = (() => {
  const byTier = new Map<number, Region[]>();
  for (const region of content.regionList) {
    const bucket = byTier.get(region.tier) ?? [];
    bucket.push(region);
    byTier.set(region.tier, bucket);
  }
  return [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([tier, regions]) => ({ tier, regions }));
})();

/** 권역 탭·칩 라벨 — 진입 지역 이름의 마지막 어절 (물안개 해안→해안, 잿빛 화산→화산) */
export function tierShortName(regions: Region[]): string {
  const entry = regions[0]!;
  return entry.name.split(' ').at(-1) ?? entry.name;
}

import { describe, expect, it } from 'vitest';
import { content } from './helpers';

describe('콘텐츠 무결성', () => {
  it('로드와 참조 무결성 검증을 통과한다 (loadContent가 throw하지 않음)', () => {
    expect(content.monsterList.length).toBeGreaterThan(0);
  });

  it('도감은 정확히 104종 — 지역 4 × (커먼14 + 레어6 + 에픽4 + 전설2)', () => {
    expect(content.monsterList).toHaveLength(104);
    for (const region of content.regionList) {
      const natives = content.monsterList.filter((m) => m.habitat === region.id);
      expect(natives, region.id).toHaveLength(26);
      const by = (rarity: string) => natives.filter((m) => m.rarity === rarity).length;
      expect(by('common'), region.id).toBe(14);
      expect(by('rare'), region.id).toBe(6);
      expect(by('epic'), region.id).toBe(4);
      expect(by('legendary'), region.id).toBe(2);
      // 비전설 24종은 전부 출현 테이블에, 전설 2종은 legendary 필드에
      expect(region.spawns, region.id).toHaveLength(24);
      expect(region.legendary, region.id).toHaveLength(2);
    }
  });

  it('지역은 4개, order 순 정렬, 첫 지역은 해금 조건 없음', () => {
    expect(content.regionList).toHaveLength(4);
    expect(content.regionList.map((r) => r.order)).toEqual([1, 2, 3, 4]);
    const first = content.regionList[0]!;
    expect(first.unlock.codexCaptured).toBeUndefined();
  });

  it('지역 해금·권장 CP 곡선은 단조 증가한다', () => {
    const cps = content.regionList.map((r) => r.recommendedCp);
    for (let i = 1; i < cps.length; i++) expect(cps[i]!).toBeGreaterThan(cps[i - 1]!);
    const scales = content.regionList.map((r) => r.rewardScale);
    for (let i = 1; i < scales.length; i++) expect(scales[i]!).toBeGreaterThan(scales[i - 1]!);
  });

  it('유물은 56종 — 일반·희귀 16 + 영웅 24 + 전설 16, 세트 4계열', () => {
    expect(content.artifacts.size).toBe(56);
    const byRarity = (r: string) => [...content.artifacts.values()].filter((a) => a.rarity === r).length;
    expect(byRarity('common') + byRarity('rare')).toBe(16);
    expect(byRarity('heroic')).toBe(24);
    expect(byRarity('legendary')).toBe(16);
    expect(content.sets.size).toBe(4);
  });

  it('전설 유물은 전부 고유 능력을 가진다 (빌드 정의급 — GDD §8.2)', () => {
    for (const artifact of content.artifacts.values()) {
      if (artifact.rarity === 'legendary') {
        expect(artifact.unique.length, artifact.id).toBeGreaterThan(0);
      }
      if (artifact.rarity === 'common' || artifact.rarity === 'rare') {
        expect(artifact.unique, artifact.id).toHaveLength(0);
      }
    }
  });

  it('모든 종족에 시너지가 정의돼 있고, 종족별 보유 몬스터가 3마리 이상이다', () => {
    for (const tribe of ['beast', 'spirit', 'undead', 'aquatic', 'flying', 'construct'] as const) {
      expect(content.synergies.has(tribe), tribe).toBe(true);
      const count = content.monsterList.filter((m) => m.tribe === tribe).length;
      expect(count, `${tribe} 종족 몬스터 수`).toBeGreaterThanOrEqual(3);
    }
  });

  it('스타터는 첫 지역의 커먼 몬스터들이다', () => {
    for (const id of content.balance.starter.monsters) {
      const monster = content.monsters.get(id)!;
      expect(monster.habitat).toBe(content.regionList[0]!.id);
      expect(monster.rarity).toBe('common');
    }
  });

  it('레시피 재료·마일스톤 지역 참조가 유효하다 (로더에서 검증되지만 회귀 방지)', () => {
    for (const recipe of content.recipes.values()) {
      for (const materialId of Object.keys(recipe.cost.materials)) {
        expect(content.materials.has(materialId)).toBe(true);
      }
    }
    expect(content.milestones.length).toBeGreaterThanOrEqual(10);
  });
});

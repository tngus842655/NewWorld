import { describe, expect, it } from 'vitest';
import { RARITY_ORDER } from '../src/content/schema';
import { content } from './helpers';

describe('콘텐츠 무결성', () => {
  it('로드와 참조 무결성 검증을 통과한다 (loadContent가 throw하지 않음)', () => {
    expect(content.monsterList.length).toBeGreaterThan(0);
  });

  it('도감은 219종 — 지역 4 × (일반16 + 고급12 + 희귀12 + 영웅8 + 전설6) + 초월 3 (합성 전용)', () => {
    expect(content.monsterList).toHaveLength(219);
    // 초월 3종은 최종 지역 소속이지만 어느 지역의 출현 테이블에도 없다 (2026-08-25 사용자)
    const transcendent = content.monsterList.filter((m) => m.rarity === 'transcendent');
    expect(transcendent).toHaveLength(3);
    const last = content.regionList[content.regionList.length - 1]!;
    for (const m of transcendent) expect(m.habitat, m.id).toBe(last.id);
    for (const region of content.regionList) {
      const natives = content.monsterList.filter((m) => m.habitat === region.id && m.rarity !== 'transcendent');
      expect(natives, region.id).toHaveLength(54);
      const by = (rarity: string) => natives.filter((m) => m.rarity === rarity).length;
      expect(by('common'), region.id).toBe(16);
      expect(by('uncommon'), region.id).toBe(12);
      expect(by('rare'), region.id).toBe(12);
      expect(by('heroic'), region.id).toBe(8);
      expect(by('legendary'), region.id).toBe(6);
      // 비전설 48종은 전부 출현 테이블에, 전설 6종은 legendary 필드에
      expect(region.spawns, region.id).toHaveLength(48);
      expect(region.legendary, region.id).toHaveLength(6);
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

  it('유물은 100종 — 일반8 + 고급8 + 희귀16 + 영웅48 + 전설16 + 초월4, 세트 8계열', () => {
    expect(content.artifacts.size).toBe(100);
    const byRarity = (r: string) => [...content.artifacts.values()].filter((a) => a.rarity === r).length;
    expect(byRarity('common')).toBe(8);
    expect(byRarity('uncommon')).toBe(8);
    expect(byRarity('rare')).toBe(16);
    expect(byRarity('heroic')).toBe(48);
    expect(byRarity('legendary')).toBe(16);
    expect(byRarity('transcendent')).toBe(4); // 합성 전용 — 세트 없음 (4점이어도 세트는 만들지 않는다)
    // 초월 유물은 4슬롯을 한 점씩 채운다 — 어느 슬롯도 비지 않아야 편성이 온전하다
    const topSlots = [...content.artifacts.values()].filter((a) => a.rarity === 'transcendent').map((a) => a.slot);
    expect([...topSlots].sort()).toEqual(['armor', 'banner', 'charm', 'weapon']);
    expect(content.sets.size).toBe(8);
  });

  it('전설 유물은 전부 고유 능력을 가진다 (빌드 정의급 — GDD §8.2)', () => {
    for (const artifact of content.artifacts.values()) {
      if (RARITY_ORDER[artifact.rarity] >= RARITY_ORDER.legendary) {
        expect(artifact.unique.length, artifact.id).toBeGreaterThan(0);
      }
      if (artifact.rarity === 'common' || artifact.rarity === 'uncommon' || artifact.rarity === 'rare') {
        expect(artifact.unique, artifact.id).toHaveLength(0);
      }
    }
  });

  it('전설 이상 몬스터는 전부 고유 능력을 가지고, 그 아래는 없다 (2026-08-24, 2026-08-25 초월 포함)', () => {
    for (const monster of content.monsterList) {
      if (RARITY_ORDER[monster.rarity] >= RARITY_ORDER.legendary) {
        expect(monster.unique.length, monster.id).toBeGreaterThan(0);
      } else {
        expect(monster.unique, monster.id).toHaveLength(0);
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

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

  /**
   * 해금 조건 사다리 (2026-08-25 재조정)
   *
   * 몬스터를 지역당 54종으로 확장하면서 도감 조건(8/20/20)이 상대적으로 헐거워져 있었다 —
   * 시뮬 계측상 재료 조건이 늘 먼저 걸려서 **도감 조건은 한 번도 제동이 되지 못했다**.
   * 도감을 주 제동으로 되돌리고(앞 지역의 약 20% → 44% → 74%), 재료는 값(비용)으로 남긴다.
   * 숫자 조정은 scripts/unlock-sweep.ts 로 계측한다.
   */
  describe('지역 해금 조건', () => {
    const gated = content.regionList.filter((r) => r.order > 1);
    const nativeCount = (regionId: string) =>
      content.monsterList.filter((m) => m.habitat === regionId && m.rarity !== 'transcendent').length;
    /** 전설은 심층 한정 + 포획률 1.5%라, 전설 없이 달성 가능해야 한다 */
    const catchableCount = (regionId: string) =>
      content.monsterList.filter((m) => m.habitat === regionId && m.rarity !== 'transcendent' && m.rarity !== 'legendary').length;

    it('바로 앞 지역만 조건으로 건다 — 건너뛴 참조는 순서를 무너뜨린다', () => {
      for (const region of gated) {
        const prev = content.regionList[region.order - 2]!;
        const refs = Object.keys(region.unlock.codexCaptured ?? {});
        expect(refs, `${region.name} 도감 조건`).toEqual([prev.id]);
        for (const materialId of Object.keys(region.unlock.materials ?? {})) {
          expect(content.materials.get(materialId)!.region, `${region.name} 재료 조건`).toBe(prev.id);
        }
      }
    });

    it('전설 없이 달성 가능하다 — 전설은 심층 한정·포획률 1.5%라 사실상 벽이 된다', () => {
      for (const region of gated) {
        for (const [prevId, need] of Object.entries(region.unlock.codexCaptured ?? {})) {
          expect(need, `${region.name} 해금(${prevId} ${need}종) vs 비전설 ${catchableCount(prevId)}종`)
            .toBeLessThanOrEqual(catchableCount(prevId));
        }
      }
    });

    it('깊은 지역일수록 앞 지역을 더 많이 채우게 한다 — 비율이 단조 증가', () => {
      const ratios = gated.map((region) => {
        const [prevId, need] = Object.entries(region.unlock.codexCaptured ?? {})[0]!;
        return { name: region.name, ratio: need / nativeCount(prevId), need };
      });
      for (let i = 1; i < ratios.length; i++) {
        expect(ratios[i]!.ratio, `${ratios[i]!.name}(${(ratios[i]!.ratio * 100).toFixed(0)}%)가 ${ratios[i - 1]!.name}(${(ratios[i - 1]!.ratio * 100).toFixed(0)}%)보다 커야 한다`)
          .toBeGreaterThan(ratios[i - 1]!.ratio);
      }
      // 첫 관문은 맛보기(10~30%), 마지막 관문은 그 지역을 거의 채우는 수준(60~85%)
      expect(ratios[0]!.ratio).toBeGreaterThanOrEqual(0.1);
      expect(ratios[0]!.ratio).toBeLessThanOrEqual(0.3);
      expect(ratios[ratios.length - 1]!.ratio).toBeGreaterThanOrEqual(0.6);
      expect(ratios[ratios.length - 1]!.ratio).toBeLessThanOrEqual(0.85);
    });

    it('재료 조건은 제동이 아니라 값이다 — 도감 조건보다 가볍게 유지한다', () => {
      // 재료는 원정 횟수에 비례해 쌓이므로 방치 유저에게만 무겁게 걸리는 역진적 게이트다.
      // 심층 1회가 그 지역 재료를 슬롯당 약 2.3개 주므로, 한 종당 1.5개를 상한으로 본다.
      for (const region of gated) {
        const need = Object.entries(region.unlock.codexCaptured ?? {})[0]?.[1] ?? 0;
        for (const [materialId, count] of Object.entries(region.unlock.materials ?? {})) {
          const name = content.materials.get(materialId)!.name;
          expect(count, `${region.name} 해금의 ${name} ${count}개 (도감 조건 ${need}종)`).toBeLessThanOrEqual(need * 1.5);
        }
      }
    });
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

  /**
   * 사다리 상한 == 모수 (2026-08-25 초월 3종 추가로 실제로 어긋났던 자리)
   *
   * 종을 늘리면서 사다리를 안 늘리면 "완성" 업적이 완성 전에 터진다 — 초월 3종을 넣었을 때
   * codex-216이 219종 중 216종에서 터지고, 화산 사다리(54)는 서식종 51종 + 초월 3종으로 터졌다.
   * 사다리는 두 축이고(schema.ts MilestoneConditionSchema), 각 축의 꼭대기가 제 모수와 정확히
   * 같아야 한다. 모수를 **넘는** 계단은 loadContent가 이미 throw하므로 여기서는 **모자란** 쪽을 잡는다.
   */
  describe('마일스톤 사다리 상한', () => {
    const stepsOf = (pick: (c: (typeof content.milestones)[number]['condition']) => number | null) =>
      content.milestones.flatMap((m) => {
        const count = pick(m.condition);
        return count === null ? [] : [count];
      });
    const top = (counts: number[]) => (counts.length === 0 ? null : Math.max(...counts));

    it('지역 사다리의 꼭대기 == 그 지역 서식종 수 (초월은 서식종이 아니다)', () => {
      for (const region of content.regionList) {
        const natives = content.nativeList.filter((m) => m.habitat === region.id).length;
        const ladder = top(stepsOf((c) => (c.kind === 'regionCaptured' && c.region === region.id ? c.count : null)));
        expect(ladder, `${region.name} 사다리 꼭대기 vs 서식종 ${natives}종`).toBe(natives);
      }
    });

    it('총합 사다리의 꼭대기 == 전 지역 서식종 수', () => {
      const ladder = top(stepsOf((c) => (c.kind === 'totalCaptured' ? c.count : null)));
      expect(ladder, `총합 사다리 꼭대기 vs 서식종 ${content.nativeList.length}종`).toBe(content.nativeList.length);
    });

    it('초월 사다리의 꼭대기 == 초월 종 수', () => {
      const ladder = top(stepsOf((c) => (c.kind === 'rarityCaptured' && c.rarity === 'transcendent' ? c.count : null)));
      expect(ladder, `초월 사다리 꼭대기 vs 초월 ${content.transcendentList.length}종`)
        .toBe(content.transcendentList.length);
    });

    it('두 축이 총 종 수를 남김없이 덮는다 — 어느 축에도 안 잡히는 종이 없어야 한다', () => {
      expect(content.nativeList.length + content.transcendentList.length).toBe(content.monsterList.length);
      expect(content.transcendentList.length, '초월이 있으면 초월 축도 있어야 한다').toBeGreaterThan(0);
    });
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

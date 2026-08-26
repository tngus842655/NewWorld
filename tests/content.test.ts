import { describe, expect, it } from 'vitest';
import { RARITY_ORDER } from '../src/content/schema';
import { content } from './helpers';

describe('콘텐츠 무결성', () => {
  it('로드와 참조 무결성 검증을 통과한다 (loadContent가 throw하지 않음)', () => {
    expect(content.monsterList.length).toBeGreaterThan(0);
  });

  it('도감은 219종 — 티어 4 × (일반16 + 고급12 + 희귀12 + 영웅8 + 전설6) + 초월 3 (합성 전용)', () => {
    expect(content.monsterList).toHaveLength(219);
    // 초월 3종은 최종 지역 소속이지만 어느 지역의 출현 테이블에도 없다 (2026-08-25 사용자)
    const transcendent = content.monsterList.filter((m) => m.rarity === 'transcendent');
    expect(transcendent).toHaveLength(3);
    const last = content.regionList[content.regionList.length - 1]!;
    for (const m of transcendent) expect(m.habitat, m.id).toBe(last.id);
    // 소지역: 서식 18종 (포획 가능 16 + 심층 전설 2) — 12지역 개편 (2026-08-26)
    for (const region of content.regionList) {
      const natives = content.monsterList.filter((m) => m.habitat === region.id && m.rarity !== 'transcendent');
      expect(natives, region.id).toHaveLength(18);
      expect(natives.filter((m) => m.rarity !== 'legendary'), region.id).toHaveLength(16);
      expect(region.spawns, region.id).toHaveLength(16);
      expect(region.legendary, region.id).toHaveLength(2);
    }
    // 티어: 등급 구성은 구 4지역 시절 그대로 (일반16 + 고급12 + 희귀12 + 영웅8 + 전설6 = 54)
    for (const tier of [1, 2, 3, 4]) {
      const regionIds = new Set(content.regionList.filter((r) => r.tier === tier).map((r) => r.id));
      const natives = content.monsterList.filter((m) => regionIds.has(m.habitat) && m.rarity !== 'transcendent');
      const by = (rarity: string) => natives.filter((m) => m.rarity === rarity).length;
      expect(by('common'), `tier ${tier}`).toBe(16);
      expect(by('uncommon'), `tier ${tier}`).toBe(12);
      expect(by('rare'), `tier ${tier}`).toBe(12);
      expect(by('heroic'), `tier ${tier}`).toBe(8);
      expect(by('legendary'), `tier ${tier}`).toBe(6);
    }
  });

  it('지역은 12개 (티어 4 × 소지역 3), order 순 정렬, 첫 지역은 해금 조건 없음', () => {
    expect(content.regionList).toHaveLength(12);
    expect(content.regionList.map((r) => r.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(content.regionList.map((r) => r.tier)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    const first = content.regionList[0]!;
    expect(first.unlock.codexCaptured).toBeUndefined();
  });

  it('티어 진입 지역은 구 4지역 id를 유지한다 — 세이브·재료·팀 해금 참조 보존 (2026-08-26)', () => {
    const entries = content.regionList.filter((r, i, list) => i === 0 || list[i - 1]!.tier !== r.tier);
    expect(entries.map((r) => r.id)).toEqual(['misty-coast', 'whispering-woods', 'sunken-marsh', 'ashen-volcano']);
  });

  it('권장 CP는 단조 증가, 경제 배수(성장·보상)는 티어 안에서 같고 티어 경계에서만 오른다', () => {
    const cps = content.regionList.map((r) => r.recommendedCp);
    for (let i = 1; i < cps.length; i++) expect(cps[i]!).toBeGreaterThan(cps[i - 1]!);
    for (let i = 1; i < content.regionList.length; i++) {
      const prev = content.regionList[i - 1]!;
      const cur = content.regionList[i]!;
      if (prev.tier === cur.tier) {
        expect(cur.rewardScale, cur.id).toBe(prev.rewardScale);
        expect(cur.growthCostMult, cur.id).toBe(prev.growthCostMult);
      } else {
        expect(cur.rewardScale, cur.id).toBeGreaterThan(prev.rewardScale);
        expect(cur.growthCostMult, cur.id).toBeGreaterThan(prev.growthCostMult);
      }
    }
  });

  /**
   * 해금 조건 사다리 (2026-08-26 12지역 개편)
   *
   * 게이트는 11개 체인이다. 티어 안과 티어 진입의 역할을 갈라 둔다:
   * - **도감 = 제동, 재료 = 값** (2026-08-25 원칙 유지). 재료는 티어 진입 관문에만, 앞 티어 재료 2종 대칭으로 건다
   * - 티어 내 관문은 도감 단독(한 축) — 게이트 둘을 겹치면 곱으로 작용하기 때문
   * - 관문 깊이(앞 지역 포획 가능 16종 대비)는 티어 진입끼리 단조 증가 — 초반 촘촘, 후반 묵직
   * 숫자 조정은 scripts/unlock-sweep.ts 로 계측한다.
   */
  describe('지역 해금 조건', () => {
    const gated = content.regionList.filter((r) => r.order > 1);
    /** 전설은 심층 한정 + 포획률 1.5%라, 전설 없이 달성 가능해야 한다 */
    const catchableCount = (regionId: string) =>
      content.monsterList.filter((m) => m.habitat === regionId && m.rarity !== 'transcendent' && m.rarity !== 'legendary').length;

    it('바로 앞 지역만 조건으로 걸고, 재료는 티어 진입 관문에만 앞 티어 재료 2종 대칭으로 건다', () => {
      for (const region of gated) {
        const prev = content.regionList[region.order - 2]!;
        const refs = Object.keys(region.unlock.codexCaptured ?? {});
        expect(refs, `${region.name} 도감 조건`).toEqual([prev.id]);
        const mats = Object.keys(region.unlock.materials ?? {});
        if (region.tier === prev.tier) {
          expect(mats, `${region.name}는 티어 내 관문 — 도감 단독이어야 한다`).toHaveLength(0);
        } else {
          expect([...mats].sort(), `${region.name} 재료 조건은 앞 티어 재료 2종`).toEqual([...prev.materials].sort());
          const counts = Object.values(region.unlock.materials ?? {});
          expect(new Set(counts).size, `${region.name} 재료 2종은 같은 수 (수급·소비 대칭 규칙)`).toBe(1);
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

    it('티어 진입 관문일수록 앞 지역을 더 많이 채우게 한다 — 진입 관문 비율 단조 증가', () => {
      const ratioOf = (region: (typeof gated)[number]) => {
        const [prevId, need] = Object.entries(region.unlock.codexCaptured ?? {})[0]!;
        return need / catchableCount(prevId);
      };
      const entries = gated.filter((r) => content.regionList[r.order - 2]!.tier !== r.tier);
      for (let i = 1; i < entries.length; i++) {
        expect(ratioOf(entries[i]!), `${entries[i]!.name} 진입 관문이 ${entries[i - 1]!.name}보다 얕다`)
          .toBeGreaterThanOrEqual(ratioOf(entries[i - 1]!));
      }
      // 모든 관문은 맛보기 아래로 내려가지 않고(≥25%), 마지막 관문은 앞 지역을 거의 채우는 수준(≥75%)
      for (const region of gated) {
        expect(ratioOf(region), `${region.name} 관문`).toBeGreaterThanOrEqual(0.25);
        expect(ratioOf(region), `${region.name} 관문`).toBeLessThanOrEqual(1);
      }
      expect(ratioOf(gated[gated.length - 1]!)).toBeGreaterThanOrEqual(0.75);
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

  // 파티 슬롯 게이트 (2026-08-25 재조정) — 52종 시절 값(10/25종)이 219종까지 방치돼
  // 첫날 지나치는 무료 배급이 됐던 회귀를 막는다. 근거: scripts/slot-sweep.ts
  it('파티 슬롯 해금은 baseSlots 다음 칸부터 1칸씩, 도감·골드 모두 단조 증가한다', () => {
    const { baseSlots, slotUnlocks } = content.balance.party;
    expect(slotUnlocks.length).toBeGreaterThan(0);
    expect(slotUnlocks.map((u) => u.slots)).toEqual(slotUnlocks.map((_, i) => baseSlots + 1 + i));
    for (let i = 1; i < slotUnlocks.length; i++) {
      expect(slotUnlocks[i]!.totalCaptured, `${slotUnlocks[i]!.slots}칸 도감`).toBeGreaterThan(slotUnlocks[i - 1]!.totalCaptured);
      expect(slotUnlocks[i]!.gold, `${slotUnlocks[i]!.slots}칸 골드`).toBeGreaterThan(slotUnlocks[i - 1]!.gold);
    }
  });

  it('파티 슬롯 도감 조건은 총 종 수 대비 비율 구간 안에 있다 (도감 = 제동, GDD §6.1)', () => {
    // 종 확장(52 → 104 → 216 → 219) 때마다 비율이 희석되는 회귀를 잡는다.
    // 구간은 52종 시절 설계 의도(4칸 19% · 5칸 48%)를 중심으로 잡은 허용폭.
    const total = content.monsterList.length;
    const BANDS: Record<number, [number, number]> = { 4: [0.12, 0.26], 5: [0.4, 0.6] };
    for (const unlock of content.balance.party.slotUnlocks) {
      const band = BANDS[unlock.slots];
      expect(band, `${unlock.slots}칸 슬롯의 비율 구간이 정의돼 있지 않다`).toBeDefined();
      const ratio = unlock.totalCaptured / total;
      expect(ratio, `${unlock.slots}칸 도감 ${unlock.totalCaptured}/${total}종 = ${(ratio * 100).toFixed(1)}%`)
        .toBeGreaterThanOrEqual(band![0]);
      expect(ratio, `${unlock.slots}칸 도감 ${unlock.totalCaptured}/${total}종 = ${(ratio * 100).toFixed(1)}%`)
        .toBeLessThanOrEqual(band![1]);
    }
  });

  it('파티 슬롯 도감 조건은 총도감 업적 계단 위에 놓인다 (슬롯과 업적이 같은 날 오도록)', () => {
    const rungs = new Set(
      content.milestones
        .filter((m) => m.condition.kind === 'totalCaptured')
        .map((m) => (m.condition as { kind: 'totalCaptured'; count: number }).count),
    );
    for (const unlock of content.balance.party.slotUnlocks) {
      expect([...rungs].sort((a, b) => a - b), `${unlock.slots}칸 도감 ${unlock.totalCaptured}종`)
        .toContain(unlock.totalCaptured);
    }
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

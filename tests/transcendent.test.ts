/**
 * 초월 등급 격리 — 합성 외의 경로로는 절대 나오지 않는다 (2026-08-25 사용자 지시).
 *
 * 존재 이유: 확률 0은 조용하다. balance.json의 키 하나가 0에서 벗어나거나, 새 획득 경로가
 * 등급 배열을 무심코 순회하면 초월이 정찰에서 튀어나오고 아무 테스트도 빨개지지 않는다.
 * 여기가 그 그물이다.
 */
import { describe, expect, it } from 'vitest';
import { RARITIES, RARITY_ORDER } from '../src/content/schema';
import { finalTierEntry, fuseArtifacts, fuseMonsters, transcendGateRegion } from '../src/core/economy';
import { evaluateNewMilestones, resolveExpedition } from '../src/core/expedition';
import { capturedCounts, isRegionUnlocked, regionFlagKey } from '../src/core/progression';
import { streamRng } from '../src/core/rng';
import { buyShopProduct } from '../src/core/shop';
import { GameError, type CoreCtx } from '../src/core/types';
import type { Content } from '../src/content';
import { T0, content, findSeed, makeCtx, makeExpedition, saveWithParty } from './helpers';

const TOP = RARITIES[RARITIES.length - 1]!;

describe('초월 등급 격리 (합성 전용)', () => {
  it('초월은 최상위 등급이고 이름은 transcendent다', () => {
    expect(TOP).toBe('transcendent');
    expect(RARITY_ORDER[TOP]).toBe(RARITIES.length - 1);
  });

  it('어느 지역의 출현 테이블에도, legendary 필드에도 없다', () => {
    for (const region of content.regionList) {
      for (const spawn of region.spawns) {
        expect(content.monsters.get(spawn.monster)!.rarity, `${region.id} spawns`).not.toBe(TOP);
      }
      for (const id of region.legendary) {
        expect(content.monsters.get(id)!.rarity, `${region.id} legendary`).not.toBe(TOP);
      }
    }
  });

  it('조우·드랍·상점 뽑기 확률표가 전부 0이다', () => {
    const { balance } = content;
    expect(balance.artifacts.dropRarity[TOP], '유물 드랍').toBe(0);
    expect(balance.capture.base[TOP], '포획 기본 확률').toBe(0);
    for (const [key, table] of Object.entries(balance.shop.monsterGacha)) {
      expect(table![TOP], `monsterGacha.${key}`).toBe(0);
    }
    for (const [key, table] of Object.entries(balance.shop.artifactGacha)) {
      expect(table![TOP], `artifactGacha.${key}`).toBe(0);
    }
  });

  it('전 지역·전 티어 200시드 원정에서 초월 조우가 0건이다', () => {
    let encounters = 0;
    for (let i = 0; i < 200; i++) {
      const clock = makeCtx();
      const { save, partyIds } = saveWithParty(clock, [{ id: 'dune-pup' }, { id: 'bubble-crab' }, { id: 'gull-imp' }], {
        partySlots: 3,
        unlockAll: true,
      });
      // 심층이 가장 등급이 높게 뜨는 경로 — 여기서 안 나오면 정찰·원정에서도 안 나온다
      const region = content.regionList[i % content.regionList.length]!;
      const expedition = makeExpedition(region.id, 'deep', partyIds, [], `iso-${i}`);
      save.expeditions.push(expedition);
      const journal = resolveExpedition(content, save, expedition);
      for (const entry of journal.entries) {
        if (entry.type !== 'encounter' || !entry.monsterId) continue;
        encounters += 1;
        expect(content.monsters.get(entry.monsterId)!.rarity, `시드 iso-${i}`).not.toBe(TOP);
      }
    }
    expect(encounters, '조우가 실제로 발생해야 검사가 의미 있다').toBeGreaterThan(100);
  });

  it('상점 뽑기 400회(몬스터·유물)에서 초월이 0건이다', () => {
    const clock = makeCtx();
    const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { unlockAll: true });
    save.wallet.gold = 50_000_000;
    save.wallet.diamonds = 2_500_000;

    // 한도 없는 다이아 뽑기만 — 일일 한도가 있는 골드 뽑기는 표본이 1회뿐이라 의미가 없다
    const gacha = content.shopProducts.filter(
      (product) => (product.goods.kind === 'monsterGacha' || product.goods.kind === 'artifactGacha')
        && product.limit.kind === 'none',
    );
    expect(gacha.length, '한도 없는 뽑기 상품이 있어야 검사가 의미 있다').toBeGreaterThan(0);

    let current = save;
    let draws = 0;
    for (let i = 0; i < 400; i++) {
      const product = gacha[i % gacha.length]!;
      const ctx: CoreCtx = { now: () => T0, newSeed: () => `gacha-${i}`, newUid: () => `uid-${i}` };
      current = buyShopProduct(content, current, { productId: product.id }, ctx).save;
      draws += 1;
    }
    expect(draws, '실제 구매가 일어나야 검사가 의미 있다').toBe(400);
    for (const owned of current.roster) {
      expect(content.monsters.get(owned.monsterId)!.rarity, owned.monsterId).not.toBe(TOP);
    }
    for (const owned of current.artifacts) {
      expect(content.artifacts.get(owned.itemId)!.rarity, owned.itemId).not.toBe(TOP);
    }
  });

  /**
   * 초월은 도감 사다리(서식종 축)를 밀지 않는다 (2026-08-25 사용자 결정).
   *
   * 초월의 habitat은 최종 지역이지만 그 지역에서 잡을 수 없다. 지역·총합 집계에 넣으면
   * 서식종을 다 못 채운 유저가 "분화구 심장부 완전 정복"·"신대륙 도감의 완성"을 받는다.
   */
  describe('서식종 축 집계에서 분리된다', () => {
    const volcano = content.regionList[content.regionList.length - 1]!;
    /** 서식종 n종 + 초월 전 종을 포획한 세이브 */
    const saveWith = (nativeCount: number) => {
      const clock = makeCtx();
      const { save } = saveWithParty(clock, [{ id: 'dune-pup' }], { unlockAll: true });
      save.codex = {};
      const natives = content.nativeList.filter((m) => m.habitat === volcano.id).slice(0, nativeCount);
      for (const m of [...natives, ...content.transcendentList]) {
        save.codex[m.id] = { seen: true, captured: true, awakened: false, firstCapturedAt: T0 };
      }
      return save;
    };

    it('초월 3종은 지역·총합 집계에 잡히지 않는다', () => {
      // 15 = 최종 지역 서식 18종에서 초월 수(3)만큼 모자란 상태 — 초월이 새면 18로 보인다
      const counts = capturedCounts(content, saveWith(15));
      expect(counts.byRegion.get(volcano.id), `${volcano.name} 서식종`).toBe(15);
      expect(counts.total, '총합(서식종)').toBe(15);
      expect(counts.byRarity.get(TOP), '등급 집계는 초월을 센다').toBe(content.transcendentList.length);
    });

    it('서식종 15종 + 초월 3종으로는 "완전 정복"이 터지지 않는다', () => {
      const awarded = evaluateNewMilestones(content, saveWith(15));
      expect(awarded, '18 계단이 3종 모자란 채로 터지면 안 된다').not.toContain('crater-18');
      expect(awarded, '초월 축은 별개로 터진다').toContain('transcend-3');
    });

    it('서식종을 다 채우면 그때 터진다', () => {
      const natives = content.nativeList.filter((m) => m.habitat === volcano.id).length;
      expect(evaluateNewMilestones(content, saveWith(natives))).toContain('crater-18');
    });
  });

  it('초월 몬스터·유물은 최상위 스탯 대역을 가진다 (합성 보상이 체감되도록)', () => {
    const legendaryAtk = Math.max(...content.monsterList.filter((m) => m.rarity === 'legendary').map((m) => m.baseAtk));
    for (const m of content.monsterList.filter((x) => x.rarity === TOP)) {
      expect(m.baseAtk, m.id).toBeGreaterThan(legendaryAtk);
    }
    const legendaryMain = Math.max(...[...content.artifacts.values()].filter((a) => a.rarity === 'legendary').map((a) => a.main.base));
    for (const a of [...content.artifacts.values()].filter((x) => x.rarity === TOP)) {
      expect(a.main.base, a.id).toBeGreaterThan(legendaryMain);
    }
  });
});

/**
 * 초월 관문 — 분화구 심장부 해금 (2026-08-31 사용자 확정, docs/NEXT-GACHA-FAIRNESS.md §4).
 *
 * 구 규칙(2026-08-25~09-01)은 "최종 티어 서식 전설만 재료"였다 — 하위 권역 전설은 쓸 수도 합성할 수도
 * 분해할 수도 없는 사표였다. 완화하면서 관문을 지역 해금으로 옮겼는데, 초월 3종이 전부 분화구 서식이라
 * 관문이 분화구보다 앞이면 결과 풀 폴백이 미해금 초월 몬스터(CP 8,250대)를 화산(권장 4,500) 유저에게 내준다.
 * 아래가 그 구멍을 영구히 막는 그물이다.
 */
describe('초월 관문 — 분화구 심장부 해금 (2026-08-31 사용자)', () => {
  const fixedCtx = (seed: string): CoreCtx => ({ now: () => T0, newSeed: () => seed, newUid: () => 'u' });
  const gate = transcendGateRegion(content);
  const legendaries = content.monsterList.filter((m) => m.rarity === 'legendary');
  const okSeed = findSeed((s) => streamRng(s, 'fusion')() < content.balance.fusion.chance.legendary!);
  const failSeed = findSeed((s) => streamRng(s, 'fusion')() >= content.balance.fusion.chance.legendary!);
  /** 전설 1종 여분 2장(count 3) 세이브 — 첫 지역 외 해금은 인자로만 */
  const withSpares = (monsterId: string, unlocked: string[] = []) => {
    const { save } = saveWithParty(makeCtx(), [{ id: monsterId }]);
    save.roster[0]!.count = 3;
    for (const id of unlocked) save.profile.flags[regionFlagKey(id)] = true;
    return save;
  };
  const pair = (monsterId: string) => ({ materials: [{ monsterId, count: 2 }] });

  it('관문은 초월 종 서식지 중 가장 뒤 지역 = 분화구 심장부 = 마지막 지역이다', () => {
    // 규칙: 관문 = 초월 종 서식지 중 order 최대 (데이터 유도)
    const orders = content.transcendentList.map((m) => content.regions.get(m.habitat)!.order);
    expect(gate.order).toBe(Math.max(...orders));
    // 결정 기록 (2026-08-31 사용자): 지금은 그 지역이 분화구 심장부이고 마지막 지역이다. 관문을 정하는 것은 regionList가
    // 아니라 초월 종 habitat이므로, 새 권역(별빛 폐허 등)을 초월 종 없이 추가하면 관문은 여기 남고 아래 두 줄이 먼저 깨진다 —
    // 그때는 "관문을 새 권역으로 옮길지(초월 종 서식 추가)"를 사용자와 재확정한 뒤 이 값을 갱신한다. 조용히 어긋나지 않게 하는 가드다.
    expect(gate.id).toBe('crater-heart');
    expect(gate).toBe(content.regionList[content.regionList.length - 1]);
  });

  it('관문 미해금 — 어느 지역 전설 여분이든 거절한다 (관문 외 전 지역을 열어도, 전설 전 종 × 4시드 초월 0건)', () => {
    expect(legendaries.length, '전설이 있어야 검사가 의미 있다').toBeGreaterThan(0);
    // 관문 직전 상태 — 관문 외 전 지역(화산·협곡 = 구 규칙의 재료 서식 포함)을 열어도 분화구가 닫혀 있으면 관문이 막는다
    const partial = content.regionList.filter((r) => r.order < gate.order).map((r) => r.id);
    expect(partial, '구 규칙의 재료 서식(화산 권역)이 열린 상태여야 의미 있다').toContain('ashen-volcano');
    for (const legend of legendaries) {
      const save = withSpares(legend.id, partial);
      for (const seed of [okSeed, failSeed, 's1', 's2']) {
        let thrown: unknown;
        try {
          fuseMonsters(content, save, pair(legend.id), fixedCtx(seed));
        } catch (error) {
          thrown = error;
        }
        expect(thrown, `${legend.id} / ${seed}`).toBeInstanceOf(GameError);
        expect((thrown as GameError).code).toBe('fusion-region');
        expect((thrown as GameError).message).toContain(gate.name);
      }
    }
  });

  it('관문 해금 — 하위 지역 전설 여분 2장으로 도전 가능, 성공 시 해금 지역 서식 초월 종 획득', () => {
    const coast = withSpares('leviathan-calf', [gate.id]);
    const result = fuseMonsters(content, coast, pair('leviathan-calf'), fixedCtx(okSeed));
    expect(result.success).toBe(true);
    const got = content.monsters.get(result.resultMonsterId!)!;
    expect(got.rarity).toBe(TOP);
    expect(isRegionUnlocked(content, coast, got.habitat), '결과는 해금 지역 서식 — 폴백이 아니다').toBe(true);
    expect(result.isNew).toBe(true);
    expect(result.save.roster.find((m) => m.monsterId === 'leviathan-calf')!.count, '재료 2장 차감').toBe(1);
    expect(result.save.codex[got.id]!.captured).toBe(true);
  });

  it('관문 해금 — 다른 지역 전설 1장 + 1장을 섞어도 재료가 된다 (실패 시 1장 반환)', () => {
    const { save } = saveWithParty(makeCtx(), [{ id: 'coral-colossus' }, { id: 'sorrow-queen' }]); // 해안 + 늪
    save.roster.forEach((m) => { m.count = 2; });
    save.profile.flags[regionFlagKey(gate.id)] = true;
    const input = { materials: [{ monsterId: 'coral-colossus', count: 1 }, { monsterId: 'sorrow-queen', count: 1 }] };
    const result = fuseMonsters(content, save, input, fixedCtx(failSeed));
    expect(result.success).toBe(false);
    expect(['coral-colossus', 'sorrow-queen']).toContain(result.returnedMonsterId);
    const total = result.save.roster.reduce((sum, m) => sum + m.count, 0);
    expect(total, '4장 → 실소모 1장').toBe(3);
  });

  it('결과 풀 폴백 회귀 가드 — 관문까지 순차 해금하면 초월 전 종이 풀에 있다 (폴백이 발동할 여지 0)', () => {
    // transcendGateRegion의 전제(순차 해금)대로 관문 이하 전 지역을 연 세이브. 관문이 서식지 중 가장 늦은 곳이므로
    // 여기서 초월 전 종이 풀에 있어야 한다 — 관문 계산이 서식지 밖(finalTierEntry 등)으로 회귀하면 «관문 미해금» 테스트가
    // fusion-pool로 먼저 깨지고, 이 테스트는 "폴백이 필요한 상태가 애초에 없다"는 쪽을 고정한다
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }]);
    for (const r of content.regionList) if (r.order <= gate.order) save.profile.flags[regionFlagKey(r.id)] = true;
    const pool = content.transcendentList.filter((m) => isRegionUnlocked(content, save, m.habitat));
    expect(pool.length).toBe(content.transcendentList.length);
    // 200시드 성공 결과가 전부 해금 지역 서식 — 미해금 지역 초월 종은 한 번도 나오지 않는다
    for (let i = 0; i < 200; i++) {
      const coast = withSpares('ancient-whale', [gate.id]);
      const result = fuseMonsters(content, coast, pair('ancient-whale'), fixedCtx(`leak-${i}`));
      if (!result.success) continue;
      expect(isRegionUnlocked(content, coast, content.monsters.get(result.resultMonsterId!)!.habitat), `시드 leak-${i}`).toBe(true);
    }
  });

  it('이중 방어 — 관문이 열렸는데 결과 풀이 비면 폴백 대신 fusion-pool을 던진다 (정상 콘텐츠로는 도달 불가 — 가짜 콘텐츠로 강제)', () => {
    // 초월 종 서식지를 미해금 지역(화산)으로 옮긴 콘텐츠 사본. transcendentList(관문 계산)는 원본이라 관문은 분화구 그대로,
    // 결과 풀(monsterList)만 화산 서식이 된다 → 분화구만 해금한 세이브에서 관문은 통과하지만 풀이 빈다.
    // 전체 폴백이 살아 있었다면 여기서 화산 서식 초월 종이 그냥 나왔을 것이다
    const moved = content.monsterList.map((m) => (m.rarity === TOP ? { ...m, habitat: 'ashen-volcano' } : m));
    const fake: Content = { ...content, monsterList: moved, monsters: new Map(moved.map((m) => [m.id, m])) };
    const coast = withSpares('leviathan-calf', [gate.id]);
    let thrown: unknown;
    try {
      fuseMonsters(fake, coast, pair('leviathan-calf'), fixedCtx(okSeed));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GameError);
    expect((thrown as GameError).code).toBe('fusion-pool');
    // 같은 세이브·시드가 정상 콘텐츠에서는 성공한다 — 실패 원인이 가짜 콘텐츠의 빈 풀임을 고정
    expect(fuseMonsters(content, coast, pair('leviathan-calf'), fixedCtx(okSeed)).success).toBe(true);
  });

  it('유물 초월 관문은 화산 권역 진입 그대로 — 변경 없음 (몬스터와 다른 의도된 비대칭)', () => {
    const entry = finalTierEntry(content);
    expect(entry.id).toBe('ashen-volcano');
    expect(entry.id).not.toBe(gate.id);
    const legend = (content.artifactsByRarity.get('legendary') ?? [])[0]!;
    const { save } = saveWithParty(makeCtx(), [{ id: 'dune-pup' }], { artifacts: [legend.id] });
    save.artifacts[0]!.count = 3;
    const input = { materials: [{ itemId: legend.id, count: 2 }] };
    expect(() => fuseArtifacts(content, save, input, fixedCtx('s'))).toThrow(/권역을 해금/);
    save.profile.flags[regionFlagKey(entry.id)] = true; // 화산만 열어도(분화구 미해금) 유물 초월은 열린다
    expect(() => fuseArtifacts(content, save, input, fixedCtx('s'))).not.toThrow();
  });
});

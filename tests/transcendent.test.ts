/**
 * 초월 등급 격리 — 합성 외의 경로로는 절대 나오지 않는다 (2026-08-25 사용자 지시).
 *
 * 존재 이유: 확률 0은 조용하다. balance.json의 키 하나가 0에서 벗어나거나, 새 획득 경로가
 * 등급 배열을 무심코 순회하면 초월이 정찰에서 튀어나오고 아무 테스트도 빨개지지 않는다.
 * 여기가 그 그물이다.
 */
import { describe, expect, it } from 'vitest';
import { RARITIES, RARITY_ORDER } from '../src/content/schema';
import { evaluateNewMilestones, resolveExpedition } from '../src/core/expedition';
import { capturedCounts } from '../src/core/progression';
import { buyShopProduct } from '../src/core/shop';
import type { CoreCtx } from '../src/core/types';
import { T0, content, makeCtx, makeExpedition, saveWithParty } from './helpers';

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
    save.wallet.diamonds = 500_000;

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
   * 서식종을 다 못 채운 유저가 "잿빛 화산 완전 정복"·"신대륙 도감의 완성"을 받는다.
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
      const counts = capturedCounts(content, saveWith(51));
      expect(counts.byRegion.get(volcano.id), `${volcano.name} 서식종`).toBe(51);
      expect(counts.total, '총합(서식종)').toBe(51);
      expect(counts.byRarity.get(TOP), '등급 집계는 초월을 센다').toBe(content.transcendentList.length);
    });

    it('서식종 51종 + 초월 3종으로는 "완전 정복"이 터지지 않는다', () => {
      const awarded = evaluateNewMilestones(content, saveWith(51));
      expect(awarded, '54 계단이 3종 모자란 채로 터지면 안 된다').not.toContain('volcano-54');
      expect(awarded, '초월 축은 별개로 터진다').toContain('transcend-3');
    });

    it('서식종을 다 채우면 그때 터진다', () => {
      const natives = content.nativeList.filter((m) => m.habitat === volcano.id).length;
      expect(evaluateNewMilestones(content, saveWith(natives))).toContain('volcano-54');
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

/**
 * 상점 (GDD §9.4) — 골드/다이아 2관, 상품별 구매 한도(일일·1회·지역당 1회).
 * 뽑기는 시드 결정론('shop' 스트림), 일일 리셋은 로컬 자정 기준.
 */
import type { Content } from '../content';
import type { ArtifactRarity, MonsterRarity, ShopProduct } from '../content/schema';
import { RARITIES } from '../content/schema';
import { logDiamonds } from './diamondLog';
import { grantArtifact } from './effects';
import { evaluateNewMilestones, rollArtifactOfRarity } from './expedition';
import { isRegionUnlocked } from './progression';
import { pickWeighted, streamRng } from './rng';
import { GameError, type CoreCtx, type SaveState } from './types';

/** 일일 한도 기준일 — 기기 로컬 자정 리셋 */
export function todayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function purchasesToday(save: SaveState, productId: string, now: number): number {
  if (save.shop.day !== todayKey(now)) return 0; // 날짜가 바뀌면 아직 기록 리셋 전이어도 0으로 취급
  return save.shop.bought[productId] ?? 0;
}

export function onceBought(save: SaveState, product: ShopProduct): boolean {
  return save.shop.once.includes(product.id);
}

// ── 광고 연동 (GDD §9.2, 2026-08-29) ────────────────────────────────────────

/** 광고 제거 소유 — 보상형 광고 전부를 시청 없이 즉시 보상으로 (platform/ads.ts가 검사).
 *  플래그는 실결제(IAP)만 세운다 (platform/iap.ts → store.grantAdFree) — 출석 다이아로 못 사게
 *  다이아 상점 판매는 폐지 (2026-08-29 사용자). 세이브에 실려 클라우드로도 복원되고,
 *  재설치 시에는 부팅 IAP 소유 조회가 복원한다 */
export function hasAdFree(save: SaveState): boolean {
  return save.profile.flags['adFree'] === true;
}

/** 오늘 이 상품에 쓴 광고 연장 횟수 — counters.adUsed(로컬 자정 리셋, core/ads.ts와 공용 저장소) */
export function shopAdExtrasToday(save: SaveState, productId: string, now: number): number {
  if (save.counters.day !== todayKey(now)) return 0;
  return save.counters.adUsed[`shop:${productId}`] ?? 0;
}

/**
 * 광고 연장 — 골드관 일일 한도 상품의 오늘 한도를 +1 (상품당 balance.ads.shopExtraPerProduct회).
 * 광고 시청 성공 검증 후 호출된다 (platform/ads.ts → store.grantAdShopExtra)
 */
export function grantShopAdExtra(content: Content, save: SaveState, productId: string, now: number): SaveState {
  const product = content.shopProducts.find((p) => p.id === productId);
  if (!product) throw new GameError('shop-missing', `없는 상품: ${productId}`);
  if (product.shop !== 'gold' || product.limit.kind !== 'daily') {
    throw new GameError('shop-ad-extra', '광고 연장이 없는 상품입니다');
  }
  if (shopAdExtrasToday(save, productId, now) >= content.balance.ads.shopExtraPerProduct) {
    throw new GameError('ad-limit', '오늘은 더 연장할 수 없습니다 — 내일 다시!');
  }
  const next = structuredClone(save);
  const today = todayKey(now);
  if (next.counters.day !== today) next.counters = { day: today, adUsed: {} };
  next.counters.adUsed[`shop:${productId}`] = (next.counters.adUsed[`shop:${productId}`] ?? 0) + 1;
  return next;
}

export interface ShopBuyInput {
  productId: string;
}

export interface ShopBuyResult {
  save: SaveState;
  product: ShopProduct;
  granted: {
    gold?: number;
    dust?: number;
    lures?: number;
    materials?: { materialId: string; count: number }[];
    monsterId?: string; // 단발 뽑기 호환 필드 (count=1일 때만) — monsters[0]과 동일
    isNewMonster?: boolean;
    monsters?: { monsterId: string; isNew: boolean }[]; // 뽑기 결과 — ×10 포함, 뽑은 순서대로
    artifactItemId?: string; // 단발 발굴 호환 필드 (count=1일 때만) — artifacts[0]과 동일
    artifacts?: string[]; // 발굴 결과 itemId — ×10 포함, 뽑은 순서대로
    hourglass?: { hourglassId: string; count: number };
  };
  newMilestones: string[]; // 뽑기 신규 등록으로 달성된 마일스톤
}

export function buyShopProduct(content: Content, save: SaveState, input: ShopBuyInput, ctx: CoreCtx): ShopBuyResult {
  const product = content.shopProducts.find((p) => p.id === input.productId);
  if (!product) throw new GameError('shop-missing', `없는 상품: ${input.productId}`);
  const now = ctx.now();

  // ── 한도 검증 — none은 무제한 (2026-08-23 다이아 상점). 골드관은 광고 연장분 합산 ──
  if (product.limit.kind === 'daily') {
    const extra = product.shop === 'gold' ? shopAdExtrasToday(save, product.id, now) : 0;
    if (purchasesToday(save, product.id, now) >= product.limit.count + extra) {
      throw new GameError('shop-limit', '오늘 구매 한도를 모두 사용했습니다');
    }
  } else if (product.limit.kind === 'once' && onceBought(save, product)) {
    throw new GameError('shop-once', '이미 구매한 상품입니다');
  }

  const next = structuredClone(save);

  // ── 재화 차감 ──
  if (product.shop === 'gold') {
    if (next.wallet.gold < product.price) throw new GameError('gold-short', `골드가 부족합니다 (필요: ${product.price})`);
    next.wallet.gold -= product.price;
  } else {
    if (next.wallet.diamonds < product.price) throw new GameError('diamond-short', `다이아가 부족합니다 (필요: ${product.price})`);
    next.wallet.diamonds -= product.price;
    logDiamonds(next, -product.price, `shop:${product.id}`, now); // 원장 (v14) — 가격 조작 감사 근거
  }

  // ── 지급 ──
  const granted: ShopBuyResult['granted'] = {};
  let newMilestones: string[] = [];
  const goods = product.goods;
  const rng = streamRng(ctx.newSeed(), 'shop');

  if (goods.kind === 'bundle') {
    next.wallet.gold += goods.gold;
    next.wallet.dust += goods.dust;
    next.wallet.lures += goods.lures;
    if (goods.gold > 0) granted.gold = goods.gold;
    if (goods.dust > 0) granted.dust = goods.dust;
    if (goods.lures > 0) granted.lures = goods.lures;
  } else if (goods.kind === 'materialsAll') {
    // 해금한 모든 지역의 재료를 각 n개 (+골드) — 지역 선택 없음 (2026-08-23)
    // 같은 티어의 소지역 3개는 재료 풀을 공유한다 (2026-08-26 12지역) — 지역이 아니라
    // 재료 종 단위로 지급해야 티어를 다 연 유저가 3배로 받는 사고가 없다
    granted.materials = [];
    const grantedIds = new Set<string>();
    for (const unlockedRegion of content.regionList) {
      if (!isRegionUnlocked(content, next, unlockedRegion.id)) continue;
      for (const materialId of unlockedRegion.materials) {
        if (grantedIds.has(materialId)) continue;
        grantedIds.add(materialId);
        next.wallet.materials[materialId] = (next.wallet.materials[materialId] ?? 0) + goods.countEach;
        granted.materials.push({ materialId, count: goods.countEach });
      }
    }
    if (goods.gold > 0) {
      next.wallet.gold += goods.gold;
      granted.gold = goods.gold;
    }
  } else if (goods.kind === 'monsterGacha') {
    const table = content.balance.shop.monsterGacha[goods.table]!;
    // 해금 지역에 실제로 존재하는 등급만 후보 (전 지역 미해금 방어로 전체 폴백)
    const poolOf = (rarity: MonsterRarity) => {
      const unlocked = content.monsterList.filter((m) => m.rarity === rarity && isRegionUnlocked(content, next, m.habitat));
      return unlocked.length > 0 ? unlocked : content.monsterList.filter((m) => m.rarity === rarity);
    };
    const candidates = RARITIES.filter((rarity) => (table[rarity] ?? 0) > 0 && poolOf(rarity).length > 0);
    // count장 연속 뽑기 (10연) — 같은 종이 겹치면 첫 장만 신규, 나머지는 카드 수 누적
    granted.monsters = [];
    for (let i = 0; i < goods.count; i++) {
      const rarity = pickWeighted(rng, candidates, (r) => table[r] ?? 0);
      const pool = poolOf(rarity);
      const picked = pool[Math.floor(rng() * pool.length)]!;
      const owned = next.roster.find((m) => m.monsterId === picked.id);
      let isNew = false;
      if (owned) {
        owned.count += 1;
      } else {
        isNew = true;
        next.roster.push({ monsterId: picked.id, level: 1, star: 1, count: 1 });
        const entry = next.codex[picked.id] ?? { seen: false, captured: false, awakened: false };
        entry.seen = true;
        if (!entry.captured) {
          entry.captured = true;
          entry.firstCapturedAt = now;
        }
        next.codex[picked.id] = entry;
      }
      granted.monsters.push({ monsterId: picked.id, isNew });
    }
    if (goods.count === 1) {
      granted.monsterId = granted.monsters[0]!.monsterId;
      if (granted.monsters[0]!.isNew) granted.isNewMonster = true;
    }
    // 마일스톤은 전 장 등록 후 일괄 평가 — 10연 중간 달성도 한 번에 잡힌다
    if (granted.monsters.some((m) => m.isNew)) {
      newMilestones = evaluateNewMilestones(content, next);
      for (const id of newMilestones) {
        next.milestones.push(id);
        const milestone = content.milestones.find((m) => m.id === id)!;
        next.wallet.gold += milestone.reward.gold ?? 0;
        next.wallet.dust += milestone.reward.dust ?? 0;
      }
    }
  } else if (goods.kind === 'artifactGacha') {
    const table = content.balance.shop.artifactGacha[goods.table]!;
    const candidates = RARITIES.filter((rarity) => (table[rarity] ?? 0) > 0);
    granted.artifacts = [];
    for (let i = 0; i < goods.count; i++) {
      const rarity: ArtifactRarity = pickWeighted(rng, candidates, (r) => table[r] ?? 0);
      const drop = rollArtifactOfRarity(content, rng, rarity);
      grantArtifact(next, drop.itemId);
      granted.artifacts.push(drop.itemId);
    }
    if (goods.count === 1) granted.artifactItemId = granted.artifacts[0];
  } else {
    // hourglass — rush(즉시 귀환) 폐지 후 가속은 모래시계로 일원화 (2026-08-23)
    next.wallet.hourglasses[goods.hourglassId] = (next.wallet.hourglasses[goods.hourglassId] ?? 0) + goods.count;
    granted.hourglass = { hourglassId: goods.hourglassId, count: goods.count };
  }

  // ── 구매 기록 — none은 기록 없음 ──
  const today = todayKey(now);
  if (next.shop.day !== today) {
    next.shop.day = today;
    next.shop.bought = {};
  }
  if (product.limit.kind === 'daily') {
    next.shop.bought[product.id] = (next.shop.bought[product.id] ?? 0) + 1;
  } else if (product.limit.kind === 'once') {
    next.shop.once.push(product.id);
  }

  return { save: next, product, granted, newMilestones };
}

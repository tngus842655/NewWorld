/**
 * 상점 (GDD §9.4) — 골드/다이아 2관, 상품별 구매 한도(일일·1회·지역당 1회).
 * 뽑기는 시드 결정론('shop' 스트림), 일일 리셋은 로컬 자정 기준.
 */
import type { Content } from '../content';
import type { ArtifactRarity, MonsterRarity, ShopProduct } from '../content/schema';
import { RARITIES } from '../content/schema';
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

export function onceBought(save: SaveState, product: ShopProduct, regionId?: string): boolean {
  const key = product.limit.kind === 'oncePerRegion' ? `${product.id}:${regionId}` : product.id;
  return save.shop.once.includes(key);
}

export interface ShopBuyInput {
  productId: string;
  regionId?: string; // materials·regionPack — 해금 지역 선택
  expeditionId?: string; // rush — 생략 시 남은 시간이 가장 긴 원정
}

export interface ShopBuyResult {
  save: SaveState;
  product: ShopProduct;
  granted: {
    gold?: number;
    dust?: number;
    lures?: number;
    materials?: { materialId: string; count: number }[];
    monsterId?: string;
    isNewMonster?: boolean;
    artifactItemId?: string;
    rushedExpeditionId?: string;
  };
  newMilestones: string[]; // 뽑기 신규 등록으로 달성된 마일스톤
}

export function buyShopProduct(content: Content, save: SaveState, input: ShopBuyInput, ctx: CoreCtx): ShopBuyResult {
  const product = content.shopProducts.find((p) => p.id === input.productId);
  if (!product) throw new GameError('shop-missing', `없는 상품: ${input.productId}`);
  const now = ctx.now();

  // ── 한도 검증 ──
  if (product.limit.kind === 'daily') {
    if (purchasesToday(save, product.id, now) >= product.limit.count) {
      throw new GameError('shop-limit', '오늘 구매 한도를 모두 사용했습니다');
    }
  } else if (onceBought(save, product, input.regionId)) {
    throw new GameError('shop-once', product.limit.kind === 'once' ? '이미 구매한 상품입니다' : '이 지역에서는 이미 구매했습니다');
  }

  // ── 지역 인자 검증 ──
  const needsRegion = product.goods.kind === 'materials' || product.goods.kind === 'regionPack' || product.limit.kind === 'oncePerRegion';
  const region = needsRegion ? content.regions.get(input.regionId ?? '') : undefined;
  if (needsRegion) {
    if (!region) throw new GameError('shop-region', '지역을 선택해 주세요');
    if (!isRegionUnlocked(content, save, region.id)) throw new GameError('shop-region-locked', '해금한 지역만 선택할 수 있습니다');
  }

  const next = structuredClone(save);

  // ── 재화 차감 ──
  if (product.shop === 'gold') {
    if (next.wallet.gold < product.price) throw new GameError('gold-short', `골드가 부족합니다 (필요: ${product.price})`);
    next.wallet.gold -= product.price;
  } else {
    if (next.wallet.diamonds < product.price) throw new GameError('diamond-short', `다이아가 부족합니다 (필요: ${product.price})`);
    next.wallet.diamonds -= product.price;
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
  } else if (goods.kind === 'materials' || goods.kind === 'regionPack') {
    const each = goods.kind === 'materials' ? goods.countEach : goods.materialsEach;
    granted.materials = region!.materials.map((materialId) => {
      next.wallet.materials[materialId] = (next.wallet.materials[materialId] ?? 0) + each;
      return { materialId, count: each };
    });
    if (goods.kind === 'regionPack' && goods.gold > 0) {
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
    const rarity = pickWeighted(rng, candidates, (r) => table[r] ?? 0);
    const pool = poolOf(rarity);
    const picked = pool[Math.floor(rng() * pool.length)]!;
    granted.monsterId = picked.id;

    const owned = next.roster.find((m) => m.monsterId === picked.id);
    if (owned) {
      owned.count += 1;
    } else {
      granted.isNewMonster = true;
      next.roster.push({ monsterId: picked.id, level: 1, star: 1, count: 1 });
      const entry = next.codex[picked.id] ?? { seen: false, captured: false, awakened: false };
      entry.seen = true;
      if (!entry.captured) {
        entry.captured = true;
        entry.firstCapturedAt = now;
      }
      next.codex[picked.id] = entry;
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
    const rarity: ArtifactRarity = pickWeighted(rng, candidates, (r) => table[r] ?? 0);
    const drop = rollArtifactOfRarity(content, rng, rarity);
    next.artifacts.push({ uid: ctx.newUid(), itemId: drop.itemId, enhance: 0, substats: [...drop.substats] });
    granted.artifactItemId = drop.itemId;
  } else {
    // rush — 대상 미지정 시 남은 시간이 가장 긴 원정 (가치 최대 기본값)
    const running = next.expeditions.filter((e) => !e.claimed && e.endsAt > now);
    const target = input.expeditionId
      ? running.find((e) => e.id === input.expeditionId)
      : [...running].sort((a, b) => b.endsAt - a.endsAt)[0];
    if (!target) throw new GameError('shop-rush', '단축할 진행 중 원정이 없습니다');
    target.endsAt = now;
    granted.rushedExpeditionId = target.id;
  }

  // ── 구매 기록 ──
  const today = todayKey(now);
  if (next.shop.day !== today) {
    next.shop.day = today;
    next.shop.bought = {};
  }
  if (product.limit.kind === 'daily') {
    next.shop.bought[product.id] = (next.shop.bought[product.id] ?? 0) + 1;
  } else {
    next.shop.once.push(product.limit.kind === 'oncePerRegion' ? `${product.id}:${region!.id}` : product.id);
  }

  return { save: next, product, granted, newMilestones };
}

/**
 * 상점 시트 (GDD §9.4) — 골드/다이아 2관, 상품별 구매 한도 표시. 상단바 🏪에서 전체 화면으로.
 * 다이아 충전(IAP)은 M6 — 그 전까지 획득처는 출석 이벤트 예정.
 */
import { content } from '../content';
import type { Region, ShopProduct } from '../content/schema';
import { onceBought, purchasesToday, todayKey } from '../core/shop';
import { isRegionUnlocked } from '../core/progression';
import { signal } from '../state/signal';
import { buyShop, nowTick, save } from '../state/store';
import { hourglassIcon } from './components';
import { askConfirm } from './dialog';
import { MONSTER_RARITY_LABEL, ARTIFACT_RARITY_LABEL, el, fmtGold, fmtRemain, toast } from './kit';
import { sheetShell } from './overlays';
import { playSfx } from './sfx';

type ShopTab = 'gold' | 'diamond';
const shopTab = signal<ShopTab>('gold');
const shopRegion = signal<string>(content.regionList[0]!.id);

/** 상점을 열 때 초기화 — 지역 선택은 마지막 해금 지역으로 */
export function resetShop(): void {
  shopTab.set('gold');
  const state = save();
  const unlocked = content.regionList.filter((region) => isRegionUnlocked(content, state, region.id));
  shopRegion.set(unlocked[unlocked.length - 1]!.id);
}

function priceTag(product: ShopProduct): string {
  return product.shop === 'gold' ? `💰 ${fmtGold(product.price)}` : `💎 ${product.price}`;
}

/** 구매 실행 — 확인창 → 액션 → 결과 안내 */
function purchase(product: ShopProduct): void {
  const state = save();
  const regionId = shopRegion();
  const regionName = content.regions.get(regionId)?.name ?? '';
  const needsRegion = product.goods.kind === 'regionPack';
  void askConfirm({
    title: `${product.icon} ${product.name}`,
    message: `${priceTag(product)}로 구매합니다.\n${needsRegion ? `대상 지역: ${regionName}\n` : ''}${product.desc}`,
    confirmLabel: '구매',
  }).then((ok) => {
    if (!ok) return;
    const result = buyShop({ productId: product.id, regionId });
    if (!result) return;
    const { granted } = result;

    if (granted.monsterId) {
      const monster = content.monsters.get(granted.monsterId)!;
      playSfx(granted.isNewMonster ? 'capture-new' : 'treasure');
      toast(`🃏 [${MONSTER_RARITY_LABEL[monster.rarity]}] ${monster.name} 카드 획득!${granted.isNewMonster ? ' ✨ 도감 신규!' : ''}`, 'ok');
    } else if (granted.artifactItemId) {
      const def = content.artifacts.get(granted.artifactItemId)!;
      playSfx('artifact');
      toast(`🏺 [${ARTIFACT_RARITY_LABEL[def.rarity]}] ${def.name} 획득!`, 'ok');
    } else if (granted.rushedExpeditionId) {
      playSfx('confirm');
      toast('⏩ 원정대가 즉시 귀환했습니다 — 홈에서 일지를 여세요', 'ok');
    } else if (product.goods.kind === 'materialsAll') {
      // 해금 지역이 많으면 재료 나열이 길어진다 — 종 수만 요약
      playSfx('treasure');
      toast(`${product.icon} 해금 지역 재료 ${granted.materials?.length ?? 0}종을 각 ${product.goods.countEach}개씩 획득!`, 'ok');
    } else if (granted.hourglass) {
      const def = content.hourglasses.get(granted.hourglass.hourglassId)!;
      playSfx('treasure');
      toast(`⏳ ${def.name} ×${granted.hourglass.count} 획득 — 원정 카드의 가속 버튼으로 사용`, 'ok');
    } else {
      const parts = [
        granted.gold ? `골드 ${fmtGold(granted.gold)}` : null,
        granted.dust ? `가루 ${granted.dust}` : null,
        granted.lures ? `미끼 ${granted.lures}` : null,
        ...(granted.materials ?? []).map((m) => `${content.materials.get(m.materialId)?.icon ?? ''}${content.materials.get(m.materialId)?.name} ×${m.count}`),
      ].filter(Boolean).join(' · ');
      playSfx('treasure');
      toast(`${product.icon} ${parts} 획득!`, 'ok');
    }
    for (const id of result.newMilestones) {
      const milestone = content.milestones.find((m) => m.id === id);
      if (milestone) toast(`🏅 마일스톤 달성: ${milestone.name}`, 'ok');
    }
  });
}

function productCard(product: ShopProduct, unlockedRegions: Region[]): HTMLElement {
  const state = save();
  const now = nowTick();
  const regionId = shopRegion();

  // 한도 상태 — 이름 옆 (n/m)으로 표시, 버튼 영역은 버튼만 (2026-08-23 사용자)
  let limitLabel = '';
  let exhausted = false;
  if (product.limit.kind === 'daily') {
    const used = purchasesToday(state, product.id, now);
    limitLabel = `${used}/${product.limit.count}`;
    exhausted = used >= product.limit.count;
  } else if (product.limit.kind === 'once') {
    exhausted = onceBought(state, product);
    limitLabel = `${exhausted ? 1 : 0}/1`;
  } else {
    exhausted = onceBought(state, product, regionId);
    limitLabel = `${exhausted ? 1 : 0}/1`; // 선택된 지역 기준
  }

  const shortFunds = product.shop === 'gold' ? state.wallet.gold < product.price : state.wallet.diamonds < product.price;

  // rush — 진행 중 원정이 있어야
  const running = state.expeditions.filter((e) => !e.claimed && e.endsAt > now);
  const rushTarget = product.goods.kind === 'rush'
    ? [...running].sort((a, b) => b.endsAt - a.endsAt)[0]
    : undefined;
  const rushUnavailable = product.goods.kind === 'rush' && !rushTarget;

  // 모래시계 — 가속 시트와 동일하게 등급색 테두리 타일로 (라벨 없이 색으로만 구분)
  const hourglass = product.goods.kind === 'hourglass' ? content.hourglasses.get(product.goods.hourglassId) : undefined;

  const needsRegion = product.goods.kind === 'regionPack';
  const regionChips = needsRegion
    ? el('div.chips-wrap', {}, ...unlockedRegions.map((region) => {
        const bought = product.limit.kind === 'oncePerRegion' && onceBought(state, product, region.id);
        return el(`button.chip${regionId === region.id ? '.active' : ''}`, {
          onclick: () => shopRegion.set(region.id),
        }, `${region.icon} ${region.name}${bought ? ' ✅' : ''}`);
      }))
    : null;

  return el('div.card.stack-sm.shop-item', {},
    el('div.list-row', {},
      el('div', {},
        // 모래시계는 이모지 대신 등급 테두리 미니 아이콘 — 다른 상품 이모지와 같은 줄 높이
        hourglass
          ? el('div.shop-name.hg-name', {}, hourglassIcon(hourglass, { small: true }), product.name,
              el('span.muted.small.shop-limit', {}, `(${limitLabel})`))
          : el('div.shop-name', {}, `${product.icon} ${product.name} `,
              el('span.muted.small.shop-limit', {}, `(${limitLabel})`)),
        el('div.muted.small', {}, product.desc),
        rushTarget
          ? el('div.muted.small', {}, `대상: ${content.regions.get(rushTarget.regionId)?.name} (남은 ${fmtRemain(rushTarget.endsAt - now)})`)
          : null,
      ),
      el('div.shop-buy', {},
        el('button.btn.btn-primary', {
          disabled: exhausted || shortFunds || rushUnavailable,
          onclick: () => purchase(product),
        }, exhausted ? '한도 소진' : rushUnavailable ? '원정 없음' : priceTag(product)),
      ),
    ),
    regionChips,
  );
}

export function shopSheet(): HTMLElement {
  const state = save();
  const tab = shopTab();
  const unlockedRegions = content.regionList.filter((region) => isRegionUnlocked(content, state, region.id));
  const products = content.shopProducts.filter((product) => product.shop === tab);

  const shell = sheetShell('🏪 상점',
    el('div.card.list-row', {},
      el('span', {}, `💰 ${fmtGold(state.wallet.gold)}  ·  💎 ${state.wallet.diamonds}`),
      el('button.btn.btn-ghost', {
        onclick: () => toast('💎 충전은 정식 출시 후 제공됩니다 — 그 전엔 출석 이벤트로 모을 수 있어요 (준비 중)', 'ok'),
      }, '충전'),
    ),
    el('div.chips-wrap', {},
      el(`button.chip${tab === 'gold' ? '.active' : ''}`, { onclick: () => { playSfx('tap'); shopTab.set('gold'); } }, '💰 골드 상점'),
      el(`button.chip${tab === 'diamond' ? '.active' : ''}`, { onclick: () => { playSfx('tap'); shopTab.set('diamond'); } }, '💎 다이아 상점'),
    ),
    ...products.map((product) => productCard(product, unlockedRegions)),
    el('div.center.small.muted', {}, `구매 한도는 매일 자정에 초기화됩니다 (오늘: ${todayKey(nowTick())})`),
  );
  shell.classList.add('sheet-full');
  return shell;
}

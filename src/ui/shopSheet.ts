/**
 * 상점 시트 (GDD §9.4) — 골드/다이아 2관. 상단바 🏪에서 전체 화면으로.
 * 골드관은 일일 한도, 다이아관은 무제한(none) — 한도는 이름 옆 (n/m)으로 표시 (2026-08-23).
 * 다이아 충전(IAP)은 M6 — 그 전까지 획득처는 출석 이벤트 예정.
 */
import { content } from '../content';
import type { ShopProduct } from '../content/schema';
import { onceBought, purchasesToday, todayKey } from '../core/shop';
import { signal } from '../state/signal';
import { buyShop, devGrantDiamonds, nowTick, save } from '../state/store';
import { hourglassIcon } from './components';
import { askConfirm } from './dialog';
import { MONSTER_RARITY_LABEL, ARTIFACT_RARITY_LABEL, el, fmtGold, toast } from './kit';
import { sheetShell } from './overlays';
import { playSfx } from './sfx';

type ShopTab = 'gold' | 'diamond';
const shopTab = signal<ShopTab>('gold');

/** 상점을 열 때 초기화 */
export function resetShop(): void {
  shopTab.set('gold');
}

function priceTag(product: ShopProduct): string {
  return product.shop === 'gold' ? `💰 ${fmtGold(product.price)}` : `💎 ${product.price}`;
}

/** 구매 실행 — 확인창 → 액션 → 결과 안내 */
function purchase(product: ShopProduct): void {
  void askConfirm({
    title: `${product.icon} ${product.name}`,
    message: `${priceTag(product)}로 구매합니다.\n${product.desc}`,
    confirmLabel: '구매',
  }).then((ok) => {
    if (!ok) return;
    const result = buyShop({ productId: product.id });
    if (!result) return;
    const { granted } = result;

    if (granted.monsterId) {
      const monster = content.monsters.get(granted.monsterId)!;
      playSfx(granted.isNewMonster ? 'capture-new' : 'treasure');
      toast(`🃏 [${MONSTER_RARITY_LABEL[monster.rarity]}] ${monster.name} 카드 획득!${granted.isNewMonster ? ' ✨ 도감 신규!' : ''}`, 'ok', { rarity: monster.rarity });
    } else if (granted.artifactItemId) {
      const def = content.artifacts.get(granted.artifactItemId)!;
      playSfx('artifact');
      toast(`🏺 [${ARTIFACT_RARITY_LABEL[def.rarity]}] ${def.name} 획득!`, 'ok', { rarity: def.rarity });
    } else if (product.goods.kind === 'materialsAll') {
      // 해금 지역이 많으면 재료 나열이 길어진다 — 종 수만 요약 (+골드는 병기)
      playSfx('treasure');
      const goldTail = granted.gold ? ` + 골드 ${fmtGold(granted.gold)}` : '';
      toast(`${product.icon} 해금 지역 재료 ${granted.materials?.length ?? 0}종 각 ${product.goods.countEach}개${goldTail} 획득!`, 'ok');
    } else if (granted.hourglass) {
      const def = content.hourglasses.get(granted.hourglass.hourglassId)!;
      playSfx('treasure');
      toast(`⏳ ${def.name} ×${granted.hourglass.count} 획득!`, 'ok');
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

/** 한도·잔액 상태 — 카드/타일 공용 */
function productState(product: ShopProduct) {
  const state = save();
  const now = nowTick();
  let limitLabel: string | null = null;
  let exhausted = false;
  if (product.limit.kind === 'daily') {
    const used = purchasesToday(state, product.id, now);
    limitLabel = `${used}/${product.limit.count}`;
    exhausted = used >= product.limit.count;
  } else if (product.limit.kind === 'once') {
    exhausted = onceBought(state, product);
    limitLabel = `${exhausted ? 1 : 0}/1`;
  }
  const shortFunds = product.shop === 'gold' ? state.wallet.gold < product.price : state.wallet.diamonds < product.price;
  return { limitLabel, exhausted, shortFunds };
}

function buyButton(product: ShopProduct, exhausted: boolean, shortFunds: boolean): HTMLElement {
  return el('button.btn.btn-primary', {
    disabled: exhausted || shortFunds,
    onclick: () => purchase(product),
  }, exhausted ? '한도 소진' : priceTag(product));
}

function productCard(product: ShopProduct): HTMLElement {
  const { limitLabel, exhausted, shortFunds } = productState(product);
  const limitTag = limitLabel !== null ? el('span.muted.small.shop-limit', {}, `(${limitLabel})`) : null;

  return el('div.card.stack-sm.shop-item', {},
    el('div.list-row', {},
      el('div', {},
        el('div.shop-name', {}, `${product.icon} ${product.name} `, limitTag),
        el('div.muted.small', {}, product.desc),
      ),
      el('div.shop-buy', {}, buyButton(product, exhausted, shortFunds)),
    ),
  );
}

/** 모래시계 압축 타일 — 2열 그리드용. 등급색 테두리 아이콘으로 구분 (라벨 없이 색으로만) */
function hourglassTile(product: ShopProduct): HTMLElement {
  const { limitLabel, exhausted, shortFunds } = productState(product);
  const def = product.goods.kind === 'hourglass' ? content.hourglasses.get(product.goods.hourglassId) : undefined;
  const limitTag = limitLabel !== null ? el('span.muted.small.shop-limit', {}, `(${limitLabel})`) : null;

  return el('div.card.shop-tile', {},
    el('div.shop-tile-name', {},
      def ? hourglassIcon(def, { small: true }) : product.icon,
      el('span', {}, product.name), limitTag,
    ),
    el('div.muted.small', {}, product.desc),
    buyButton(product, exhausted, shortFunds),
  );
}

// 상품 구간 — goods 종류로 분류해 탭 안을 3구간으로 (2026-08-24 가독성 개편)
const SHOP_GROUPS: { label: string; kinds: ShopProduct['goods']['kind'][] }[] = [
  { label: '🎲 뽑기·발굴', kinds: ['monsterGacha', 'artifactGacha'] },
  { label: '🎁 꾸러미·재화', kinds: ['bundle', 'materialsAll'] },
  { label: '⏳ 원정 가속', kinds: ['hourglass'] },
];

export function shopSheet(): HTMLElement {
  const state = save();
  const tab = shopTab();
  const products = content.shopProducts.filter((product) => product.shop === tab);

  const groupBlocks = SHOP_GROUPS.flatMap((group) => {
    const members = products.filter((product) => group.kinds.includes(product.goods.kind));
    if (members.length === 0) return [];
    const body = group.kinds.includes('hourglass')
      ? [el('div.shop-grid', {}, ...members.map((product) => hourglassTile(product)))]
      : members.map((product) => productCard(product));
    return [
      el('div.info-group-head', {},
        el('span.small', {}, group.label),
        el('span.muted.small', {}, `${members.length}종`),
      ),
      ...body,
    ];
  });

  const shell = sheetShell('🏪 상점',
    el('div.card.list-row', {},
      el('span', {}, `💰 ${fmtGold(state.wallet.gold)}  ·  💎 ${state.wallet.diamonds}`),
      el('div.row-gap', {},
        import.meta.env.DEV
          ? el('button.btn.btn-ghost', { onclick: devGrantDiamonds }, 'DEV [1000]')
          : null,
        el('button.btn.btn-ghost', {
          onclick: () => toast('💎 충전은 정식 출시 후 제공됩니다 [그 전엔 출석 이벤트로 모을 수 있어요]', 'ok'),
        }, '충전'),
      ),
    ),
    el('div.big-tabs', {},
      el(`button.big-tab${tab === 'gold' ? '.active' : ''}`, { onclick: () => { playSfx('tap'); shopTab.set('gold'); } }, '💰 골드 상점'),
      el(`button.big-tab${tab === 'diamond' ? '.active' : ''}`, { onclick: () => { playSfx('tap'); shopTab.set('diamond'); } }, '💎 다이아 상점'),
    ),
    ...groupBlocks,
    tab === 'gold'
      ? el('div.center.small.muted', {}, `구매 한도는 매일 자정에 초기화됩니다 (오늘: ${todayKey(nowTick())})`)
      : null,
  );
  shell.classList.add('sheet-full');
  return shell;
}

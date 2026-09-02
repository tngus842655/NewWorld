/**
 * 상점 시트 (GDD §9.4) — 골드/다이아 2관. 상단바 🏪에서 전체 화면으로.
 * 골드관은 일일 한도, 다이아관은 무제한(none) — 한도는 이름 옆 (n/m)으로 표시 (2026-08-23).
 * 다이아 충전(IAP)은 M6 — 그 전까지 획득처는 출석 이벤트 예정.
 */
import { content } from '../content';
import type { ShopProduct } from '../content/schema';
import { onceBought, purchasesToday, shopAdExtrasToday, todayKey } from '../core/shop';
import { adsAvailable, showRewardedAd } from '../platform/ads';
import { adFreeIap, diamondPacks } from '../platform/iap';
import { signal } from '../state/signal';
import { buyShop, grantAdShopExtra, nowTick, save } from '../state/store';
import { flushUpload } from '../state/cloudSync';
import { hourglassIcon, uiIcon } from './components';
import { askConfirm } from './dialog';
import { showGachaReveal } from './gachaReveal';
import { el, fmtGold, fmtNum, toast } from './kit';
import { sheetShell } from './overlays';
import { overlay } from './router';
import { playSfx } from './sfx';

type ShopTab = 'gold' | 'diamond';
const shopTab = signal<ShopTab>('gold');
const adBusy = signal(false); // 광고 로드 중 — 연장 버튼 잠금

/** 상점을 열 때 초기화 */
export function resetShop(): void {
  shopTab.set('gold');
}

function priceTag(product: ShopProduct): string {
  return product.shop === 'gold' ? `💰 ${fmtGold(product.price)}` : `💎 ${fmtNum(product.price)}`;
}

/**
 * "해금 지역 한정" 고지 (2026-09-02, GDD §9.4) — 확률 정보 시트(overlays.ts 상점 뽑기 탭)와 같은 표현.
 * 뽑기는 등급을 먼저 굴리므로 재화 대비 등급 품질은 해금 수와 무관하게 같지만, 후반부는 전설 풀이
 * 최대 24종으로 희석돼 "지금 쓸 전설"이 잘 안 나온다. 유저가 이를 형평성 문제로 의심하는 지점이 상점 화면이었다.
 */
const GACHA_POOL_NOTE = '몬스터 뽑기는 해금한 지역의 몬스터 중에서, 유물 발굴은 전체 유물 중에서 나옵니다';
const MONSTER_GACHA_POOL_NOTE = '해금한 지역의 몬스터 중에서 나옵니다';

/** 구매 실행 — 확인창 → 액션 → 결과 안내 (뽑기·발굴은 리빌 연출, 나머지는 토스트) */
function purchase(product: ShopProduct): void {
  // 몬스터 뽑기는 구매 확인창에도 해금 지역 한정을 한 줄 더 — 돈이 나가는 마지막 지점 (2026-09-02)
  const poolLine = product.goods.kind === 'monsterGacha' ? `\n${MONSTER_GACHA_POOL_NOTE}` : '';
  void askConfirm({
    title: `${product.icon} ${product.name}`,
    message: `${priceTag(product)}로 구매합니다.\n${product.desc}${poolLine}`,
    confirmLabel: '구매',
  }).then((ok) => {
    if (!ok) return;
    const result = buyShop({ productId: product.id });
    if (!result) return;
    flushUpload(); // 뽑기 결과 확정 즉시 서버 반영 — '불러오기' 세이브 스컴 차단
    const { granted } = result;
    // 마일스톤 알림 — 뽑기는 리빌이 닫힌 뒤에 (연출 위로 토스트가 겹치지 않게)
    const milestoneToasts = () => {
      for (const id of result.newMilestones) {
        const milestone = content.milestones.find((m) => m.id === id);
        if (milestone) toast(`🏅 마일스톤 달성: ${milestone.name}`, 'ok');
      }
    };

    if (granted.monsters) {
      void showGachaReveal({ kind: 'monster', results: granted.monsters }).then(milestoneToasts);
      return;
    }
    if (granted.artifacts) {
      void showGachaReveal({ kind: 'artifact', itemIds: granted.artifacts }).then(milestoneToasts);
      return;
    }

    if (product.goods.kind === 'materialsAll') {
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
    milestoneToasts();
  });
}

/** 한도·잔액 상태 — 카드/타일 공용. 골드관 일일 한도는 광고 연장분(+1/광고)을 합산해 보여준다 */
function productState(product: ShopProduct) {
  const state = save();
  const now = nowTick();
  let limitLabel: string | null = null;
  let exhausted = false;
  let adExtraOpen = false; // 한도 소진 + 오늘 연장 여유 있음 → 📺 버튼
  if (product.limit.kind === 'daily') {
    const extras = product.shop === 'gold' ? shopAdExtrasToday(state, product.id, now) : 0;
    const cap = product.limit.count + extras;
    const used = purchasesToday(state, product.id, now);
    limitLabel = `${used}/${cap}`;
    exhausted = used >= cap;
    adExtraOpen =
      exhausted && product.shop === 'gold' && adsAvailable()
      && extras < content.balance.ads.shopExtraPerProduct;
  } else if (product.limit.kind === 'once') {
    exhausted = onceBought(state, product);
    limitLabel = `${exhausted ? 1 : 0}/1`;
  }
  const shortFunds = product.shop === 'gold' ? state.wallet.gold < product.price : state.wallet.diamonds < product.price;
  return { limitLabel, exhausted, shortFunds, adExtraOpen };
}

function buyButton(product: ShopProduct, exhausted: boolean, shortFunds: boolean, adExtraOpen: boolean): HTMLElement {
  // 한도 소진 + 광고 연장 가능 → 죽은 버튼 대신 📺 연장 버튼 (GDD §9.2, 2026-08-29 사용자)
  if (adExtraOpen) {
    return el('button.btn.btn-ghost', {
      disabled: adBusy(),
      onclick: () => {
        adBusy.set(true);
        void showRewardedAd().then((result) => {
          adBusy.set(false);
          if (result === 'rewarded') grantAdShopExtra(product.id);
          else if (result === 'dismissed') toast('광고를 끝까지 봐야 보상을 받아요', 'error');
          else toast('지금은 광고를 불러올 수 없습니다 — 잠시 후 다시', 'error');
        });
      },
    }, adBusy() ? '준비 중…' : '📺 +1회');
  }
  return el('button.btn.btn-primary', {
    disabled: exhausted || shortFunds,
    onclick: () => purchase(product),
  }, exhausted ? (product.limit.kind === 'once' ? '구매 완료' : '한도 소진') : priceTag(product));
}

function productCard(product: ShopProduct): HTMLElement {
  const { limitLabel, exhausted, shortFunds, adExtraOpen } = productState(product);
  const limitTag = limitLabel !== null ? el('span.muted.small.shop-limit', {}, `(${limitLabel})`) : null;

  return el('div.card.stack-sm.shop-item', {},
    el('div.list-row', {},
      el('div', {},
        el('div.shop-name', {}, `${product.icon} ${product.name} `, limitTag),
        el('div.muted.small', {}, product.desc),
      ),
      el('div.shop-buy', {}, buyButton(product, exhausted, shortFunds, adExtraOpen)),
    ),
  );
}

/** 모래시계 카드 — 다른 상품과 같은 1줄 1개 (2026-08-29 사용자 — 2열 그리드는 이름 줄바꿈으로 높이가 틀어졌다).
 * 이모지 대신 등급색 테두리 모래시계 아이콘으로 구분 */
function hourglassRow(product: ShopProduct): HTMLElement {
  const { limitLabel, exhausted, shortFunds, adExtraOpen } = productState(product);
  const def = product.goods.kind === 'hourglass' ? content.hourglasses.get(product.goods.hourglassId) : undefined;
  const limitTag = limitLabel !== null ? el('span.muted.small.shop-limit', {}, `(${limitLabel})`) : null;

  return el('div.card.stack-sm.shop-item', {},
    el('div.list-row', {},
      el('div.shop-hg-left', {},
        def ? hourglassIcon(def, { small: true }) : null,
        el('div', {},
          el('div.shop-name', {}, `${product.name} `, limitTag),
          el('div.muted.small', {}, product.desc),
        ),
      ),
      el('div.shop-buy', {}, buyButton(product, exhausted, shortFunds, adExtraOpen)),
    ),
  );
}

// 광고 제거·다이아 팩 카드는 충전 시트로 분리 (2026-08-29 사용자) — ui/rechargeSheet.ts

// 상품 구간 — goods 종류로 분류해 탭 안을 3구간으로 (2026-08-24 가독성 개편)
const SHOP_GROUPS: { label: string; kinds: ShopProduct['goods']['kind'][]; note?: string }[] = [
  { label: '🎲 뽑기·발굴', kinds: ['monsterGacha', 'artifactGacha'], note: GACHA_POOL_NOTE },
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
      ? members.map((product) => hourglassRow(product))
      : members.map((product) => productCard(product));
    return [
      el('div.info-group-head', {},
        el('span.small', {}, group.label),
        el('span.muted.small', {}, `${members.length}종`),
      ),
      group.note ? el('div.muted.small.shop-group-note', {}, group.note) : null,
      ...body,
    ];
  });

  const shell = sheetShell([uiIcon('shop-stall', '🏪', '상점'), ' 상점'],
    // 재화 행 — 전부 우측 정렬: 재화 [충전] [DEV] 순서, 높이는 두 관 동일 (2026-08-29 사용자).
    // 보유 재화는 현재 관의 것만 — 골드관=골드, 다이아관=다이아. [DEV]·충전은 다이아관에서만
    el('div.card.list-row.shop-balance-row', {},
      el('span'), // 빈 왼쪽 — space-between이 재화 묶음을 오른쪽 끝으로 민다
      el('div.row-gap', {},
        el('span.shop-balance', {}, tab === 'gold' ? `💰 ${fmtGold(state.wallet.gold)}` : `💎 ${fmtNum(state.wallet.diamonds)}`),
        tab === 'diamond'
          ? el('button.btn.btn-primary', {
              // 스토어 준비됨(설치본·DEV) → 충전 시트, 아니면 경로 안내 토스트
              onclick: () => {
                if (diamondPacks().length > 0 || adFreeIap().available) {
                  playSfx('tap');
                  overlay.set({ kind: 'recharge' });
                } else {
                  toast('💎 충전은 플레이스토어 설치 버전에서 제공됩니다 [출석으로도 모을 수 있어요]', 'ok');
                }
              },
            }, '충전')
          : null,
      ),
    ),
    el('div.big-tabs', {},
      el(`button.big-tab${tab === 'gold' ? '.active' : ''}`, { onclick: () => { playSfx('tap'); shopTab.set('gold'); } }, '💰 골드 상점'),
      el(`button.big-tab${tab === 'diamond' ? '.active' : ''}`, { onclick: () => { playSfx('tap'); shopTab.set('diamond'); } }, '💎 다이아 상점'),
    ),
    ...groupBlocks,
    tab === 'gold'
      ? el('div.center.small.muted', {}, `구매 한도는 매일 자정 초기화 (오늘 ${todayKey(nowTick())})`)
      : null,
  );
  shell.classList.add('sheet-full');
  return shell;
}

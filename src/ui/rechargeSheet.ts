/**
 * 다이아 충전 시트 — 실결제 전용 화면 (Google Play Billing, platform/iap.ts).
 * 상점 다이아관 '충전' 버튼에서 진입, 닫으면 상점으로 돌아간다 (2026-08-29 사용자 —
 * 팩 목록이 상점 상품에 섞여 길어지는 게 싫다 → 분리). 광고 제거도 실결제라 여기에 함께.
 * 스토어 미준비(웹 프로덕션·사이드로드)에서는 상점 쪽 진입 버튼이 안내 토스트만 띄운다.
 */
import { hasAdFree } from '../core/shop';
import { adFreeIap, buyIapProduct, diamondPacks } from '../platform/iap';
import { signal } from '../state/signal';
import { save } from '../state/store';
import { el } from './kit';
import { overlay } from './router';
import { playSfx } from './sfx';

const iapBusy = signal(false); // 결제 시트 여는 중 — 모든 구매 버튼 잠금

/**
 * 기준 단가(1💎=10원) 대비 보너스 표기 — 지급량·콘솔 등록가에서 계산한 정적 값.
 * ⚠️ 콘솔에서 가격을 바꾸면 여기도 같이 갱신할 것 (GDD §9.1-2 단가 노트).
 */
const PACK_BONUS: Record<string, number> = {
  diamonds_550: 10,
  diamonds_1000: 18,
  diamonds_4000: 33,
  diamonds_7000: 40,
  diamonds_15000: 50,
};

function buy(id: string): void {
  playSfx('tap');
  iapBusy.set(true);
  void buyIapProduct(id).finally(() => iapBusy.set(false)); // 완료 반영은 iap 이벤트 체인
}

function packCard(pack: { id: string; diamonds: number; price: string | null }): HTMLElement {
  const bonus = PACK_BONUS[pack.id];
  return el('div.card.stack-sm.shop-item', {},
    el('div.list-row', {},
      el('div', {},
        el('div.shop-name', {},
          `💎 다이아 ${pack.diamonds.toLocaleString('ko-KR')}개 `,
          bonus ? el('span.tag.recharge-bonus', {}, `+${bonus}% 이득`) : null,
        ),
      ),
      el('div.shop-buy', {},
        el('button.btn.btn-primary', { disabled: iapBusy(), onclick: () => buy(pack.id) }, pack.price ?? '구매'),
      ),
    ),
  );
}

function adFreeCard(): HTMLElement | null {
  const owned = hasAdFree(save());
  const { available, price } = adFreeIap();
  if (!available && !owned) return null;
  return el('div.card.stack-sm.shop-item', {},
    el('div.list-row', {},
      el('div', {},
        el('div.shop-name', {}, '🚫 광고 제거 ', owned ? el('span.muted.small.shop-limit', {}, '(적용됨)') : null),
        el('div.muted.small', {}, '모든 보상형 광고를 시청 없이 즉시 보상으로 (영구)'),
      ),
      el('div.shop-buy', {},
        el('button.btn.btn-primary', { disabled: owned || iapBusy(), onclick: () => buy('ad_free') },
          owned ? '적용됨' : (price ?? '구매')),
      ),
    ),
  );
}

export function rechargeSheet(): HTMLElement {
  const packs = diamondPacks();
  const adFree = adFreeCard();
  const shell = el('div.sheet', {},
    el('div.sheet-head', {},
      el('div.sheet-title', {}, '💎 다이아 충전'),
      // 상점에서 들어온 화면 — 닫기는 상점 복귀 (closeOverlay면 상점까지 닫혀 맥락이 끊긴다)
      el('button.btn.btn-ghost', { onclick: () => { playSfx('tap'); overlay.set({ kind: 'shop' }); } }, '닫기'),
    ),
    el('div.card.list-row.shop-balance-row', {},
      el('span.muted.small', {}, '보유 다이아'),
      el('span.shop-balance', {}, `💎 ${save().wallet.diamonds.toLocaleString('ko-KR')}`),
    ),
    ...packs.map(packCard),
    adFree ? el('div.info-group-head', {}, el('span.small', {}, '🎁 기타 상품')) : null,
    adFree,
    el('div.center.small.muted', {}, 'Google Play로 결제됩니다 · 충전 즉시 지급 · 클라우드에 바로 저장'),
    el('div.center.small.muted', {}, '다이아는 출석 달력에서도 모을 수 있어요'),
  );
  shell.classList.add('sheet-full');
  return shell;
}

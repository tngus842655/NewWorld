/**
 * 실결제 (Google Play Billing — cordova-plugin-purchase, 2026-08-29).
 * 현재 상품은 '광고 제거' 하나 — 출석 다이아로 못 사게 다이아 상점 판매를 폐지하고
 * 실구매 전용으로 전환 (사용자 결정). 가격·상품 정보의 진실은 Play Console이고,
 * 앱은 상품 ID로 조회만 한다 (콘솔에서 가격을 바꾸면 앱은 그대로 따라간다).
 *
 * 흐름: initialize → 상품 조회(가격 표시) → order() → approved → verify(로컬) →
 * finish(승인 acknowledge — 3일 내 미승인 시 자동 환불되므로 필수) → 소유 반영(grantAdFree).
 * 재설치·기기 변경 복원: initialize가 보유 영수증을 되돌려줘 같은 경로로 소유가 복원된다.
 * ⚠️ 플레이스토어 설치본 + 콘솔에 상품(ad_free)이 등록된 뒤에만 동작 — 사이드로드·웹은 숨김.
 */
import { Capacitor } from '@capacitor/core';

export const AD_FREE_PRODUCT_ID = 'ad_free'; // Play Console 인앱 상품 ID와 일치해야 한다 (비소모성)

// cordova 전역 — 브리지가 네이티브에서만 주입한다. 타입은 쓰는 만큼만 구조적으로 선언
interface CdvOffer { order(): Promise<unknown> }
interface CdvProduct { owned: boolean; pricing?: { price: string }; getOffer(): CdvOffer | undefined }
interface CdvTransaction { verify(): Promise<unknown> }
interface CdvReceipt { finish(): Promise<unknown> }
interface CdvEvents {
  approved(cb: (tx: CdvTransaction) => void): CdvEvents;
  verified(cb: (receipt: CdvReceipt) => void): CdvEvents;
  finished(cb: () => void): CdvEvents;
  productUpdated(cb: () => void): CdvEvents;
}
interface CdvStore {
  register(products: { id: string; type: unknown; platform: unknown }[]): void;
  when(): CdvEvents;
  initialize(platforms: unknown[]): Promise<unknown>;
  get(id: string, platform?: unknown): CdvProduct | undefined;
}
interface CdvPurchaseNs {
  store: CdvStore;
  ProductType: { NON_CONSUMABLE: unknown };
  Platform: { GOOGLE_PLAY: unknown };
}
declare global {
  interface Window { CdvPurchase?: CdvPurchaseNs }
}

let priceLabel: string | null = null;
let storeReady = false;

function product(): CdvProduct | undefined {
  return window.CdvPurchase?.store.get(AD_FREE_PRODUCT_ID, window.CdvPurchase.Platform.GOOGLE_PLAY);
}

/** 소유를 세이브에 반영 — 구매 완료·복원·상품 갱신 어느 이벤트에서든 (멱등) */
async function syncOwnership(): Promise<void> {
  if (!product()?.owned) return;
  const { grantAdFree } = await import('../state/store');
  grantAdFree();
}

/** 게임 마운트 후 1회 (main.ts) — 상품 등록·조회 + 소유 복원 */
export async function initIap(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const cdv = window.CdvPurchase;
  if (!cdv) return; // 브리지 미주입 — 조용히 (구버전 웹뷰 등)
  try {
    cdv.store.register([{ id: AD_FREE_PRODUCT_ID, type: cdv.ProductType.NON_CONSUMABLE, platform: cdv.Platform.GOOGLE_PLAY }]);
    cdv.store.when()
      .approved((tx) => void tx.verify()) // 검증 서버 없음 — 로컬 통과 (v1 소프트 신뢰, 랭킹과 같은 전제)
      .verified((receipt) => void receipt.finish()) // acknowledge — 없으면 3일 뒤 자동 환불
      .finished(() => void syncOwnership())
      .productUpdated(() => {
        priceLabel = product()?.pricing?.price ?? priceLabel;
        void syncOwnership();
      });
    await cdv.store.initialize([cdv.Platform.GOOGLE_PLAY]);
    storeReady = true;
    priceLabel = product()?.pricing?.price ?? null;
    void syncOwnership(); // 재설치 복원 — 보유 영수증이 initialize로 돌아온다
  } catch { /* 스토어 미설치·미등록 상품 — 구매 UI만 숨긴다 (비크리티컬) */ }
}

/** 상점 UI용 상태 — available이 false면 카드 자체를 그리지 않는다 */
export function adFreeIap(): { available: boolean; price: string | null } {
  return { available: storeReady && product() !== undefined, price: priceLabel };
}

/** 구매 시작 — 결제 시트는 플레이가 띄우고, 완료 반영은 위 이벤트 체인이 한다 */
export async function buyAdFree(): Promise<void> {
  try {
    const offer = product()?.getOffer();
    if (offer) await offer.order();
  } catch { /* 사용자 취소·일시 오류 — 조용히 (성공은 이벤트로 반영된다) */ }
}

/**
 * 실결제 (Google Play Billing — cordova-plugin-purchase, 2026-08-29).
 * 상품: 광고 제거(비소모성) + 다이아 충전 3종(소모성). 가격·상품 정보의 진실은 Play Console이고,
 * 앱은 상품 ID로 조회만 한다 (콘솔에서 가격을 바꾸면 앱은 그대로 따라간다).
 * 광고 제거를 상점(다이아) 판매에서 뺀 이유: 출석 다이아(무료 재화)로 사지 못하게 (사용자 결정).
 *
 * 흐름: initialize → 상품 조회(가격 표시) → order() → approved(지급) → verify(로컬) →
 * finish(승인 acknowledge — 3일 내 미승인 시 자동 환불, 소모성은 이걸로 재구매 가능해진다).
 * 지급은 approved에서 트랜잭션 장부(localStorage)로 1회만 — 앱이 지급 직후 죽으면
 * 미완료 거래가 다음 부팅에 재통지되는데(최소 1회 전달), 장부가 중복 지급을 막는다.
 * 재설치·기기 변경 복원: initialize가 보유 영수증을 되돌려줘 광고 제거 소유가 복원된다.
 * ⚠️ 플레이스토어 설치본 + 콘솔에 상품이 등록된 뒤에만 동작 — 사이드로드·웹은 숨김.
 */
import { Capacitor } from '@capacitor/core';

export const AD_FREE_PRODUCT_ID = 'ad_free'; // Play Console 인앱 상품 ID와 일치 (비소모성)

/** 다이아 팩 — id의 숫자 = 지급량. 가격은 콘솔에서 (기준 단가 1💎=10원, 권장 ₩3,000/₩5,500/₩10,000) */
export const DIAMOND_PACKS = [
  { id: 'diamonds_300', diamonds: 300 },
  { id: 'diamonds_550', diamonds: 550 },
  { id: 'diamonds_1000', diamonds: 1000 },
] as const;

// cordova 전역 — 브리지가 네이티브에서만 주입한다. 타입은 쓰는 만큼만 구조적으로 선언
interface CdvOffer { order(): Promise<unknown> }
interface CdvProduct { owned: boolean; pricing?: { price: string }; getOffer(): CdvOffer | undefined }
interface CdvTransaction { transactionId: string; products: { id: string }[]; verify(): Promise<unknown> }
interface CdvReceipt { finish(): Promise<unknown> }
interface CdvEvents {
  approved(cb: (tx: CdvTransaction) => void): CdvEvents;
  verified(cb: (receipt: CdvReceipt) => void): CdvEvents;
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
  ProductType: { NON_CONSUMABLE: unknown; CONSUMABLE: unknown };
  Platform: { GOOGLE_PLAY: unknown };
}
declare global {
  interface Window { CdvPurchase?: CdvPurchaseNs }
}

// ── 지급 장부 — 같은 거래를 두 번 지급하지 않는다 (미완료 거래 재통지 대비) ──
const GRANTED_KEY = 'newworld-iap-granted';

function grantedIds(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(GRANTED_KEY) ?? '[]') as string[]) ?? [];
  } catch {
    return [];
  }
}

function markGranted(txId: string): void {
  try {
    localStorage.setItem(GRANTED_KEY, JSON.stringify([...grantedIds(), txId].slice(-50)));
  } catch { /* 비크리티컬 — 최악이 중복 지급이 아니라 장부 유실 후 재지급인데, 거래는 이미 finish됨 */ }
}

let priceLabels = new Map<string, string>();
let storeReady = false;

function product(id: string): CdvProduct | undefined {
  return window.CdvPurchase?.store.get(id, window.CdvPurchase.Platform.GOOGLE_PLAY);
}

function refreshPrices(): void {
  for (const id of [AD_FREE_PRODUCT_ID, ...DIAMOND_PACKS.map((p) => p.id)]) {
    const price = product(id)?.pricing?.price;
    if (price) priceLabels.set(id, price);
  }
}

/** 거래 지급 — 소모성은 장부로 1회 보장, 광고 제거는 멱등이라 장부 불요 */
async function deliver(tx: CdvTransaction): Promise<void> {
  const { grantAdFree, grantIapDiamonds } = await import('../state/store');
  for (const { id } of tx.products) {
    if (id === AD_FREE_PRODUCT_ID) {
      grantAdFree();
      continue;
    }
    const pack = DIAMOND_PACKS.find((p) => p.id === id);
    if (pack && !grantedIds().includes(tx.transactionId)) {
      markGranted(tx.transactionId);
      grantIapDiamonds(pack.diamonds);
    }
  }
}

/** 광고 제거 소유를 세이브에 반영 — 복원·상품 갱신 어느 이벤트에서든 (멱등) */
async function syncAdFreeOwnership(): Promise<void> {
  if (!product(AD_FREE_PRODUCT_ID)?.owned) return;
  const { grantAdFree } = await import('../state/store');
  grantAdFree();
}

/** 게임 마운트 후 1회 (main.ts) — 상품 등록·조회 + 소유 복원 */
export async function initIap(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const cdv = window.CdvPurchase;
  if (!cdv) return; // 브리지 미주입 — 조용히
  try {
    cdv.store.register([
      { id: AD_FREE_PRODUCT_ID, type: cdv.ProductType.NON_CONSUMABLE, platform: cdv.Platform.GOOGLE_PLAY },
      ...DIAMOND_PACKS.map((p) => ({ id: p.id, type: cdv.ProductType.CONSUMABLE, platform: cdv.Platform.GOOGLE_PLAY })),
    ]);
    cdv.store.when()
      .approved((tx) => {
        void deliver(tx).then(() => void tx.verify()); // 지급 후 검증·승인 — 검증 서버 없음(로컬), v1 소프트 신뢰
      })
      .verified((receipt) => void receipt.finish()) // acknowledge — 없으면 3일 뒤 자동 환불
      .productUpdated(() => {
        refreshPrices();
        void syncAdFreeOwnership();
      });
    await cdv.store.initialize([cdv.Platform.GOOGLE_PLAY]);
    storeReady = true;
    refreshPrices();
    void syncAdFreeOwnership(); // 재설치 복원 — 보유 영수증이 initialize로 돌아온다
  } catch { /* 스토어 미설치·미등록 상품 — 구매 UI만 숨긴다 (비크리티컬) */ }
}

/** 상점 UI용 상태 — available이 false면 카드 자체를 그리지 않는다 */
export function adFreeIap(): { available: boolean; price: string | null } {
  return { available: storeReady && product(AD_FREE_PRODUCT_ID) !== undefined, price: priceLabels.get(AD_FREE_PRODUCT_ID) ?? null };
}

/** 다이아 팩 목록 (UI용) — 스토어가 준비된 것만 */
export function diamondPacks(): { id: string; diamonds: number; price: string | null }[] {
  if (!storeReady) return [];
  return DIAMOND_PACKS
    .filter((p) => product(p.id) !== undefined)
    .map((p) => ({ id: p.id, diamonds: p.diamonds, price: priceLabels.get(p.id) ?? null }));
}

/** 구매 시작 — 결제 시트는 플레이가 띄우고, 완료 반영은 위 이벤트 체인이 한다 */
export async function buyIapProduct(id: string): Promise<void> {
  try {
    const offer = product(id)?.getOffer();
    if (offer) await offer.order();
  } catch { /* 사용자 취소·일시 오류 — 조용히 (성공은 이벤트로 반영된다) */ }
}

/** @deprecated 호환 별칭 — 광고 제거 구매 */
export async function buyAdFree(): Promise<void> {
  return buyIapProduct(AD_FREE_PRODUCT_ID);
}

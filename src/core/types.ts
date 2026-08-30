/**
 * 세이브·일지 등 코어 상태 타입 (DATA.md §2).
 * 원칙: 파생값(마일스톤 버프, 유효 CP, 풀 일지)은 저장하지 않는다.
 */
import type { Tier } from '../content/schema';

// ── 소유물 ───────────────────────────────────────────────────────────────────
/** 몬스터는 종 단위로 소유한다 (2026-08-23) — 카드가 몇 장이든 레벨·성급은 종당 하나 */
export interface OwnedMonster {
  monsterId: string;
  level: number;
  star: number; // 1~5
  count: number; // 보유 카드 수 (중복 포획 누적, 최소 1 — 추후 합성 재료)
}

/** 유물도 종 단위로 소유한다 (v6, 2026-08-23) — 몬스터와 동일: 개수 누적, 강화는 종당 하나 */
export interface OwnedArtifact {
  itemId: string;
  enhance: number; // 0~5 — 종 공통
  count: number; // 보유 개수 (최소 1 — 합성 재료는 여분 count-1)
}

export interface TeamLoadout {
  id: string;
  name: string;
  partyIds: string[]; // monsterId 목록 (종 단위 — 같은 종은 한 파티에 하나)
  artifactIds: string[]; // itemId 목록 (종 단위, v6) — 슬롯당 1개, 최대 4
}

// ── 파견 ─────────────────────────────────────────────────────────────────────
export type CrossroadChoice = 'safe' | 'risky';

export interface ActiveExpedition {
  id: string;
  regionId: string;
  tier: Tier;
  teamId?: string; // 파견한 군 (v5 — 표시·재파견 잠금, 구 세이브는 없음)
  partyIds: string[]; // monsterId 스냅샷 — 원정 중 교체 방지
  artifactIds: string[]; // itemId 스냅샷 (v6 종 단위)
  seed: string;
  startedAt: number;
  endsAt: number;
  luresLoaded: number;
  choices: (CrossroadChoice | null)[]; // null = 미선택 (정산 시 safe 처리)
  claimed: boolean;
  /** 회군 시각 (2026-08-27) — 있으면 보상 없이 귀로. 복귀 완료 시각은 저장하지 않고 파생(recallReturnEndsAt) */
  recallAt?: number;
  /** 전설의 흔적 가산 (v10) — deep 파견 시 흔적을 소모해 확정, 정산·미리보기가 같은 값을 쓴다 */
  legendBonus?: number;
  /** 야생의 향기 스냅샷 (v11, GDD §9.2) — 버프 중 출발한 원정의 포획 ×adBuffMult (결정론 유지) */
  scent?: boolean;
}

// ── 도감 ─────────────────────────────────────────────────────────────────────
export interface CodexEntry {
  seen: boolean;
  captured: boolean;
  awakened: boolean; // ★3 도달
  firstCapturedAt?: number;
}

/** 유물 도감 (v7) — 획득 이력. 과거 분해(기능 제거 전)로 종이 사라진 세이브도 도감에는 남는다 */
export interface ArtifactCodexEntry {
  obtained: boolean;
}

// ── 누적 통계 (랭킹·반복 과업의 원천 — v3) ───────────────────────────────────
export interface LifetimeStats {
  expeditions: Record<Tier, number>; // 정산 완료 수 (전멸 포함)
  wipes: Record<Tier, number>; // 그중 전멸 귀환
  captures: number; // 포획 성공 누적 (신규 + 중복)
  crafts: number; // 미끼 제작 횟수
  fusions: number; // 합성 시도 (카드 + 유물)
  bestPower: number; // 파견 시 유효 전투력 최고 기록
}

// ── 상점 구매 기록 (v4) ──────────────────────────────────────────────────────
export interface ShopState {
  day: string; // 일일 한도 기준일 (로컬 YYYY-MM-DD) — 날짜가 바뀌면 bought 리셋
  bought: Record<string, number>; // productId → 오늘 구매 수
  once: string[]; // 1회 한정 구매 기록 (지역 한정은 `${productId}:${regionId}`)
}

// ── 월간 출석 (v8) ───────────────────────────────────────────────────────────
export interface AttendanceState {
  month: string; // 'YYYY-MM' (로컬 기준) — 달이 바뀌면 리셋
  days: number[]; // 출석 도장을 찍은 일(day of month) 목록 — 보상은 순서(n번째)대로
}

/** 다이아 원장 항목 (v14, 검토 ⑤) — source 규약은 core/diamondLog.ts 머리 주석 */
export interface DiamondLogEntry {
  at: number;
  delta: number; // +획득 / -소비
  source: string;
}

// ── 세이브 루트 ──────────────────────────────────────────────────────────────

/**
 * 세이브 스키마 버전 — 올릴 때 state/migrations.ts에 단계를 추가한다 (TECH §8).
 * 여기(core)가 정본인 이유: 신규 세이브(newgame)가 이 값을 찍어야 재부팅 때 구버전
 * 마이그레이션이 다시 뛰지 않는다 (v11 고정 시절 다이아 ×5 재적용 잠복 버그, 2026-08-30 수정).
 */
export const CURRENT_SAVE_VERSION = 14;

export interface SaveState {
  version: typeof CURRENT_SAVE_VERSION; // v14 (2026-08-30): 다이아 원장. v13: 야간 알림. 내역은 migrations.ts
  profile: {
    createdAt: number;
    tutorialDone: boolean;
    partySlots: number;
    flags: Record<string, boolean>; // firstArtifactDropped 등 1회성 플래그
    playerId: string; // 랭킹용 익명 신원 — 기기 이동은 클라우드 세이브, 로그인 제출 시 user_id 연결(0005)
    playerSecret: string; // 랭킹 제출 검증 토큰 (서버에 해시로 보관)
    nickname: string;
    /** 이 세이브의 주인 계정 (2026-08-29) — 다른 계정 로그인이 기기 진행을 상속하는 사고 방지
     *  (cloudSync reconcile·uploadNow가 검사). 미기록 = 게스트/구세이브 — 첫 로그인 계정에 귀속 */
    ownerUserId?: string;
  };
  wallet: {
    gold: number;
    dust: number;
    diamonds: number; // 충전 재화 (IAP는 M6 — 그 전 획득처는 출석 이벤트 예정)
    lures: number;
    materials: Record<string, number>;
    hourglasses: Record<string, number>; // hourglassId → 보유 수 (원정 가속 소모품, v9)
  };
  roster: OwnedMonster[];
  artifacts: OwnedArtifact[];
  teams: TeamLoadout[];
  codex: Record<string, CodexEntry>;
  artifactCodex: Record<string, ArtifactCodexEntry>; // itemId → 획득 이력 (v7)
  milestones: string[]; // 달성 id 목록 (버프는 로드 시 재계산)
  stats: LifetimeStats;
  tasks: Record<string, number>; // 반복 과업 taskId → 보상 수령 완료 횟수
  shop: ShopState;
  attendance: AttendanceState; // 월간 출석 (v8)
  expeditions: ActiveExpedition[];
  /** 전설의 흔적 발견 시각 목록 (v10) — TTL 내 것만 유효, deep 파견 시 전량 소모 */
  legendTraces: number[];
  journalArchive: JournalSummary[]; // 최근 20건 — 요약 + 정산 시점 풀 일지 (재열람용)
  counters: { day: string; adUsed: Record<string, number> }; // 광고 일일 카운터 (core/ads.ts, 로컬 자정 리셋)
  /** 광고 보상 버프 (v11, GDD §9.2) — scentUntil: 야생의 향기 만료 시각 (0 = 없음) */
  buffs: { scentUntil: number };
  /** nightAlarms (v13): 켬 = 야간(21~08시)에도 귀환 알림 — 기본 끔 (구 push 필드 대체) */
  settings: { sound: boolean; nightAlarms: boolean };
  /** 다이아 원장 (v14, 검토 ⑤) — 증감 건별 기록. 합계 불변식·source 규약은 core/diamondLog.ts */
  diamondLog: DiamondLogEntry[];
  /** 원장 상한 초과로 접힌 과거 항목들의 delta 합 — ledgerSum = base + Σlog */
  diamondLogBase: number;
  lastSavedAt: number;
}

// ── 일지 ─────────────────────────────────────────────────────────────────────
export interface DroppedArtifact {
  itemId: string; // v6: 부옵션 폐지 — 종만 결정
}

export type GrantedReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'material'; materialId: string; count: number }
  | { kind: 'card'; monsterId: string; count: number } // 보유 종 카드 (구 정수 보상 대체)
  | { kind: 'artifact'; drop: DroppedArtifact }
  | { kind: 'lure'; count: number };

export type JournalEntry =
  | {
      type: 'encounter';
      index: number;
      monsterId: string;
      result: 'win' | 'autowin' | 'flee';
      enemyPower: number;
      partyPower: number;
      hpAfter: number;
      gold: number;
      capture?: { success: boolean; retried: boolean; dupe?: boolean }; // dupe = 이미 아는 종, 카드 +1
      artifact?: DroppedArtifact; // 전설 조우 드랍
    }
  | { type: 'treasure'; eventId: string; gold: number; hpAfter: number; artifact?: DroppedArtifact }
  | { type: 'trap'; eventId: string; avoided: boolean; hpAfter: number }
  | { type: 'gather'; eventId: string; materialId: string; count: number }
  | {
      type: 'crossroad';
      eventId: string;
      choice: CrossroadChoice;
      success: boolean;
      salvaged: boolean;
      rewards: GrantedReward[];
      hpAfter: number;
    }
  | { type: 'wipe'; revived: boolean; hpAfter: number }
  | { type: 'clearBox'; artifact: DroppedArtifact }; // 심층 완주 상자

export interface JournalTotals {
  gold: number;
  materials: Record<string, number>;
  cards: Record<string, number>; // 종별 중복 카드 획득 (전멸 페널티 미적용 — 포획물)
  capturedMonsterIds: string[]; // 신규 도감 등록
  seenMonsterIds: string[];
  artifacts: DroppedArtifact[];
  luresUsed: number;
  luresGained: number; // 갈림길 보상 등으로 원정 중 획득
}

export interface Journal {
  expeditionId: string;
  regionId: string;
  tier: Tier;
  seed: string;
  entries: JournalEntry[];
  wiped: boolean; // 전멸로 조기 귀환
  totals: JournalTotals;
  legendTrace?: boolean; // 전설의 흔적 발견 (정찰 완주 한정) — 정산 시 세이브에 적립
}

export interface JournalSummary {
  expeditionId: string;
  regionId: string;
  tier: Tier;
  endedAt: number;
  gold: number;
  capturedCount: number;
  artifactCount: number;
  wiped: boolean;
  /** 정산 시점의 풀 일지 — 재열람용 (2026-08-23). 시드 재생성은 정산 후 세이브가 변해 불가능.
   *  구 세이브 항목에는 없음 → UI는 상세 버튼을 숨긴다 */
  journal?: Journal;
  /** 광고 2배 수령 완료 (GDD §9.2 — 원정당 1회). 골드·재료만 2배, 카드·포획·유물은 도감 자산이라 제외 */
  doubled?: boolean;
}

// ── 코어 호출 컨텍스트 ───────────────────────────────────────────────────────
/** 시간·시드는 반드시 주입 (core 내부에서 Date.now/Math.random 금지 — TECH.md §2) */
export interface CoreCtx {
  now: () => number;
  newSeed: () => string;
  newUid: () => string;
}

export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

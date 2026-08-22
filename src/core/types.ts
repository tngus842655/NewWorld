/**
 * 세이브·일지 등 코어 상태 타입 (DATA.md §2).
 * 원칙: 파생값(마일스톤 버프, 유효 CP, 풀 일지)은 저장하지 않는다.
 */
import type { Substat, Tier } from '../content/schema';

// ── 소유물 ───────────────────────────────────────────────────────────────────
export interface OwnedMonster {
  uid: string;
  monsterId: string;
  level: number;
  star: number; // 1~5
}

export interface RolledSubstat {
  stat: Substat;
  value: number;
}

export interface OwnedArtifact {
  uid: string;
  itemId: string;
  enhance: number; // 0~5
  substats: RolledSubstat[];
}

export interface TeamLoadout {
  id: string;
  name: string;
  partyUids: string[];
  artifactUids: string[]; // 슬롯당 1개, 최대 4
}

// ── 파견 ─────────────────────────────────────────────────────────────────────
export type CrossroadChoice = 'safe' | 'risky';

export interface ActiveExpedition {
  id: string;
  regionId: string;
  tier: Tier;
  partyUids: string[]; // 파견 시점 스냅샷 — 원정 중 교체 방지
  artifactUids: string[];
  seed: string;
  startedAt: number;
  endsAt: number;
  luresLoaded: number;
  choices: (CrossroadChoice | null)[]; // null = 미선택 (정산 시 safe 처리)
  claimed: boolean;
}

// ── 도감 ─────────────────────────────────────────────────────────────────────
export interface CodexEntry {
  seen: boolean;
  captured: boolean;
  awakened: boolean; // ★3 도달
  firstCapturedAt?: number;
}

// ── 세이브 루트 ──────────────────────────────────────────────────────────────
export interface SaveState {
  version: 1;
  profile: {
    createdAt: number;
    tutorialDone: boolean;
    partySlots: number;
    flags: Record<string, boolean>; // firstArtifactDropped 등 1회성 플래그
  };
  wallet: {
    gold: number;
    dust: number;
    lures: number;
    materials: Record<string, number>;
    essence: Record<string, number>; // 몬스터 종별 정수
  };
  roster: OwnedMonster[];
  artifacts: OwnedArtifact[];
  teams: TeamLoadout[];
  codex: Record<string, CodexEntry>;
  milestones: string[]; // 달성 id 목록 (버프는 로드 시 재계산)
  expeditions: ActiveExpedition[];
  journalArchive: JournalSummary[]; // 최근 20건 요약 — 풀 일지는 시드에서 재생성
  counters: { day: string; adUsed: Record<string, number> };
  settings: { sound: boolean; push: boolean };
  lastSavedAt: number;
}

// ── 일지 ─────────────────────────────────────────────────────────────────────
export interface DroppedArtifact {
  itemId: string;
  substats: RolledSubstat[];
}

export type GrantedReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'material'; materialId: string; count: number }
  | { kind: 'essence'; monsterId: string; count: number }
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
      capture?: { success: boolean; retried: boolean; essence?: number };
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
  essence: Record<string, number>;
  capturedMonsterIds: string[]; // 신규 도감 등록 (uid는 정산 시 부여)
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

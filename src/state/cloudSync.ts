/**
 * 클라우드 세이브 동기화 — saves 테이블 LWW 미러 + 회원 탈퇴 (ROADMAP M5, 2026-08-29).
 * store에 결합되므로 **게임 경로에서만** 로드한다 (게이트 경로는 cloud.ts만 —
 * 이 모듈이 게이트에 실리면 store가 빈 세이브를 만들어 저장해버린다, 2026-08-29 실사고).
 * 흐름: 로그인 직후 reconcile — 같은 기기 선형 진행은 베이스 리비전으로 감지해 조용히,
 * 기기 간 충돌은 진행 많은 쪽 자동 선택(팝업 없음 — 2026-08-29 사용자, 패자는 previous_* 보관).
 * 저장은 30초 디바운스 업로드 + 백그라운드 진입 시 즉시 플러시, RNG 소비(뽑기·합성)도 즉시.
 * 실패는 조용히 무시 (비크리티컬 원칙).
 * 진실은 항상 클라 — 서버는 미러다 (0003_google_auth.sql).
 */
import { content } from '../content';
import { createInitialSave } from '../core/newgame';
import { ensureTeams } from '../core/teams';
import type { SaveState } from '../core/types';
import { askConfirm } from '../ui/dialog';
import { fmtGold, toast } from '../ui/kit';
import * as clock from './clock';
import { cloudSession } from './cloud';
import { migrateSave } from './migrations';
import { SAVE_KEY } from './save';
import { effect, signal } from './signal';
import { ctx, save } from './store';
import { supabase } from './supabaseClient';

export const lastUploadedAt = signal<number | null>(null);

const UPLOAD_DEBOUNCE_MS = 30_000; // 저장이 잦아도 업로드는 30초에 한 번
let uploadTimer: number | null = null;

// ── 클라우드 베이스 리비전 (2026-08-29 실기기) ───────────────────────────────
// 이 기기가 마지막으로 클라우드에 쓰거나(업로드) 받아들인(복원) client_saved_at.
// reconcile에서 클라우드가 이 값 그대로면 다른 기기의 개입이 없었다는 뜻 — 같은 기기의
// 선형 진행이므로 선택 다이얼로그 없이 조용히 따라잡는다. 계기: 파견 직후 앱을 닫으면
// 디바운스 업로드가 유실돼 재진입마다 다이얼로그가 떴고, 무심코 '클라우드 불러오기'를
// 누르면 파견 전으로 롤백되는 함정이었다. 다이얼로그는 진짜 기기 간 충돌에만 남긴다.
const CLOUD_BASE_KEY = 'newworld-cloud-base-v1';

function cloudBase(userId: string): number | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOUD_BASE_KEY) ?? 'null') as { userId: string; at: number } | null;
    return raw && raw.userId === userId ? raw.at : null;
  } catch {
    return null;
  }
}

function setCloudBase(userId: string, at: number): void {
  try {
    localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify({ userId, at }));
  } catch { /* 비크리티컬 — 다음 성공 때 갱신 */ }
}

/** 마지막으로 디스크에 남은 저장 시각 — 메모리 시그널의 lastSavedAt은 로드 시점 값이라 스토리지가 진실 */
function localLastSavedAt(): number {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return Number((JSON.parse(raw) as SaveState).lastSavedAt) || 0;
  } catch { /* 손상 세이브는 load 단계에서 이미 처리 — 비교만 0으로 */ }
  return save().lastSavedAt ?? 0;
}

function fmtStamp(at: number): string {
  return at > 0 ? new Date(at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '기록 없음';
}

/** 진행 요약 — 시각만으로는 "어느 쪽이 내 진짜 진행인지" 안 보인다 (2026-08-29 사용자 지적) */
function saveSummary(state: SaveState | null): string {
  try {
    if (!state) return '요약 불가';
    const captured = Object.values(state.codex ?? {}).filter((entry) => entry?.captured).length;
    return `도감 ${captured}종 · 카드 ${state.roster?.length ?? 0}장 · 💰 ${fmtGold(state.wallet?.gold ?? 0)}`;
  } catch {
    return '요약 불가';
  }
}

/** 진행 크기 비교용 점수 — 도감이 주축, 카드 수는 보조 */
function progressOf(state: SaveState | null): number {
  try {
    if (!state) return 0;
    const captured = Object.values(state.codex ?? {}).filter((entry) => entry?.captured).length;
    return captured * 100 + (state.roster?.length ?? 0);
  } catch {
    return 0;
  }
}

/** 버려질 세이브를 서버 previous_*에 1세대 보관 (0004) — 실수 덮어쓰기의 최후 복구선. 실패는 조용히 */
async function backupDiscarded(profileId: string, discarded: SaveState | null, discardedAt: number): Promise<void> {
  if (!discarded) return;
  await supabase.from('saves')
    .update({ previous_data: discarded, previous_saved_at: discardedAt })
    .eq('profile_id', profileId);
}

/**
 * 유령 세션 정리 — 서버에서 계정이 삭제됐는데 클라 JWT만 살아있으면 쓰기가 FK 위반(23503→409)으로
 * 계속 실패한다 (2026-08-29 재가입 테스트에서 실측). 감지 즉시 로그아웃해 자가 치유.
 */
function purgeStaleSession(error: { code?: string } | null): boolean {
  if (error?.code !== '23503') return false;
  void supabase.auth.signOut();
  toast('클라우드 계정이 삭제되어 로그아웃했습니다 — 다시 로그인하면 새로 등록됩니다', 'error');
  return true;
}

/** 현재 세이브를 서버에 업로드 — 실패는 조용히 (다음 디바운스가 재시도 역할) */
export async function uploadNow(state?: SaveState): Promise<boolean> {
  const session = cloudSession();
  if (!session) return false;
  const at = clock.now();
  const body = { ...(state ?? save()), lastSavedAt: at };
  // 주인 불일치 세이브는 절대 올리지 않는다 (2026-08-29) — 계정 전환 상속 사고의 최후 방어선.
  // reconcile이 정리하기 전(오프라인 등)에 디바운스 업로드가 남의 진행을 실어가는 것을 막는다
  if (body.profile.ownerUserId && body.profile.ownerUserId !== session.user.id) return false;
  const { error } = await supabase.from('saves').upsert({
    profile_id: session.user.id,
    data: body,
    version: body.version,
    client_saved_at: at,
    updated_at: new Date(at).toISOString(),
  });
  if (error) {
    purgeStaleSession(error);
    return false;
  }
  setCloudBase(session.user.id, at); // 이제 클라우드 = 이 기기가 쓴 값
  lastUploadedAt.set(at);
  // 닉네임·최근 접속을 profiles에도 미러 — 대시보드에서 유저를 알아보게 (2026-08-29 사용자 리포트).
  // 로그인 시점 1회로는 이후 닉네임 변경이 영영 안 실렸다.
  // ⚠️ supabase-js 쿼리는 then 구독 시점에 실행되는 지연 thenable — void로 버리면
  // 요청 자체가 안 나간다 (2026-08-29 실사고). 반드시 await.
  await supabase.from('profiles').upsert({
    id: session.user.id,
    nickname: body.profile.nickname,
    last_seen_at: new Date(at).toISOString(),
  });
  return true;
}

/**
 * RNG 소비 직후의 즉시 업로드 (세이브 스컴 방지, 2026-08-29) — 뽑기·발굴·합성 결과가
 * 디바운스 30초를 기다리는 동안 '불러오기'가 소비 전 스냅샷으로 되돌리는 무료 재시도가 된다.
 * 결과 확정 즉시 서버에 실어 되돌아갈 과거를 없앤다. 대기 중인 디바운스도 정리.
 */
export function flushUpload(): void {
  if (uploadTimer !== null) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
  void uploadNow();
}

/** 서버 세이브를 이 기기에 적용 — 미래 버전(스테일 번들)이면 false */
function applyCloudSave(data: unknown, ownerId: string): boolean {
  try {
    const migrated = migrateSave(data);
    if (!migrated) return false;
    migrated.profile.ownerUserId = ownerId; // 도장 없는 구 클라우드 세이브도 현재 계정 소유로
    save.set(ensureTeams(content, migrated));
    return true;
  } catch {
    return false;
  }
}

/** 수동 복원 (설정 탭) — 확인 후 서버 세이브로 덮어쓴다 */
export async function restoreFromCloud(): Promise<void> {
  const session = cloudSession();
  if (!session) return;
  const { data: row, error } = await supabase
    .from('saves').select('data, client_saved_at').eq('profile_id', session.user.id).maybeSingle();
  if (error) { toast('클라우드 조회 실패 — 연결을 확인해 주세요', 'error'); return; }
  if (!row) { toast('클라우드에 저장된 세이브가 없습니다', 'error'); return; }
  const cloudSave = row.data as SaveState | null;
  const ok = await askConfirm({
    title: '☁️ 클라우드에서 불러오기',
    message:
      `클라우드 — ${saveSummary(cloudSave)}\n[${fmtStamp(Number(row.client_saved_at))} 저장]\n\n`
      + `이 기기 — ${saveSummary(save())}\n\n이 기기의 현재 진행을 덮어씁니다.`,
    confirmLabel: '불러오기',
    danger: true,
  });
  if (!ok) return;
  await backupDiscarded(session.user.id, save(), localLastSavedAt()); // 버려질 로컬을 1세대 보관
  if (applyCloudSave(row.data, session.user.id)) {
    setCloudBase(session.user.id, Number(row.client_saved_at));
    toast('클라우드 세이브를 불러왔습니다', 'ok');
  } else {
    toast('세이브 버전이 앱보다 높습니다 — 앱을 새로고침해 주세요', 'error');
  }
}

/** 로그인 직후 1회 — 서버 세이브 유무·시각 비교, 다르면 사용자 선택 (ROADMAP M5 스펙) */
async function reconcile(): Promise<void> {
  const session = cloudSession();
  if (!session) return;

  // 계정 전환 방어 (2026-08-29 실사고: 검수용 새 계정이 기기 진행을 통째로 상속·업로드) —
  // 이 기기 세이브가 다른 계정 소유면 올리지도 잇지도 않는다. 프로필 미러보다 먼저:
  // 남의 닉네임이 내 프로필에 실리는 것도 막는다
  const localOwner = save().profile.ownerUserId;
  if (localOwner && localOwner !== session.user.id) {
    const { data: row, error } = await supabase
      .from('saves').select('data, client_saved_at').eq('profile_id', session.user.id).maybeSingle();
    if (error) return; // 판단 불가(오프라인 등) — uploadNow 가드가 상속을 막는다, 다음 로그인에 다시
    if (row) {
      if (applyCloudSave(row.data, session.user.id)) {
        setCloudBase(session.user.id, Number(row.client_saved_at));
        toast('☁️ 이 계정의 클라우드 세이브로 이어서 합니다', 'ok');
      } else {
        toast('세이브 버전이 앱보다 높습니다 — 앱을 새로고침해 주세요', 'error');
      }
      return;
    }
    // 이 계정은 클라우드도 비어 있다 — 남의 진행 대신 새 게임 (랭킹 신원도 새로 발급된다)
    const fresh = createInitialSave(content, ctx);
    fresh.profile.ownerUserId = session.user.id;
    save.set(ensureTeams(content, fresh));
    toast('이 기기의 진행은 다른 계정의 것이라, 새 게임으로 시작합니다', 'ok');
    return; // 새 세이브는 디바운스 업로드가 곧 백업한다
  }
  // 첫 로그인 도장 — 게스트·구버전 세이브를 이 계정 소유로 (도장이 있어야 위 방어가 작동한다)
  if (!localOwner) {
    const state = save();
    save.set({ ...state, profile: { ...state.profile, ownerUserId: session.user.id } });
  }

  // 프로필 자가 복구(가입 트리거 누락 대비) + 접속 흔적
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: session.user.id,
    nickname: save().profile.nickname,
    last_seen_at: new Date(clock.now()).toISOString(),
  });
  if (purgeStaleSession(profileError)) return; // 서버에서 계정이 지워진 유령 세션 — 여기서 끝
  const { data: row, error } = await supabase
    .from('saves').select('data, client_saved_at').eq('profile_id', session.user.id).maybeSingle();
  if (error) return; // 오프라인 등 — 다음 로그인 때 다시
  if (!row) {
    if (await uploadNow()) toast('☁️ 클라우드 백업을 시작했습니다', 'ok');
    return;
  }
  const cloudAt = Number(row.client_saved_at);
  const localAt = localLastSavedAt();
  if (Math.abs(cloudAt - localAt) < 2_000) return; // 같은 저장으로 간주

  // 같은 기기의 선형 진행 — 클라우드가 이 기기의 베이스 그대로면 다른 기기 개입이 없었다.
  // 조용히 따라잡는다 (파견 직후 앱 종료로 디바운스 업로드가 유실되는 일상 케이스 —
  // 이게 매 재진입마다 선택 팝업으로 떴었다, 2026-08-29 실기기)
  if (cloudBase(session.user.id) === cloudAt && localAt > cloudAt) {
    void uploadNow();
    return;
  }

  // 진짜 기기 간 충돌 — 선택 팝업 없이 자동 해소 (2026-08-29 사용자: 팝업 자체가 불편).
  // 진행이 많은 쪽, 같으면 최신 쪽을 잇는다. 구 3겹 방어의 ①②(다이얼로그)는 폐기하고
  // ③(버려지는 쪽을 서버 previous_*에 1세대 보관)만 복구선으로 남긴다 (0004)
  const cloudSave = row.data as SaveState | null;
  const localSave = save();
  const cloudProgress = progressOf(cloudSave);
  const localProgress = progressOf(localSave);
  const useCloud = cloudProgress !== localProgress ? cloudProgress > localProgress : cloudAt > localAt;
  await backupDiscarded(session.user.id, useCloud ? localSave : cloudSave, useCloud ? localAt : cloudAt);
  if (useCloud) {
    if (applyCloudSave(row.data, session.user.id)) {
      setCloudBase(session.user.id, cloudAt);
      toast(`☁️ 다른 기기의 진행으로 이어갑니다 [${saveSummary(cloudSave)}]`, 'ok');
    } else {
      toast('세이브 버전이 앱보다 높습니다 — 앱을 새로고침해 주세요', 'error');
    }
  } else {
    void uploadNow(); // 이 기기가 앞선다 — 클라우드가 따라오게 (조용히)
  }
}

/**
 * 회원 탈퇴 — delete-account 엣지 함수가 본인 JWT 검증 후 계정을 삭제한다.
 * profiles·saves·랭킹(로그인 제출분 user_id, 0005)은 서버 cascade로, 익명 랭킹 행은
 * 본문 신원(playerId+secret) 해시가 일치할 때만 함께 지워진다. 성공하면 이 기기
 * 세이브도 파기하고 로그아웃 → 게이트로 돌아간다. Google Play 계정 삭제 요건 (2026-08-29).
 * 게이트는 store를 로딩하지 않으므로 새 세이브가 다시 생기지 않는다.
 */
export async function deleteAccount(): Promise<boolean> {
  const session = cloudSession();
  if (!session) return false;
  const { profile } = save();
  const { error } = await supabase.functions.invoke('delete-account', {
    body: { playerId: profile.playerId, secret: profile.playerSecret },
  });
  if (error) return false;
  localStorage.removeItem(SAVE_KEY); // 로컬 세이브 파기 — 새로고침 전이라 persistSave가 다시 쓸 일 없다
  localStorage.removeItem(CLOUD_BASE_KEY); // 삭제된 계정의 베이스 리비전도 함께
  // 예약된 귀환 알림도 파기 — 남겨두면 지워진 계정의 원정 알림이 울린다 (네이티브 전용, 웹 무동작)
  await import('../platform/returnAlarms').then((m) => m.cancelAllReturnAlarms()).catch(() => undefined);
  await supabase.auth.signOut(); // SIGNED_OUT → 새로고침 → 게이트 (완전한 신규 방문자 상태)
  return true;
}

/** 게임 마운트 후 1회 (main.ts) — 로그인 화해 + 자동 업로드 연결. dev-guest(세션 없음)면 전부 무동작 */
export function initCloudSync(): void {
  // DEV 전용 검증 손잡이 — 콘솔 동적 import는 HMR ?t= 때문에 딴 인스턴스를 받는다 (프로드에선 제거)
  if (import.meta.env.DEV) Object.assign(window, { __newworldCloud: { cloudSession, lastUploadedAt } });
  void reconcile();
  // 저장 변화 → 디바운스 업로드 (세션 없으면 아무 일도 없다).
  // 단 **다이아 잔액이 변하면 즉시 업로드** (2026-08-30 사용자) — 결제·쿠폰·출석·상점 소비
  // 어느 경로든 30초 창에서 유실되지 않게. 지점마다 심지 않고 여기 한 곳에서 감시한다
  let lastDiamonds: number | null = null;
  effect(() => {
    const state = save();
    if (!cloudSession()) return;
    const diamondsChanged = lastDiamonds !== null && state.wallet.diamonds !== lastDiamonds;
    lastDiamonds = state.wallet.diamonds;
    if (uploadTimer !== null) clearTimeout(uploadTimer);
    if (diamondsChanged) {
      void uploadNow(state);
      return;
    }
    uploadTimer = window.setTimeout(() => { void uploadNow(state); }, UPLOAD_DEBOUNCE_MS);
  });
  // 백그라운드 진입 시 즉시 업로드 (2026-08-29 실기기) — 모바일은 디바운스 30초가
  // 앱 전환·종료로 통째로 유실되기 쉽다. 이 플러시가 로컬·클라우드 드리프트를 원천 차단
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cloudSession()) flushUpload();
  });
}

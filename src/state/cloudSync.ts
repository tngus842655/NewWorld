/**
 * 클라우드 세이브 동기화 — saves 테이블 LWW 미러 + 회원 탈퇴 (ROADMAP M5, 2026-08-29).
 * store에 결합되므로 **게임 경로에서만** 로드한다 (게이트 경로는 cloud.ts만 —
 * 이 모듈이 게이트에 실리면 store가 빈 세이브를 만들어 저장해버린다, 2026-08-29 실사고).
 * 흐름: 로그인 직후 reconcile(서버와 lastSavedAt 비교·선택) → 저장은 30초 디바운스 업로드,
 * RNG 소비(뽑기·합성)는 flushUpload로 즉시. 실패는 조용히 무시 (비크리티컬 원칙).
 * 진실은 항상 클라 — 서버는 미러다 (0003_google_auth.sql).
 */
import { content } from '../content';
import { ensureTeams } from '../core/teams';
import type { SaveState } from '../core/types';
import { askConfirm } from '../ui/dialog';
import { toast } from '../ui/kit';
import * as clock from './clock';
import { cloudSession } from './cloud';
import { migrateSave } from './migrations';
import { SAVE_KEY } from './save';
import { effect, signal } from './signal';
import { save } from './store';
import { supabase } from './supabaseClient';

export const lastUploadedAt = signal<number | null>(null);

const UPLOAD_DEBOUNCE_MS = 30_000; // 저장이 잦아도 업로드는 30초에 한 번
let uploadTimer: number | null = null;

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
function applyCloudSave(data: unknown): boolean {
  try {
    const migrated = migrateSave(data);
    if (!migrated) return false;
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
  const ok = await askConfirm({
    title: '☁️ 클라우드에서 불러오기',
    message: `클라우드 저장: ${fmtStamp(Number(row.client_saved_at))}\n이 기기의 현재 진행을 덮어씁니다.`,
    confirmLabel: '불러오기',
    danger: true,
  });
  if (!ok) return;
  if (applyCloudSave(row.data)) toast('클라우드 세이브를 불러왔습니다', 'ok');
  else toast('세이브 버전이 앱보다 높습니다 — 앱을 새로고침해 주세요', 'error');
}

/** 로그인 직후 1회 — 서버 세이브 유무·시각 비교, 다르면 사용자 선택 (ROADMAP M5 스펙) */
async function reconcile(): Promise<void> {
  const session = cloudSession();
  if (!session) return;
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
  const useCloud = await askConfirm({
    title: '☁️ 클라우드 세이브 발견',
    message: `클라우드: ${fmtStamp(cloudAt)} 저장\n이 기기: ${fmtStamp(localAt)} 저장\n\n어느 쪽으로 이어서 할까요?\n[선택하지 않은 쪽은 다음 저장 때 덮어써집니다]`,
    confirmLabel: '클라우드 불러오기',
    cancelLabel: '이 기기 유지',
  });
  if (useCloud) {
    if (applyCloudSave(row.data)) toast('클라우드 세이브로 이어서 합니다', 'ok');
    else toast('세이브 버전이 앱보다 높습니다 — 앱을 새로고침해 주세요', 'error');
  } else {
    toast('이 기기 세이브를 유지합니다 — 다음 저장부터 클라우드를 덮어씁니다', 'ok');
  }
}

/**
 * 회원 탈퇴 — delete-account 엣지 함수가 본인 JWT 검증 후 계정을 삭제한다
 * (profiles·saves는 서버 cascade, 랭킹은 신원 해시 일치 시 함께). 성공하면 이 기기
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
  await supabase.auth.signOut(); // SIGNED_OUT → 새로고침 → 게이트 (완전한 신규 방문자 상태)
  return true;
}

/** 게임 마운트 후 1회 (main.ts) — 로그인 화해 + 자동 업로드 연결. dev-guest(세션 없음)면 전부 무동작 */
export function initCloudSync(): void {
  // DEV 전용 검증 손잡이 — 콘솔 동적 import는 HMR ?t= 때문에 딴 인스턴스를 받는다 (프로드에선 제거)
  if (import.meta.env.DEV) Object.assign(window, { __newworldCloud: { cloudSession, lastUploadedAt } });
  void reconcile();
  // 저장 변화 → 디바운스 업로드 (세션 없으면 아무 일도 없다)
  effect(() => {
    const state = save();
    if (!cloudSession()) return;
    if (uploadTimer !== null) clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(() => { void uploadNow(state); }, UPLOAD_DEBOUNCE_MS);
  });
}

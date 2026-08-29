/**
 * 클라우드 세이브 — 구글 로그인(Supabase Auth) + saves 테이블 LWW 동기화 (ROADMAP M5, 2026-08-29).
 * 로컬 우선: 로그인 없이 완전 오프라인 동작하고, 로그인하면 백업·복원이 생긴다.
 * 흐름: 로그인 감지 → 서버 세이브와 lastSavedAt 비교 → 다르면 선택 다이얼로그 →
 *       이후 저장은 디바운스 자동 업로드. 실패는 조용히 무시 (랭킹과 같은 비크리티컬 원칙).
 * 진실은 항상 클라 — 서버는 미러다 (0003_google_auth.sql).
 */
import { content } from '../content';
import { ensureTeams } from '../core/teams';
import type { SaveState } from '../core/types';
import { askConfirm } from '../ui/dialog';
import { toast } from '../ui/kit';
import * as clock from './clock';
import { migrateSave } from './migrations';
import { SAVE_KEY } from './save';
import { effect, signal } from './signal';
import { save } from './store';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

export const cloudSession = signal<Session | null>(null);
export const lastUploadedAt = signal<number | null>(null);

const UPLOAD_DEBOUNCE_MS = 30_000; // 저장이 잦아도 업로드는 30초에 한 번
let uploadTimer: number | null = null;
let reconciled = false; // 비교 다이얼로그는 로그인 세션당 1회

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
  // 로그인 시점 1회로는 이후 닉네임 변경이 영영 안 실렸다
  await supabase.from('profiles').upsert({
    id: session.user.id,
    nickname: body.profile.nickname,
    last_seen_at: new Date(at).toISOString(),
  });
  return true;
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
  // 프로필 자가 복구(가입 트리거 누락 대비) + 접속 흔적.
  // ⚠️ supabase-js 쿼리는 then 구독 시점에 실행되는 지연 thenable — void로 버리면
  // 요청 자체가 안 나간다 (2026-08-29 실사고: 닉네임이 영영 null이었다). 반드시 await.
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

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) toast(`구글 로그인 실패 [${error.message}]`, 'error');
}

export async function signOutGoogle(): Promise<void> {
  await supabase.auth.signOut();
  toast('로그아웃했습니다 — 게임은 이 기기에서 계속됩니다', 'ok');
}

/** OAuth 리디렉션이 에러를 들고 돌아온 경우 — 조용히 삼키면 "그냥 안 됨"으로 보인다 (2026-08-29 실사례) */
function surfaceAuthError(): void {
  const params = new URLSearchParams(window.location.search || window.location.hash.replace(/^#/, '?'));
  const code = params.get('error_code') ?? params.get('error');
  if (!code) return;
  const desc = params.get('error_description') ?? '';
  toast(`구글 로그인 실패 [${code}] ${desc}`, 'error');
  history.replaceState(null, '', window.location.pathname); // 새로고침 때 같은 토스트 반복 방지
}

/** 부팅 시 1회 (main.ts) — 세션 미러 + 자동 업로드 이펙트 연결 */
export function initCloud(): void {
  // DEV 전용 검증 손잡이 — 콘솔 동적 import는 HMR ?t= 때문에 딴 인스턴스를 받는다 (프로드에선 제거)
  if (import.meta.env.DEV) Object.assign(window, { __newworldCloud: { cloudSession } });
  surfaceAuthError();
  void supabase.auth.getSession().then(({ data }) => cloudSession.set(data.session));
  supabase.auth.onAuthStateChange((_event, session) => {
    cloudSession.set(session);
    if (!session) { reconciled = false; return; }
    if (!reconciled) {
      reconciled = true;
      void reconcile();
    }
  });
  // 저장 변화 → 디바운스 업로드 (로그아웃 상태면 아무 일도 없다)
  effect(() => {
    const state = save();
    if (!cloudSession()) return;
    if (uploadTimer !== null) clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(() => { void uploadNow(state); }, UPLOAD_DEBOUNCE_MS);
  });
}

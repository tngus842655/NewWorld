import type { GameState } from '../core/types';

/**
 * 저장소 추상화 — 게임 로직은 이 인터페이스만 알고,
 * 실제 저장이 localStorage인지 Supabase인지는 모르게 한다.
 * (싱글 프로토타입: LocalStorageAdapter, 이후: SupabaseAdapter)
 */
export interface StorageAdapter {
  load(): Promise<GameState | null>;
  save(state: GameState): Promise<void>;
}

const LOCAL_KEY = 'newworld:gamestate:v1';

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<GameState | null> {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GameState;
    } catch {
      console.warn('저장 데이터가 손상되어 새로 시작합니다.');
      return null;
    }
  }

  async save(state: GameState): Promise<void> {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  }
}

/**
 * 다른 세션(다른 탭·수동 SQL)이 더 최신 상태를 저장했을 때 발생.
 * 이 오류를 받으면 덮어쓰지 말고 다시 불러와야 한다.
 */
export class StaleStateError extends Error {
  constructor() {
    super('다른 세션이 더 최신 상태를 저장했습니다.');
    this.name = 'StaleStateError';
  }
}

const ROW_ID = 1;

/**
 * Supabase 어댑터. .env.local에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY가
 * 설정되어 있을 때만 선택된다. 테이블 스키마는 docs/PLAN.md 참고.
 *
 * 낙관적 동시성 제어: 마지막으로 본 updated_at 이후로 남이 쓰지 않았을 때만 저장한다.
 * 탭을 여러 개 열어두면 오래된 상태가 최신 상태를 통째로 날리기 때문.
 */
export class SupabaseAdapter implements StorageAdapter {
  private client: import('@supabase/supabase-js').SupabaseClient;
  /** 내가 알고 있는 서버 측 updated_at. null이면 아직 행이 없다 */
  private lastSeen: string | null = null;

  constructor(client: import('@supabase/supabase-js').SupabaseClient) {
    this.client = client;
  }

  async load(): Promise<GameState | null> {
    const { data, error } = await this.client
      .from('game_states')
      .select('state, updated_at')
      .eq('id', ROW_ID)
      .maybeSingle();
    if (error) throw new Error(`불러오기 실패: ${error.message}`);
    this.lastSeen = (data?.updated_at as string) ?? null;
    return (data?.state as GameState) ?? null;
  }

  async save(state: GameState): Promise<void> {
    const updatedAt = new Date(state.updatedAt).toISOString();

    if (this.lastSeen === null) {
      // 아직 행이 없다고 알고 있음 → 새로 만든다. 그 사이 누가 만들었으면 충돌.
      const { error } = await this.client
        .from('game_states')
        .insert({ id: ROW_ID, state, updated_at: updatedAt });
      if (error) {
        if (error.code === '23505') throw new StaleStateError(); // unique_violation
        throw new Error(`저장 실패: ${error.message}`);
      }
      this.lastSeen = updatedAt;
      return;
    }

    const { data, error } = await this.client
      .from('game_states')
      .update({ state, updated_at: updatedAt })
      .eq('id', ROW_ID)
      .lte('updated_at', this.lastSeen)
      .select('updated_at');
    if (error) throw new Error(`저장 실패: ${error.message}`);
    if (!data || data.length === 0) throw new StaleStateError();

    this.lastSeen = updatedAt;
  }
}

export async function createStorage(): Promise<StorageAdapter> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) {
    const { createClient } = await import('@supabase/supabase-js');
    return new SupabaseAdapter(createClient(url, key));
  }
  return new LocalStorageAdapter();
}

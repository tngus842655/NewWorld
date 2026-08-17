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
 * Supabase 어댑터. .env.local에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY가
 * 설정되어 있을 때만 선택된다. 테이블 스키마는 docs/PLAN.md 참고.
 */
export class SupabaseAdapter implements StorageAdapter {
  private client: import('@supabase/supabase-js').SupabaseClient;

  constructor(client: import('@supabase/supabase-js').SupabaseClient) {
    this.client = client;
  }

  async load(): Promise<GameState | null> {
    const { data, error } = await this.client
      .from('game_states')
      .select('state')
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`불러오기 실패: ${error.message}`);
    return (data?.state as GameState) ?? null;
  }

  async save(state: GameState): Promise<void> {
    const { error } = await this.client
      .from('game_states')
      .upsert({ id: 1, state, updated_at: new Date(state.updatedAt).toISOString() });
    if (error) throw new Error(`저장 실패: ${error.message}`);
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

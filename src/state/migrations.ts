/**
 * 세이브 마이그레이션 체인 (TECH.md §8) — v(n) → v(n+1) 순수 함수만 등록한다.
 * 스키마가 바뀌면 여기에 단계를 추가하고 tests/save.test.ts에 케이스를 더한다.
 */
import type { SaveState } from '../core/types';

export const CURRENT_SAVE_VERSION = 1;

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** version n에서 n+1로 올리는 함수. v1이 최초 버전이라 아직 비어 있다. */
const MIGRATIONS: Record<number, Migration> = {};

export function migrateSave(raw: unknown): SaveState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  let data = raw as Record<string, unknown>;
  let version = typeof data['version'] === 'number' ? (data['version'] as number) : 0;
  if (version < 1 || version > CURRENT_SAVE_VERSION) return null;
  while (version < CURRENT_SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return null;
    data = step(data);
    version++;
    data['version'] = version;
  }
  return data as unknown as SaveState;
}

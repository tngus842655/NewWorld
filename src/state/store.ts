/**
 * 루트 스토어 — 세이브 signal + 액션. UI는 여기 액션만 부른다 (core 직접 호출 금지).
 * 모든 액션: core 순수 함수 호출 → 성공 시 save.set, GameError는 토스트로.
 */
import { content } from '../content';
import {
  awakenMonster,
  buyPartySlot,
  craftRecipe,
  enhanceArtifact,
  fuseMonsters,
  levelUpMonster,
  fuseArtifacts,
  salvageArtifact,
  unlockRegion,
  type ArtifactFusionInput,
  type ArtifactFusionResult,
  type FusionInput,
  type FusionResult,
} from '../core/economy';
import {
  chooseCrossroad,
  claimExpedition,
  createExpedition,
  previewCrossroads,
  type ExpeditionInput,
} from '../core/expedition';
import { createInitialSave } from '../core/newgame';
import { GameError, type CoreCtx, type CrossroadChoice, type Journal, type SaveState } from '../core/types';
import { toast } from '../ui/kit';
import * as clock from './clock';
import { loadSave, persistSave } from './save';
import { effect, signal } from './signal';

// ── ctx (실환경) ─────────────────────────────────────────────────────────────
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const ctx: CoreCtx = {
  now: clock.now,
  newSeed: () => randomHex(8),
  newUid: () => randomHex(6),
};

// ── 상태 ─────────────────────────────────────────────────────────────────────
export const save = signal<SaveState>(loadSave() ?? createInitialSave(content, ctx));
export const nowTick = signal(clock.now());

setInterval(() => nowTick.set(clock.now()), 1000);
clock.onClockJump(() => nowTick.set(clock.now()));

effect(() => persistSave(save(), clock.now()));

export const TUTORIAL_SCOUT_MS = 30_000; // 첫 정찰 30초 압축 (GDD §11)

// ── 액션 ─────────────────────────────────────────────────────────────────────
function act<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (error) {
    if (error instanceof GameError) {
      toast(error.message, 'error');
      return null;
    }
    throw error;
  }
}

/** 반복 과업 달성 알림 — 코어가 tasks 카운트를 올려두면 이전 상태와의 차이로 감지해 토스트 */
function notifyNewTasks(prev: SaveState, next: SaveState): void {
  for (const task of content.tasks) {
    const diff = (next.tasks[task.id] ?? 0) - (prev.tasks[task.id] ?? 0);
    if (diff <= 0) continue;
    const rewards = [
      task.reward.gold > 0 ? `골드 ${task.reward.gold * diff}` : null,
      task.reward.dust > 0 ? `가루 ${task.reward.dust * diff}` : null,
    ].filter(Boolean).join(' · ');
    toast(`${task.icon} 과업 달성 — ${task.name}${diff > 1 ? ` ×${diff}` : ''} (${rewards})`, 'ok');
  }
}

export function dispatchExpedition(input: ExpeditionInput): boolean {
  return (
    act(() => {
      const result = createExpedition(content, save(), input, ctx);
      const next = result.save;
      // 튜토리얼: 첫 파견은 30초 만에 돌아온다
      if (!next.profile.tutorialDone) {
        const expedition = next.expeditions.find((e) => e.id === result.expedition.id)!;
        expedition.endsAt = expedition.startedAt + TUTORIAL_SCOUT_MS;
      }
      // 마지막 편성을 팀 프리셋으로 기억
      const team = next.teams[0];
      if (team) {
        team.partyIds = [...input.partyIds];
        team.artifactUids = [...input.artifactUids];
      }
      save.set(next);
      toast('원정대가 출발했습니다!', 'ok');
      return true;
    }) ?? false
  );
}

export function claim(expeditionId: string): { journal: Journal; newMilestones: string[] } | null {
  return act(() => {
    const prev = save();
    const result = claimExpedition(content, prev, expeditionId, ctx);
    let next = result.save;
    if (!next.profile.tutorialDone) {
      next = { ...next, profile: { ...next.profile, tutorialDone: true } };
    }
    save.set(next);
    notifyNewTasks(prev, next);
    return { journal: result.journal, newMilestones: result.newMilestones };
  });
}

export function choose(expeditionId: string, index: number, choice: CrossroadChoice): void {
  act(() => {
    save.set(chooseCrossroad(save(), expeditionId, index, choice));
    toast(choice === 'risky' ? '위험을 감수하기로 했습니다' : '안전한 길을 택했습니다', 'ok');
  });
}

export function crossroadsOf(expeditionId: string) {
  const expedition = save().expeditions.find((e) => e.id === expeditionId && !e.claimed);
  if (!expedition) return [];
  return previewCrossroads(content, save(), expedition);
}

export function levelUp(monsterId: string): boolean {
  return act(() => {
    save.set(levelUpMonster(content, save(), monsterId));
    return true;
  }) !== null;
}
export function awaken(monsterId: string): boolean {
  return act(() => {
    save.set(awakenMonster(content, save(), monsterId));
    toast('각성! 성급이 올랐습니다 ★', 'ok');
    return true;
  }) !== null;
}
/** 카드 합성 — 결과를 UI 연출용으로 그대로 돌려준다 (실패도 정상 결과) */
export function fuse(input: FusionInput): FusionResult | null {
  return act(() => {
    const prev = save();
    const result = fuseMonsters(content, prev, input, ctx);
    save.set(result.save);
    notifyNewTasks(prev, result.save);
    return result;
  });
}
/** 유물 합성 — 카드 합성과 동일 규칙·확률 */
export function fuseArtifact(input: ArtifactFusionInput): ArtifactFusionResult | null {
  return act(() => {
    const prev = save();
    const result = fuseArtifacts(content, prev, input, ctx);
    save.set(result.save);
    notifyNewTasks(prev, result.save);
    return result;
  });
}

export function craft(recipeId: string): boolean {
  return act(() => {
    const prev = save();
    const next = craftRecipe(content, prev, recipeId);
    save.set(next);
    toast('제작 완료', 'ok');
    notifyNewTasks(prev, next);
    return true;
  }) !== null;
}

/** 랭킹 닉네임 변경 — 2~12자, 공백 정리 */
export function setNickname(raw: string): boolean {
  const nickname = raw.trim().slice(0, 12);
  if (nickname.length < 2) {
    toast('닉네임은 2~12자로 입력해 주세요', 'error');
    return false;
  }
  const state = save();
  save.set({ ...state, profile: { ...state.profile, nickname } });
  toast('닉네임을 변경했습니다', 'ok');
  return true;
}
export function enhance(uid: string): boolean {
  return act(() => {
    save.set(enhanceArtifact(content, save(), uid));
    return true;
  }) !== null;
}
export function salvage(uid: string): boolean {
  return act(() => {
    save.set(salvageArtifact(content, save(), uid));
    toast('유물을 분해해 가루를 얻었습니다', 'ok');
    return true;
  }) !== null;
}
export function unlock(regionId: string): void {
  act(() => {
    save.set(unlockRegion(content, save(), regionId));
    const name = content.regions.get(regionId)?.name ?? regionId;
    toast(`${name} 해금!`, 'ok');
  });
}
export function buySlot(): boolean {
  return act(() => {
    save.set(buyPartySlot(content, save()));
    toast('파티 슬롯이 늘었습니다', 'ok');
    return true;
  }) !== null;
}

export function toggleSound(): void {
  const state = save();
  save.set({ ...state, settings: { ...state.settings, sound: !state.settings.sound } });
}

export function resetSave(): void {
  save.set(createInitialSave(content, ctx));
  toast('새 게임을 시작했습니다', 'ok');
}

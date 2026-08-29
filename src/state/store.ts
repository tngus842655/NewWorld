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
  recallExpedition,
  recallReturnEndsAt,
  useHourglass,
  type ExpeditionInput,
  type UseHourglassResult,
} from '../core/expedition';
import { accountBonusState } from '../core/accountBonus';
import { adInstantReturn, applyScentBuff, doubleJournalRewards } from '../core/ads';
import { checkIn, type CheckInResult } from '../core/attendance';
import { createInitialSave } from '../core/newgame';
import { buyShopProduct, grantShopAdExtra, type ShopBuyInput, type ShopBuyResult } from '../core/shop';
import { ensureTeams, setTeamLoadout } from '../core/teams';
import { GameError, type CoreCtx, type CrossroadChoice, type Journal, type SaveState } from '../core/types';
import { describeEffect } from '../ui/effectText';
import { fmtRemain, josa, toast } from '../ui/kit';
import * as clock from './clock';
import { submitScore } from './ranking';
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
// ensureTeams: 해금된 군 수만큼 프리셋 보장 (v5 군 시스템)
export const save = signal<SaveState>(ensureTeams(content, loadSave() ?? createInitialSave(content, ctx)));
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
    toast(`${task.icon} 과업 달성 [${task.name}${diff > 1 ? ` ×${diff}` : ''}] (${rewards})`, 'ok');
  }
}

/** 군 프리셋으로 파견 (2026-08-23) — 편성은 원정대 카드에서, 파견은 군 단위 */
export function dispatchTeam(teamId: string, regionId: string, tier: ExpeditionInput['tier']): boolean {
  return (
    act(() => {
      const state = save();
      const team = state.teams.find((t) => t.id === teamId);
      if (!team) throw new GameError('team-missing', '없는 원정대입니다');
      const partyIds = team.partyIds.filter((id) => state.roster.some((m) => m.monsterId === id));
      const artifactIds = team.artifactIds.filter((itemId) => state.artifacts.some((a) => a.itemId === itemId));
      const result = createExpedition(content, state, { regionId, tier, partyIds, artifactIds, teamId }, ctx);
      const next = result.save;
      // 튜토리얼: 첫 파견은 30초 만에 돌아온다
      if (!next.profile.tutorialDone) {
        const expedition = next.expeditions.find((e) => e.id === result.expedition.id)!;
        expedition.endsAt = expedition.startedAt + TUTORIAL_SCOUT_MS;
      }
      save.set(next);
      toast(`${team.name} 원정대가 출발했습니다!`, 'ok');
      return true;
    }) ?? false
  );
}

/** 군 편성 저장 — 검증 실패는 토스트 */
export function setTeam(teamId: string, partyIds: string[], artifactIds: string[]): boolean {
  return act(() => {
    save.set(setTeamLoadout(content, save(), teamId, partyIds, artifactIds));
    return true;
  }) !== null;
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
    void submitScore(next); // 랭킹 갱신 — 실패는 조용히 무시 (오프라인 무관)
    return { journal: result.journal, newMilestones: result.newMilestones };
  });
}

/** 회군 — 보상 없이 귀로에 올린다. 복귀 소요는 현 위치 기준, 적재 미끼는 즉시 환급 (확인 다이얼로그는 UI 담당) */
export function recall(expeditionId: string): void {
  act(() => {
    const state = save();
    const expedition = state.expeditions.find((e) => e.id === expeditionId && !e.claimed);
    const teamName = expedition?.teamId ? state.teams.find((t) => t.id === expedition.teamId)?.name : null;
    const next = recallExpedition(state, expeditionId, ctx.now());
    save.set(next);
    const returnEnds = recallReturnEndsAt(next.expeditions.find((e) => e.id === expeditionId)!)!;
    toast(`🏳️ ${josa(teamName ?? '원정대', '이', '가')} 회군합니다 — ${fmtRemain(returnEnds - ctx.now())} 후 복귀`, 'ok');
  });
}

/** 모래시계 사용 — 결과(단축량·귀환 여부)는 UI가 연출용으로 사용 */
export function useHourglassOn(expeditionId: string, hourglassId: string): UseHourglassResult | null {
  return act(() => {
    const result = useHourglass(content, save(), expeditionId, hourglassId, ctx.now());
    save.set(result.save);
    return result;
  });
}

// ── 광고 보상 (GDD §9.2) — 시청 성공 검증 후 호출된다 (platform/ads.ts) ──────

/** 광고: 즉시 귀환 — 남은 시간 전부 단축. 한도·회군 검증은 core/ads.ts */
export function grantAdInstantReturn(expeditionId: string): boolean {
  return (
    act(() => {
      save.set(adInstantReturn(content, save(), expeditionId, ctx.now()));
      toast('📺 원정대가 돌아왔습니다! [일지를 확인하세요]', 'ok');
      return true;
    }) ?? false
  );
}

/** 광고: 야생의 향기 — scentMinutes 동안 포획률 ×adBuffMult (버프 중 출발한 원정에 적용) */
export function grantAdScent(): boolean {
  return (
    act(() => {
      save.set(applyScentBuff(content, save(), ctx.now()));
      toast(`🌿 야생의 향기! ${content.balance.ads.scentMinutes}분 안에 출발하는 원정은 전부 포획률 ×${content.balance.capture.adBuffMult}`, 'ok');
      return true;
    }) ?? false
  );
}

/** 광고: 상점 한도 연장 — 골드관 일일 한도 상품의 오늘 한도 +1 (상품당 하루 1회) */
export function grantAdShopExtra(productId: string): boolean {
  return (
    act(() => {
      save.set(grantShopAdExtra(content, save(), productId, ctx.now()));
      toast('📺 오늘 1회 더 구매할 수 있습니다!', 'ok');
      return true;
    }) ?? false
  );
}

/** 광고: 일지 정산 2배 (원정당 1회) — 받은 골드·재료만큼 한 번 더 */
export function grantJournalDouble(expeditionId: string): { gold: number } | null {
  return act(() => {
    const result = doubleJournalRewards(save(), expeditionId);
    save.set(result.save);
    toast(`📺 보상 2배 수령! [골드 +${result.gold.toLocaleString('ko-KR')}]`, 'ok');
    return { gold: result.gold };
  });
}

/** DEV: 다이아 +1,000 — 다이아 상점 테스트용 (DEV 빌드에서만 UI 노출) */
export function devGrantDiamonds(): void {
  const state = save();
  save.set({ ...state, wallet: { ...state.wallet, diamonds: state.wallet.diamonds + 1000 } });
  toast('💎 DEV [다이아 +1,000]', 'ok');
}

/** DEV: 모래시계 각 1개씩 지급 — 가속 기능 테스트용 (DEV 빌드에서만 UI 노출) */
export function devGrantHourglasses(): void {
  const state = save();
  const hourglasses = { ...state.wallet.hourglasses };
  for (const def of content.hourglassList) hourglasses[def.id] = (hourglasses[def.id] ?? 0) + 1;
  save.set({ ...state, wallet: { ...state.wallet, hourglasses } });
  toast('⏳ DEV [모래시계 각 +1]', 'ok');
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

/** 육성 액션 뒤 영구 보너스 계단 상승 검사 — 달성 순간을 토스트로 (GDD §4.6 킥) */
function checkBonusTier(axis: 'training' | 'resonance', before: number): void {
  const st = accountBonusState(content, save())[axis];
  if (st.active <= before) return;
  const label = axis === 'training' ? '🐾 조련' : '🔮 공명';
  const gained = st.tiers.slice(before, st.active).flatMap((t) => t.effects.map(describeEffect));
  toast(`🎖 ${label} ${st.active}계단 달성! [${gained.join(' · ')}]`, 'ok');
}
export function levelUp(monsterId: string): boolean {
  return act(() => {
    const before = accountBonusState(content, save()).training.active;
    save.set(levelUpMonster(content, save(), monsterId));
    checkBonusTier('training', before);
    return true;
  }) !== null;
}
export function awaken(monsterId: string): boolean {
  return act(() => {
    const before = accountBonusState(content, save()).training.active;
    save.set(awakenMonster(content, save(), monsterId));
    toast('각성! 성급이 올랐습니다 ★', 'ok');
    checkBonusTier('training', before);
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

/** 상점 구매 — 결과는 UI가 연출·안내용으로 사용 */
export function buyShop(input: ShopBuyInput): ShopBuyResult | null {
  return act(() => {
    const result = buyShopProduct(content, save(), input, ctx);
    save.set(result.save);
    return result;
  });
}

/** 출석 도장 — 결과(보상·n일차)는 UI가 연출용으로 사용 */
export function checkInToday(): CheckInResult | null {
  return act(() => {
    const result = checkIn(content, save(), ctx.now());
    save.set(result.save);
    return result;
  });
}

/** 랭킹 닉네임 변경 — 2~12자, 공백 정리 */
export function setNickname(raw: string): boolean {
  const nickname = raw.trim().slice(0, 12);
  if (nickname.length < 2) {
    toast('닉네임은 2~12자로 입력해 주세요', 'error');
    return false;
  }
  const state = save();
  const next = { ...state, profile: { ...state.profile, nickname } };
  save.set(next);
  toast('닉네임을 변경했습니다', 'ok');
  void submitScore(next);
  return true;
}
export function enhance(uid: string): boolean {
  return act(() => {
    const before = accountBonusState(content, save()).resonance.active;
    save.set(enhanceArtifact(content, save(), uid));
    checkBonusTier('resonance', before);
    return true;
  }) !== null;
}
export function unlock(regionId: string): void {
  act(() => {
    // 지역 해금은 군 확장으로 이어질 수 있다 — ensureTeams로 프리셋 즉시 생성
    save.set(ensureTeams(content, unlockRegion(content, save(), regionId)));
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

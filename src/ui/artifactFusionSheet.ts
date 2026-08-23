/**
 * 유물 합성 시트 (GDD §4.5) — 카드 합성과 동일한 흐름·확률: setup → ritual → result.
 * 재료는 강화 안 한 유물부터 자동 선택, 실패 시 1개는 그대로 보존.
 */
import { content } from '../content';
import type { ArtifactRarity } from '../content/schema';
import type { ArtifactFusionInput, ArtifactFusionResult } from '../core/economy';
import type { OwnedArtifact, SaveState } from '../core/types';
import { batch, signal } from '../state/signal';
import { fuseArtifact, save } from '../state/store';
import { artifactIcon } from './components';
import { ARTIFACT_RARITY_LABEL, SLOT_LABEL, el } from './kit';
import { FUSION_NEXT, ritualCircle } from './fusionSheet';
import { pct1, sheetShell } from './overlays';
import { playSfx } from './sfx';

const RITUAL_MS = 1500;

type Phase = 'setup' | 'ritual' | 'result';
const afRarity = signal<ArtifactRarity>('common');
const afRounds = signal(1);
const afPhase = signal<Phase>('setup');
const afResults = signal<ArtifactFusionResult[]>([]);
const afRevealed = signal<number[]>([]);
let ritualTimer: ReturnType<typeof setTimeout> | null = null;

/** 유물 합성 시트를 초기 상태로 — 진입 버튼에서 호출 */
export function resetArtifactFusion(): void {
  if (ritualTimer) {
    clearTimeout(ritualTimer);
    ritualTimer = null;
  }
  afPhase.set('setup');
  afRounds.set(1);
  afResults.set([]);
  afRevealed.set([]);
}

// ── 재료 후보·자동 계획 ──────────────────────────────────────────────────────

/** 해당 등급의 재료 후보 — 파견 중 장착분 제외, 아깝지 않은 것(강화 낮음·부옵션 적음)부터 */
function materialsOf(state: SaveState, rarity: ArtifactRarity): OwnedArtifact[] {
  const busy = new Set(state.expeditions.filter((e) => !e.claimed).flatMap((e) => e.artifactUids));
  return state.artifacts
    .filter((a) => !busy.has(a.uid) && content.artifacts.get(a.itemId)?.rarity === rarity)
    .sort((a, b) => a.enhance - b.enhance || a.substats.length - b.substats.length);
}

function planBatches(state: SaveState, rarity: ArtifactRarity, rounds: number): ArtifactFusionInput[] {
  const pool = materialsOf(state, rarity);
  const batches: ArtifactFusionInput[] = [];
  for (let i = 0; i < rounds; i++) {
    const pair = pool.slice(i * 2, i * 2 + 2);
    if (pair.length < 2) break;
    batches.push({ materialUids: pair.map((a) => a.uid) });
  }
  return batches;
}

function startRitual(rarity: ArtifactRarity, rounds: number): void {
  afPhase.set('ritual');
  playSfx('enhance');
  ritualTimer = setTimeout(() => {
    ritualTimer = null;
    const plans = planBatches(save(), rarity, rounds);
    const results: ArtifactFusionResult[] = [];
    batch(() => {
      for (const plan of plans) {
        const result = fuseArtifact(plan);
        if (!result) break;
        results.push(result);
      }
      afResults.set(results);
      afRevealed.set([]);
      afPhase.set('result');
    });
    const successes = results.filter((r) => r.success).length;
    playSfx(successes > 0 ? 'confirm' : 'capture-miss');
  }, RITUAL_MS);
}

// ── 화면 ─────────────────────────────────────────────────────────────────────

export function artifactFusionSheet(): HTMLElement {
  const state = save();
  const { fusion } = content.balance;
  const rarity = afRarity();
  const phase = afPhase();
  const nextRarity = FUSION_NEXT[rarity]!;
  const chance = fusion.chance[rarity] ?? 0;

  if (phase === 'ritual') {
    return sheetShell('유물 합성',
      ritualCircle(nextRarity, el('span.ritual-q', {}, '?'), true),
      el('div.center.ritual-caption', {}, '✨ 유물이 빛에 휩싸입니다…'),
    );
  }

  if (phase === 'result') return resultView(rarity, nextRarity);

  // ── setup ──
  const pool = materialsOf(state, rarity);
  const maxRounds = Math.floor(pool.length / fusion.materials);
  const rounds = Math.min(Math.max(1, afRounds()), Math.max(1, maxRounds));

  const countOf = (r: ArtifactRarity) => materialsOf(state, r).length;
  const tabs = (['common', 'uncommon', 'rare', 'heroic'] as const).map((r) =>
    el(`button.chip${rarity === r ? '.active' : ''}`, {
      onclick: () => {
        afRarity.set(r);
        afRounds.set(1);
      },
    }, `${ARTIFACT_RARITY_LABEL[r]} ${countOf(r)}`),
  );

  // 마법진 코어: 이번에 재료가 될 상위 3개 미리보기
  const preview = pool.length > 0
    ? el('div.ritual-preview', {}, ...pool.slice(0, 3).map((a) => artifactIcon(a.itemId)))
    : el('span.ritual-q', {}, '?');

  const resultPool = (content.artifactsByRarity.get(nextRarity) ?? []).length;
  const setRounds = (n: number) => afRounds.set(Math.min(Math.max(1, n), Math.max(1, maxRounds)));

  return sheetShell('유물 합성',
    el('div.chips-wrap', {}, ...tabs),
    ritualCircle(nextRarity, preview, false),
    el('div.center.muted.small', {},
      pool.length > 0
        ? `${ARTIFACT_RARITY_LABEL[rarity]} 유물 ${pool.length}개 — 최대 ${maxRounds}회 합성 가능`
        : `${ARTIFACT_RARITY_LABEL[rarity]} 유물이 없습니다 — 원정에서 발굴해 보세요`),

    el('div.card.stack-sm', {},
      el('div.list-row', {},
        el('span', {}, '합성 횟수'),
        el('div.rounds-ctl', {},
          el('button.btn.btn-ghost.small-btn', { disabled: rounds <= 1, onclick: () => setRounds(rounds - 1) }, '−'),
          el('strong.rounds-num', {}, `${maxRounds > 0 ? rounds : 0}회`),
          el('button.btn.btn-ghost.small-btn', { disabled: rounds >= maxRounds, onclick: () => setRounds(rounds + 1) }, '+'),
          el('button.btn.btn-ghost.small-btn', { disabled: maxRounds < 2 || rounds >= maxRounds, onclick: () => setRounds(maxRounds) }, '최대'),
        ),
      ),
      el('div.list-row', {},
        el('span', {}, '소모 유물'),
        el('span.small', {}, maxRounds > 0 ? `${rounds * fusion.materials}개 (강화 안 한 유물부터 자동 선택)` : '—'),
      ),
      el('div.list-row', {},
        el('span', {}, '성공 확률'),
        el('strong', {}, `회당 ${pct1(chance)}`),
      ),
      el('div.list-row', {},
        el('span', {}, '결과'),
        el('span.small.muted', {}, `성공 시 ${ARTIFACT_RARITY_LABEL[nextRarity]} ${resultPool}종 중 랜덤 · 실패 시 1개 반환`),
      ),
      el('button.btn.btn-primary.btn-big', {
        disabled: maxRounds < 1,
        onclick: () => startRitual(rarity, rounds),
      }, maxRounds < 1
        ? '재료 유물이 부족합니다'
        : `💠 합성 시작 — ${ARTIFACT_RARITY_LABEL[rarity]} → ${ARTIFACT_RARITY_LABEL[nextRarity]} ${rounds}회`),
    ),
    el('div.center.muted.small', {}, '파견 중 장착한 유물은 재료가 되지 않습니다 · 재료의 강화에 쓴 가루는 전액 돌려받습니다'),
  );
}

function resultView(rarity: ArtifactRarity, nextRarity: ArtifactRarity): HTMLElement {
  const results = afResults();
  const revealed = afRevealed();
  const successes = results.filter((r) => r.success).length;
  const fails = results.length - successes;
  const unrevealed = results.filter((r, i) => r.success && !revealed.includes(i)).length;

  const reveal = (index: number) => {
    if (afRevealed().includes(index)) return;
    afRevealed.set([...afRevealed(), index]);
    playSfx('artifact');
  };

  const cards = results.map((result, index) => {
    if (!result.success) {
      const kept = result.returnedUid ? save().artifacts.find((a) => a.uid === result.returnedUid) : null;
      const keptName = kept ? content.artifacts.get(kept.itemId)?.name : null;
      return el('div.fuse-card.fuse-fail', {},
        el('div.fuse-fail-mark', {}, '💨'),
        el('div.fuse-card-name.muted', {}, '실패'),
        keptName ? el('div.fuse-card-sub', {}, `${keptName} 반환`) : null,
      );
    }
    if (!revealed.includes(index)) {
      const back = el('button.fuse-card.fuse-back', { onclick: () => reveal(index) },
        el('div.fuse-q', {}, '?'),
        el('div.fuse-card-sub', {}, '탭하여 공개'),
      );
      back.style.borderColor = `var(--rar-${nextRarity})`;
      back.style.boxShadow = `0 0 14px var(--rar-${nextRarity})`;
      return back;
    }
    const def = content.artifacts.get(result.resultItemId!)!;
    const card = el('div.fuse-card.fuse-open', {},
      artifactIcon(def.id),
      el('div.fuse-card-name', {}, def.name),
      el('div.fuse-card-sub', {}, `[${ARTIFACT_RARITY_LABEL[def.rarity]} ${SLOT_LABEL[def.slot]}]`),
    );
    card.style.borderColor = `var(--rar-${def.rarity})`;
    return card;
  });

  const totalRefund = results.reduce((sum, r) => sum + r.refundedDust, 0);

  return sheetShell('유물 합성',
    el('div.center.fusion-summary', {},
      el('div.fusion-summary-title', {}, `${ARTIFACT_RARITY_LABEL[rarity]} ${results.length}회 합성 완료`),
      el('div.small', {},
        el('span.jcapture', {}, `성공 ${successes}`),
        el('span.muted', {}, ' · '),
        el('span.jmiss', {}, `실패 ${fails}`),
      ),
      totalRefund > 0 ? el('div.small.muted', {}, `✨ 재료의 강화 가루 ${totalRefund} 환급`) : null,
    ),
    el('div.fuse-grid', {}, ...cards),
    el('div.row-gap.fusion-actions', {},
      unrevealed > 0
        ? el('button.btn.btn-primary', {
            onclick: () => {
              afRevealed.set(afResults().map((_, i) => i).filter((i) => afResults()[i]!.success));
              playSfx('artifact');
            },
          }, `모두 공개 (${unrevealed})`)
        : null,
      el('button.btn.btn-ghost', {
        onclick: () => {
          afPhase.set('setup');
          afResults.set([]);
          afRevealed.set([]);
          afRounds.set(1);
        },
      }, '다시 합성'),
    ),
  );
}

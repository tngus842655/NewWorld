/**
 * 유물 합성 시트 (GDD §4.5) — 카드 합성과 완전 동일한 흐름·규칙 (v6 종 단위):
 * setup(등급·횟수) → ritual(마법진) → result(?카드 공개). 재료는 여분(count-1)에서 자동 선택.
 */
import { content } from '../content';
import type { ArtifactRarity } from '../content/schema';
import type { ArtifactFusionInput, ArtifactFusionResult } from '../core/economy';
import type { SaveState } from '../core/types';
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

// ── 여분 계산·자동 재료 계획 (카드 합성과 동일) ──────────────────────────────

function spareMap(state: SaveState, rarity: ArtifactRarity): Map<string, number> {
  const spares = new Map<string, number>();
  for (const owned of state.artifacts) {
    if (content.artifacts.get(owned.itemId)?.rarity !== rarity) continue;
    if (owned.count > 1) spares.set(owned.itemId, owned.count - 1);
  }
  return spares;
}

const sumOf = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);

/** 회당 2개를 여분 최다 종부터 균등하게 뽑는 자동 계획 */
function planBatches(state: SaveState, rarity: ArtifactRarity, rounds: number): ArtifactFusionInput[] {
  const spares = spareMap(state, rarity);
  const take = (): string | null => {
    let best: string | null = null;
    let bestN = 0;
    for (const [itemId, n] of spares) {
      if (n > bestN) {
        best = itemId;
        bestN = n;
      }
    }
    if (!best) return null;
    spares.set(best, bestN - 1);
    return best;
  };
  const batches: ArtifactFusionInput[] = [];
  for (let i = 0; i < rounds; i++) {
    const a = take();
    const b = take();
    if (!a || !b) break;
    batches.push({
      materials: a === b
        ? [{ itemId: a, count: 2 }]
        : [{ itemId: a, count: 1 }, { itemId: b, count: 1 }],
    });
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
  const spares = spareMap(state, rarity);
  const total = sumOf(spares);
  const maxRounds = Math.floor(total / fusion.materials);
  const rounds = Math.min(Math.max(1, afRounds()), Math.max(1, maxRounds));

  const spareByRarity = (r: ArtifactRarity) => sumOf(spareMap(state, r));
  const tabs = (['common', 'uncommon', 'rare', 'heroic'] as const).map((r) =>
    el(`button.chip${rarity === r ? '.active' : ''}`, {
      onclick: () => {
        afRarity.set(r);
        afRounds.set(1);
      },
    }, `${ARTIFACT_RARITY_LABEL[r]} ${spareByRarity(r)}`),
  );

  // 마법진 코어: 여분 상위 3종 미리보기
  const topSpares = [...spares.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const preview = topSpares.length > 0
    ? el('div.ritual-preview', {}, ...topSpares.map(([itemId]) => artifactIcon(itemId)))
    : el('span.ritual-q', {}, '?');

  const resultPool = (content.artifactsByRarity.get(nextRarity) ?? []).length;
  const setRounds = (n: number) => afRounds.set(Math.min(Math.max(1, n), Math.max(1, maxRounds)));

  return sheetShell('유물 합성',
    el('div.chips-wrap', {}, ...tabs),
    ritualCircle(nextRarity, preview, false),
    el('div.center.muted.small', {},
      total > 0
        ? `${ARTIFACT_RARITY_LABEL[rarity]} 여분 ${total}개 [최대 ${maxRounds}회 합성 가능]`
        : `${ARTIFACT_RARITY_LABEL[rarity]} 여분 유물이 없습니다 [중복 획득으로 모아보세요]`),

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
        el('span.small', {}, maxRounds > 0 ? `여분 ${rounds * fusion.materials}개 (여분이 많은 종부터 자동 선택)` : '—'),
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
        ? '여분 유물이 부족합니다'
        : `💠 합성 시작 [${ARTIFACT_RARITY_LABEL[rarity]} → ${ARTIFACT_RARITY_LABEL[nextRarity]} ${rounds}회]`),
    ),
    el('div.center.muted.small', {}, '각 종의 마지막 1개는 재료로 쓰지 않습니다 (강화 보호)'),
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
    const result = afResults()[index]!;
    playSfx(result.isNew ? 'capture-new' : 'artifact');
  };

  const cards = results.map((result, index) => {
    if (!result.success) {
      const returned = result.returnedItemId ? content.artifacts.get(result.returnedItemId)?.name : null;
      return el('div.fuse-card.fuse-fail', {},
        el('div.fuse-fail-mark', {}, '💨'),
        el('div.fuse-card-name.muted', {}, '실패'),
        returned ? el('div.fuse-card-sub', {}, `${returned} 1개 반환`) : null,
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
      el('div.fuse-card-sub', {},
        result.isNew
          ? el('span.fuse-new', {}, '✨ 신규 유물!')
          : el('span.muted', {}, `[${ARTIFACT_RARITY_LABEL[def.rarity]} ${SLOT_LABEL[def.slot]}] +1`),
      ),
    );
    card.classList.add(`rar-${def.rarity}`); // 영웅·전설 공개 시 글로우·맥동 (styles.css)
    card.style.borderColor = `var(--rar-${def.rarity})`;
    return card;
  });

  return sheetShell('유물 합성',
    el('div.center.fusion-summary', {},
      el('div.fusion-summary-title', {}, `${ARTIFACT_RARITY_LABEL[rarity]} ${results.length}회 합성 완료`),
      el('div.small', {},
        el('span.jcapture', {}, `성공 ${successes}`),
        el('span.muted', {}, ' · '),
        el('span.jmiss', {}, `실패 ${fails}`),
      ),
    ),
    el('div.fuse-grid', {}, ...cards),
    el('div.row-gap.fusion-actions', {},
      unrevealed > 0
        ? el('button.btn.btn-primary', {
            onclick: () => {
              afRevealed.set(afResults().map((_, i) => i).filter((i) => afResults()[i]!.success));
              playSfx(afResults().some((r) => r.isNew) ? 'capture-new' : 'artifact');
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

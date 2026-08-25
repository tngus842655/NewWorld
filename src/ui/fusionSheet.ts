/**
 * 카드 합성 시트 (GDD §4.5) — 등급 단위 일괄 합성 + 의식 연출 + ?카드 공개.
 * 흐름: setup(등급·횟수 선택) → ritual(마법진 연출) → result(?카드 탭 공개).
 */
import { content } from '../content';
import type { MonsterRarity } from '../content/schema';
import { RARITY_NEXT, type FusionInput, type FusionResult } from '../core/economy';
import { isRegionUnlocked } from '../core/progression';
import type { SaveState } from '../core/types';
import { batch, signal } from '../state/signal';
import { fuse, save } from '../state/store';
import { monsterIcon } from './components';
import { MONSTER_RARITY_LABEL, RARITY_ASC, el } from './kit';
import { pct1, sheetShell } from './overlays';
import { playSfx } from './sfx';

/** 합성 사다리는 코어가 정본 (core/economy.ts) — UI는 재노출만 한다 (2026-08-25) */
export const FUSION_NEXT: Record<MonsterRarity, MonsterRarity | null> = RARITY_NEXT;
/** 합성 가능 등급 = 다음 등급이 있는 등급. 등급이 늘면 탭이 자동으로 따라온다 (순서는 RARITIES가 정본) */
export const FUSABLE_RARITIES: readonly MonsterRarity[] =
  RARITY_ASC.filter((rarity) => FUSION_NEXT[rarity] !== null);

const RITUAL_MS = 1500; // 의식 연출 길이 — 기대감 구간

type Phase = 'setup' | 'ritual' | 'result';
const fuseRarity = signal<MonsterRarity>('common');
const fuseRounds = signal(1);
const fusePhase = signal<Phase>('setup');
const fuseResults = signal<FusionResult[]>([]);
const fuseRevealed = signal<number[]>([]);
let ritualTimer: ReturnType<typeof setTimeout> | null = null;

/** 합성 시트를 초기 상태로 — 진입 버튼에서 호출 */
export function resetFusion(): void {
  if (ritualTimer) {
    clearTimeout(ritualTimer);
    ritualTimer = null;
  }
  fusePhase.set('setup');
  fuseRounds.set(1);
  fuseResults.set([]);
  fuseRevealed.set([]);
}

// ── 여분 계산·자동 재료 계획 ─────────────────────────────────────────────────

function spareMap(state: SaveState, rarity: MonsterRarity): Map<string, number> {
  const spares = new Map<string, number>();
  for (const owned of state.roster) {
    if (content.monsters.get(owned.monsterId)!.rarity !== rarity) continue;
    if (owned.count > 1) spares.set(owned.monsterId, owned.count - 1);
  }
  return spares;
}

const sumOf = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);

/** 회당 2장을 여분 최다 종부터 균등하게 뽑는 자동 계획 */
function planBatches(state: SaveState, rarity: MonsterRarity, rounds: number): FusionInput[] {
  const spares = spareMap(state, rarity);
  const take = (): string | null => {
    let best: string | null = null;
    let bestN = 0;
    for (const [monsterId, n] of spares) {
      if (n > bestN) {
        best = monsterId;
        bestN = n;
      }
    }
    if (!best) return null;
    spares.set(best, bestN - 1);
    return best;
  };
  const batches: FusionInput[] = [];
  for (let i = 0; i < rounds; i++) {
    const a = take();
    const b = take();
    if (!a || !b) break;
    batches.push({
      materials: a === b
        ? [{ monsterId: a, count: 2 }]
        : [{ monsterId: a, count: 1 }, { monsterId: b, count: 1 }],
    });
  }
  return batches;
}

// ── 연출 조각 ────────────────────────────────────────────────────────────────

/** 마법진 — 회전 링 2개 + 중앙 코어. fast=의식 중 (강회전 + 섬광). 유물 합성 시트와 공유 */
export function ritualCircle(nextRarity: MonsterRarity, core: HTMLElement, fast: boolean): HTMLElement {
  const glow = `var(--rar-${nextRarity})`;
  const ring1 = el('div.ritual-ring');
  ring1.style.borderColor = glow;
  const ring2 = el('div.ritual-ring.ritual-ring2');
  const orbit = el('div.ritual-orbit', {}, el('span.ritual-star', {}, '✦'), el('span.ritual-star.s2', {}, '✧'));
  const coreBox = el('div.ritual-core', {}, core);
  coreBox.style.boxShadow = `0 0 22px ${glow}55, 0 0 60px ${glow}22`;
  return el(`div.ritual${fast ? '.ritual-fast' : ''}`, {},
    ring1, ring2, orbit, coreBox,
    fast ? el('div.ritual-flash') : null,
  );
}

function startRitual(rarity: MonsterRarity, rounds: number): void {
  fusePhase.set('ritual');
  playSfx('enhance');
  ritualTimer = setTimeout(() => {
    ritualTimer = null;
    const plans = planBatches(save(), rarity, rounds);
    const results: FusionResult[] = [];
    batch(() => {
      for (const plan of plans) {
        const result = fuse(plan);
        if (!result) break;
        results.push(result);
      }
      fuseResults.set(results);
      fuseRevealed.set([]);
      fusePhase.set('result');
    });
    const successes = results.filter((r) => r.success).length;
    playSfx(successes > 0 ? 'confirm' : 'capture-miss');
  }, RITUAL_MS);
}

// ── 화면 ─────────────────────────────────────────────────────────────────────

export function fusionSheet(): HTMLElement {
  const state = save();
  const { fusion } = content.balance;
  const rarity = fuseRarity();
  const phase = fusePhase();
  const nextRarity = FUSION_NEXT[rarity]!;
  const chance = fusion.chance[rarity] ?? 0;

  if (phase === 'ritual') {
    return sheetShell('카드 합성',
      ritualCircle(nextRarity, el('span.ritual-q', {}, '?'), true),
      el('div.center.ritual-caption', {}, '✨ 카드가 빛에 휩싸입니다…'),
    );
  }

  if (phase === 'result') return resultView(rarity, nextRarity);

  // ── setup ──
  const spares = spareMap(state, rarity);
  const total = sumOf(spares);
  const maxRounds = Math.floor(total / fusion.materials);
  const rounds = Math.min(Math.max(1, fuseRounds()), Math.max(1, maxRounds));

  const spareByRarity = (r: MonsterRarity) => sumOf(spareMap(state, r));
  const tabs = FUSABLE_RARITIES.map((r) =>
    el(`button.chip${rarity === r ? '.active' : ''}`, {
      onclick: () => {
        fuseRarity.set(r);
        fuseRounds.set(1);
      },
    }, `${MONSTER_RARITY_LABEL[r]} ${spareByRarity(r)}`),
  );

  // 마법진 코어: 여분 상위 3종 아이콘 미리보기
  const topSpares = [...spares.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const preview = topSpares.length > 0
    ? el('div.ritual-preview', {}, ...topSpares.map(([monsterId]) => monsterIcon(monsterId)))
    : el('span.ritual-q', {}, '?');

  let resultPool = content.monsterList.filter(
    (m) => m.rarity === nextRarity && isRegionUnlocked(content, state, m.habitat),
  ).length;
  if (resultPool === 0) resultPool = content.monsterList.filter((m) => m.rarity === nextRarity).length;

  const setRounds = (n: number) => fuseRounds.set(Math.min(Math.max(1, n), Math.max(1, maxRounds)));

  return sheetShell('카드 합성',
    el('div.chips-wrap', {}, ...tabs),
    ritualCircle(nextRarity, preview, false),
    el('div.center.muted.small', {},
      total > 0
        ? `${MONSTER_RARITY_LABEL[rarity]} 여분 ${total}장 [최대 ${maxRounds}회 합성 가능]`
        : `${MONSTER_RARITY_LABEL[rarity]} 여분 카드가 없습니다 [중복 포획으로 모아보세요]`),

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
        el('span', {}, '소모 카드'),
        el('span.small', {}, maxRounds > 0 ? `여분 ${rounds * fusion.materials}장 (재료는 여분이 많은 종부터 자동 선택)` : '—'),
      ),
      el('div.list-row', {},
        el('span', {}, '성공 확률'),
        el('strong', {}, `회당 ${pct1(chance)}`),
      ),
      el('div.list-row', {},
        el('span', {}, '결과'),
        el('span.small.muted', {}, `성공 시 ${MONSTER_RARITY_LABEL[nextRarity]} ${resultPool}종 중 랜덤 · 실패 시 1장 반환`),
      ),
      el('button.btn.btn-primary.btn-big', {
        disabled: maxRounds < 1,
        onclick: () => startRitual(rarity, rounds),
      }, maxRounds < 1
        ? '여분 카드가 부족합니다'
        : `🧬 합성 시작 [${MONSTER_RARITY_LABEL[rarity]} → ${MONSTER_RARITY_LABEL[nextRarity]} ${rounds}회]`),
    ),
    el('div.center.muted.small', {}, '각 종의 마지막 1장은 재료로 쓰지 않습니다 (육성 보호)'),
  );
}

function resultView(rarity: MonsterRarity, nextRarity: MonsterRarity): HTMLElement {
  const results = fuseResults();
  const revealed = fuseRevealed();
  const successes = results.filter((r) => r.success).length;
  const fails = results.length - successes;
  const milestones = results.flatMap((r) => r.newMilestones);
  const unrevealed = results.filter((r, i) => r.success && !revealed.includes(i)).length;

  const reveal = (index: number) => {
    if (fuseRevealed().includes(index)) return;
    fuseRevealed.set([...fuseRevealed(), index]);
    const result = fuseResults()[index]!;
    playSfx(result.isNew ? 'capture-new' : 'treasure');
  };

  const cards = results.map((result, index) => {
    if (!result.success) {
      const returned = result.returnedMonsterId ? content.monsters.get(result.returnedMonsterId)?.name : null;
      return el('div.fuse-card.fuse-fail', {},
        el('div.fuse-fail-mark', {}, '💨'),
        el('div.fuse-card-name.muted', {}, '실패'),
        returned ? el('div.fuse-card-sub', {}, `${returned} 1장 반환`) : null,
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
    const def = content.monsters.get(result.resultMonsterId!)!;
    const card = el('div.fuse-card.fuse-open', {},
      monsterIcon(def.id),
      el('div.fuse-card-name', {}, def.name),
      el('div.fuse-card-sub', {},
        result.isNew
          ? el('span.fuse-new', {}, '✨ 도감 신규!')
          : el('span.muted', {}, '카드 +1'),
      ),
    );
    card.classList.add(`rar-${def.rarity}`); // 영웅·전설 공개 시 글로우·맥동 (styles.css)
    card.style.borderColor = `var(--rar-${def.rarity})`;
    return card;
  });

  return sheetShell('카드 합성',
    el('div.center.fusion-summary', {},
      el('div.fusion-summary-title', {}, `${MONSTER_RARITY_LABEL[rarity]} ${results.length}회 합성 완료`),
      el('div.small', {},
        el('span.jcapture', {}, `성공 ${successes}`),
        el('span.muted', {}, ' · '),
        el('span.jmiss', {}, `실패 ${fails}`),
      ),
    ),
    ...[...new Set(milestones)].map((id) => {
      const milestone = content.milestones.find((m) => m.id === id);
      return milestone ? el('div.center.small.jmilestone', {}, `🏅 마일스톤 달성: ${milestone.name}`) : null;
    }),
    el('div.fuse-grid', {}, ...cards),
    el('div.row-gap.fusion-actions', {},
      unrevealed > 0
        ? el('button.btn.btn-primary', {
            onclick: () => {
              const all = fuseResults().map((_, i) => i).filter((i) => fuseResults()[i]!.success);
              fuseRevealed.set(all);
              playSfx(fuseResults().some((r) => r.isNew) ? 'capture-new' : 'treasure');
            },
          }, `모두 공개 (${unrevealed})`)
        : null,
      el('button.btn.btn-ghost', {
        onclick: () => {
          fusePhase.set('setup');
          fuseResults.set([]);
          fuseRevealed.set([]);
          fuseRounds.set(1);
        },
      }, '다시 합성'),
    ),
  );
}

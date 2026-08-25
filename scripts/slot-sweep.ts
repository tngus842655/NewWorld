/**
 * 파티 슬롯 게이트 스윕 (2026-08-25)
 *
 *   npx tsx scripts/slot-sweep.ts [--days 21]
 *
 * balance.party.slotUnlocks 후보를 바꿔 끼우며 봇 3종을 돌리고, 슬롯 4·5칸이 며칠에 열리는지와
 * "무엇이 제동이었는지"(도감/골드)를 비교한다. 지역 해금 게이트를 정할 때와 같은 방식.
 *
 * 판정 기준 — 지역 해금(GDD §6)과 같은 원칙 "도감 = 제동, 재화 = 값" (§4.4-1):
 *   ① "보통" 유저가 목표 창 안에서 연다      — 슬롯은 성장 이정표여야 한다
 *   ② 세 전략 모두 제동이 "도감"이어야 한다  — 골드가 제동이면 값이 게이트를 대신한 것
 *   ③ 하드코어 ≒ 2~2.5배 속도 상한, 방치는 밀려도 수용 (GDD §9.1 지역 곡선과 같은 허용폭)
 *   ④ 방치의 첫 주 전멸률이 오르지 않아야 한다 (GDD §9.1) — 슬롯을 늦추면 파티가 약한 채로
 *      오래 굴러서 전멸이 늘어난다. 게이트를 조일 때 같이 봐야 하는 부작용.
 */
import { loadContent, type Content } from '../src/content';
import { simulate, STRATEGIES } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 21) || 21;

/** "보통" 기준 목표 창 — 4칸은 첫 벽(늪) 전에, 5칸은 최종 지역(화산) 진입 전후 */
const SLOT_GOAL: Record<number, [number, number]> = { 4: [3, 6], 5: [9, 14] };

const TOTAL_SPECIES = loadContent().monsterList.length;

interface Candidate {
  label: string;
  note: string;
  captured: [number, number]; // [4칸, 5칸]
  gold: [number, number];
}

function contentWith(candidate: Candidate): Content {
  const base = loadContent();
  return {
    ...base,
    balance: {
      ...base.balance,
      party: {
        ...base.balance.party,
        slotUnlocks: [
          { slots: 4, gold: candidate.gold[0], totalCaptured: candidate.captured[0] },
          { slots: 5, gold: candidate.gold[1], totalCaptured: candidate.captured[1] },
        ],
      },
    },
  };
}

function pct(n: number): string {
  return `${Math.round((n / TOTAL_SPECIES) * 1000) / 10}%`;
}

function run(candidate: Candidate): void {
  const content = contentWith(candidate);
  console.log(
    `\n▶ ${candidate.label} — 도감 ${candidate.captured[0]}(${pct(candidate.captured[0])}) / ${candidate.captured[1]}(${pct(candidate.captured[1])})종 · 골드 ${candidate.gold[0].toLocaleString()} / ${candidate.gold[1].toLocaleString()}`,
  );
  console.log(`  ${candidate.note}`);
  for (const strategy of STRATEGIES) {
    const result = simulate(content, strategy, { days: DAYS });
    const cells = [4, 5].map((slots) => {
      const obs = result.slotGate[slots];
      if (!obs?.buyDay) {
        const reached = result.days[result.days.length - 1]?.captured ?? 0;
        return `${slots}칸 미달(D${DAYS}까지 도감 ${reached}종)`;
      }
      const [lo, hi] = SLOT_GOAL[slots]!;
      const mark = obs.buyDay >= lo && obs.buyDay <= hi ? '✅' : obs.buyDay < lo ? '⚡' : '🐌';
      // 마지막으로 충족된 조건이 제동이다 (같은 날이면 동시)
      const codex = obs.codexDay ?? Infinity;
      const gold = obs.goldDay ?? Infinity;
      const brake = codex > gold ? '도감' : gold > codex ? '골드' : '동시';
      return `${slots}칸 D${obs.buyDay}${mark} 제동=${brake}`;
    });
    // 부작용 계측: 슬롯을 늦추면 약한 파티로 오래 굴러 전멸이 는다 — 첫 주 기준으로 본다
    const week = result.days.find((d) => d.day === 7);
    const wipeRate = week && week.runs > 0 ? `${Math.round((week.wipes / week.runs) * 100)}%` : '—';
    console.log(`   ${strategy.label.padEnd(20)} ${cells.join(' · ')} | D7 전멸 ${week?.wipes ?? 0}/${week?.runs ?? 0}런(${wipeRate})`);
  }
}

// ── 1단계: 도감 축 — 골드는 제동이 되지 않도록 낮게 고정하고 totalCaptured만 비교 ─────────
const LOW_GOLD: [number, number] = [3000, 12000];

const CODEX_CANDIDATES: Candidate[] = [
  { label: 'A 현행', note: '52종 시절 값 그대로 — 219종에서는 도감 19%→4.6%, 48%→11.4%로 희석됐다', captured: [10, 25], gold: LOW_GOLD },
  { label: 'B 완화', note: '업적 총도감 사다리에서 한 계단씩 아래 (30 / 70)', captured: [30, 70], gold: LOW_GOLD },
  { label: 'C 비율보존', note: '52종 시절 비율(19% / 48%)을 219종에 그대로 — 사다리 계단 40·104와 일치', captured: [40, 104], gold: LOW_GOLD },
  { label: 'D 강화', note: '사다리에서 한 계단씩 위 (52 / 130)', captured: [52, 130], gold: LOW_GOLD },
  // 4칸만 낮춘 절충안 — 5칸(이중 시너지)은 비율보존을 지키되, 방치가 3칸으로 오래 구르는 부작용을 줄인다
  { label: 'E 절충', note: '4칸만 사다리 한 계단 아래(25종)로 낮추고 5칸은 비율보존 유지', captured: [25, 104], gold: LOW_GOLD },
];

console.log(`\n=== 파티 슬롯 게이트 스윕 · ${DAYS}일 · 총 ${TOTAL_SPECIES}종 ===`);
console.log(`목표 창("보통" 기준): 4칸 D${SLOT_GOAL[4]![0]}~${SLOT_GOAL[4]![1]} · 5칸 D${SLOT_GOAL[5]![0]}~${SLOT_GOAL[5]![1]}`);
console.log('\n── 1단계: 도감 축 (골드 고정 3,000 / 12,000) ──────────────────────────────');
for (const candidate of CODEX_CANDIDATES) run(candidate);

// ── 2단계: 골드 축 — 도감을 1단계 승자로 고정하고, 값이 제동으로 바뀌는 지점을 찾는다 ─────
const WINNER_CAPTURED: [number, number] = [40, 104];

const GOLD_CANDIDATES: Candidate[] = [
  { label: 'C-1 현행가', note: '골드 3,000 / 12,000 — 시뮬 보통 D10 누적 30만 대비 사실상 무료', captured: WINNER_CAPTURED, gold: LOW_GOLD },
  { label: 'C-2 반일치', note: '해금 시점 반나절 수입 규모', captured: WINNER_CAPTURED, gold: [6000, 40000] },
  { label: 'C-3 1일치', note: '해금 시점 하루 수입 규모 — 체감되는 값이되 제동은 아니어야 한다', captured: WINNER_CAPTURED, gold: [8000, 60000] },
  { label: 'C-4 1.5일치', note: '여유 폭 탐색 — 아직 도감이 제동인가', captured: WINNER_CAPTURED, gold: [10000, 90000] },
  { label: 'C-5 2일치', note: '더 무거운 값 — 도감보다 골드가 먼저 걸리는지 확인', captured: WINNER_CAPTURED, gold: [15000, 120000] },
  { label: 'C-6 과중', note: '골드가 제동으로 뒤집히는 상한 탐색', captured: WINNER_CAPTURED, gold: [30000, 250000] },
];

console.log('\n── 2단계: 골드 축 (도감 고정 40 / 104종) ──────────────────────────────────');
for (const candidate of GOLD_CANDIDATES) run(candidate);

console.log(`
── 채택 (2026-08-25) ─────────────────────────────────────────────────────
  4칸: 도감 40종(18.3%) + 골드 6,000   ·  5칸: 도감 104종(47.5%) + 골드 40,000

  도감: C(비율보존). 52종 시절 값 10/25는 219종에서 4.6%/11.4%로 희석돼 "보통"이 D1·D3에
        지나쳤다. 원래 비율 19%/48%를 되살리면 40/104 — 총도감 업적 사다리 계단과도 일치해
        슬롯 확장과 업적이 같은 날 온다. "보통" 4칸 D4 · 5칸 D9로 두 목표 창 모두 안착.
  골드: C-2가 도감을 제동으로 유지하는 마지막 값. 60,000부터 5칸이 "동시", 90,000부터 "골드"로
        뒤집힌다. 40,000은 뒤집힘 지점의 약 1/2로 여유를 두면서도 현행가의 3.3배 — 값은 되지만
        제동은 아니다("도감 = 제동, 재화 = 값").

  ⚠ 부작용: 방치의 첫 주 전멸률이 35% → 48%로 오른다. 슬롯을 늦추면 3칸 파티로 오래 구르기
     때문인데, B·D·E 어느 후보에서도 48%로 같다 — 게이트를 걸면 따라오는 비용이지 이 값의 문제가
     아니다(방치가 25종에 닿는 것부터가 D7). 되돌리려면 게이트가 아니라 3칸 파티 기준
     recommendedCp 재검토가 맞다.
`);

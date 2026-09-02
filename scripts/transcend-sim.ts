/**
 * 초월 도달 추정 (2026-09-02) — 초월 관문 개편(재료 완화 + 분화구 심장부 해금 관문)의 폭을 잰다.
 *
 *   npx tsx scripts/transcend-sim.ts [--days 120] [--seeds 5] [--style normal|hardcore|idle|all] [--tiers f2p,mid,high]
 *
 * 완성 지향 유저 모델(codex-sim의 COMPLETIONIST + 다이아는 고급 뽑기에)에 전설→초월 합성을 켠다.
 * 두 규칙을 나란히 돌려 before/after를 같은 시드로 비교한다:
 *   현행   — 전 지역 전설 여분이 재료 (fuseTranscend: 'all', 2026-08-31 완화)
 *   구 규칙 — 최종 티어 서식 전설 여분만 재료 (fuseTranscend: 'final-tier', 2026-08-25~09-01 규칙 에뮬레이션)
 * 관문(분화구 해금)은 둘 다 같다 — 코어가 관문 전 시도를 거절한다.
 *
 * ⚠️ D150은 2분 타임아웃을 넘긴다 — D120 이하로. 시드 5개 × 구간 3 × 규칙 2 = 30회 시뮬.
 * 전설의 주 획득 경로는 과금이 아니라 영웅→전설 여분 합성 사다리다 — 과금 구간 차이가 작게 나오는 게 정상.
 */
import { content } from '../src/content';
import { finalTierEntry, transcendGateRegion } from '../src/core/economy';
import { simulate, STRATEGIES, type SimResult, type Strategy } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 120) || 120;
const SEEDS = Number(args[args.indexOf('--seeds') + 1] || 5) || 5;
const styleArg = args.indexOf('--style') >= 0 ? args[args.indexOf('--style') + 1]! : 'normal';
const tiersArg = args.indexOf('--tiers') >= 0 ? args[args.indexOf('--tiers') + 1]!.split(',') : ['f2p', 'mid', 'high'];

/** 과금 구간 — spend-sim.ts와 같은 사다리 (유료 다이아/월, 출석분은 checkInDaily가 따로 준다) */
const TIERS = [
  { key: 'f2p', label: '무과금', paidDiamonds: 0 },
  { key: 'low', label: '월 1만원', paidDiamonds: 190 },
  { key: 'mid', label: '월 5만원', paidDiamonds: 1_040 },
  { key: 'high', label: '월 20만원', paidDiamonds: 4_300 },
].filter((t) => tiersArg.includes(t.key));

/** 완성을 노리는 유저 — 상점·출석·모래시계 + 합성·지역 순회·항상 심층, 다이아는 도감(고급 뽑기) */
const COMPLETIONIST = {
  useGoldShop: true,
  lurePerTeam: true,
  useHourglasses: true,
  checkInDaily: true,
  craftHourglasses: true,
  fuseSpares: true,
  codexRotate: true,
  alwaysDeep: true,
  spendPolicy: 'codex' as const,
};

/** 관문·최종 티어 진입 지역은 코어와 같은 유도 — 지역·서식지가 바뀌어도 표의 열이 따라온다 */
const GATE = transcendGateRegion(content).id;
const VOLCANO = finalTierEntry(content).id;

/** 표시 폭 — 한글·CJK는 2칸. padStart는 코드 유닛 기준이라 한글 헤더가 데이터 열과 어긋난다 */
const width = (s: string) => [...s].reduce((sum, c) => sum + (c.charCodeAt(0) >= 0x2e80 ? 2 : 1), 0);
const padE = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));
const padS = (s: string | number, n: number) => {
  const str = String(s);
  return ' '.repeat(Math.max(0, n - width(str))) + str;
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[Math.floor(s.length / 2)]!;
};
const avg = (xs: number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const dayCell = (d: number | undefined) => (d === undefined ? `${DAYS}+` : `D${d}`);

function run(strategy: Strategy, paidDiamonds: number, rule: 'all' | 'final-tier', seedSalt: string): SimResult {
  return simulate(content, strategy, {
    days: DAYS,
    ...COMPLETIONIST,
    fuseTranscend: rule,
    diamonds: { initial: 0, perDay: paidDiamonds / 30 },
    seedSalt,
  });
}

interface Row {
  rule: string;
  volcanoD: number;
  craterD: number;
  legendSpares: number;
  finalTierSpares: number;
  attempts: number;
  successes: number;
  reached: number; // 시드 중 초월 ≥1종 도달 수
  firstDays: number[];
  transcendent: number;
}

function summarize(rule: 'all' | 'final-tier', results: SimResult[]): Row {
  const last = (r: SimResult) => r.days[r.days.length - 1]!;
  return {
    rule,
    volcanoD: median(results.map((r) => r.unlockDay[VOLCANO] ?? DAYS + 1)),
    craterD: median(results.map((r) => r.unlockDay[GATE] ?? DAYS + 1)),
    legendSpares: median(results.map((r) => last(r).legendarySpares)),
    finalTierSpares: median(results.map((r) => last(r).finalTierLegendarySpares)),
    attempts: avg(results.map((r) => r.transcend.attempts)),
    successes: avg(results.map((r) => r.transcend.successes)),
    reached: results.filter((r) => r.transcend.firstDay !== undefined).length,
    firstDays: results.map((r) => r.transcend.firstDay).filter((d): d is number => d !== undefined),
    transcendent: median(results.map((r) => last(r).transcendent)),
  };
}

const styles = styleArg === 'all' ? STRATEGIES : STRATEGIES.filter((s) => s.name === styleArg);

console.log(`\n=== 초월 도달 추정 (${DAYS}일 · 시드 ${SEEDS}개 · 완성 지향 유저, 다이아는 고급 뽑기) ===`);
console.log(`관문: ${content.regions.get(GATE)!.name} 해금 (몬스터 초월) · 재료 규칙 두 벌을 같은 시드로 비교`);
console.log(`  현행 = 전 지역 전설 여분 · 구 규칙 = 최종 티어(${content.regions.get(VOLCANO)!.name} 권역) 서식 전설 여분만 (재료 규칙만 에뮬레이션 — 관문은 현행 기준)`);
console.log(`초월 성공률 ${(content.balance.fusion.chance.legendary! * 100).toFixed(0)}% · 재료 ${content.balance.fusion.materials}장 · 실패 시 1장 반환\n`);

for (const strategy of styles) {
  console.log(`▶ ${strategy.label}`);
  // 가변 길이 열(첫 초월 일차)은 맨 뒤에 — 시드 수에 따라 폭이 달라져도 앞 열이 밀리지 않는다
  console.log(
    `  ${padE('구간', 10)} ${padE('규칙', 8)} ${padS('화산D', 6)} ${padS('분화구D', 8)} ${padS('전설여분', 8)} ${padS('최종티어분', 10)} ${padS('시도', 6)} ${padS('성공', 6)} ${padS('도달', 6)} ${padS('초월종', 6)}  첫 초월 일차`,
  );
  for (const tier of TIERS) {
    for (const rule of ['final-tier', 'all'] as const) {
      const results = Array.from({ length: SEEDS }, (_, i) => run(strategy, tier.paidDiamonds, rule, `-t${i}`));
      const row = summarize(rule, results);
      console.log(
        `  ${padE(tier.label, 10)} ${padE(rule === 'all' ? '현행' : '구 규칙', 8)} ` +
          `${padS(dayCell(row.volcanoD > DAYS ? undefined : row.volcanoD), 6)} ${padS(dayCell(row.craterD > DAYS ? undefined : row.craterD), 8)} ` +
          `${padS(row.legendSpares, 8)} ${padS(row.finalTierSpares, 10)} ${padS(row.attempts.toFixed(1), 6)} ${padS(row.successes.toFixed(2), 6)} ` +
          `${padS(`${row.reached}/${SEEDS}`, 6)} ${padS(row.transcendent, 6)}  ${row.firstDays.length ? row.firstDays.map((d) => `D${d}`).join(' ') : '-'}`,
      );
    }
  }
  console.log('');
}
console.log('  ※ 전설여분·최종티어분 = 마지막 날 여분(count−1) 합계의 중앙값 · 시도·성공 = 시드 평균 · 도달 = 초월 ≥1종인 시드 수');
console.log('  ※ 구 규칙 행은 재료 규칙만 에뮬레이션(봇이 최종 티어 서식 여분만 재료로 고른다) — 코어는 현행 규칙 하나뿐이라 관문(분화구 해금)은');
console.log('     현행 그대로 적용된다. 구 규칙에는 지역 관문이 없었으므로 화산~분화구 해금 사이의 시도분은 여기 빠져 있다 (근사, 구 규칙보다 엄격)\n');

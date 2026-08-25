/**
 * 도감 완성 소요일 추정 (2026-08-25)
 *
 *   npx tsx scripts/codex-sim.ts [--days 365] [--seeds 3] [--style normal|all]
 *
 * 목표는 **216종**(초월 3종 제외 — 초월은 합성 전용에 전설→초월 3%라 성격이 다르다).
 * 216 = 지역 4 × (일반16 + 고급12 + 희귀12 + 영웅8 + 전설6).
 *
 * 기존 봇으로는 못 잰다. 두 가지가 빠져 있었다:
 *   1. **합성** — 전설의 실제 주 경로다. 조우는 심층 5% × 포획 1.5%뿐이고,
 *      영웅 여분 2장 → 전설 6.25%가 훨씬 굵다
 *   2. **지역 순회** — 봇은 늘 가장 깊은 지역만 돌아 앞 지역 도감이 영영 안 찬다
 *
 * 여기서는 셋 다 켠다(fuseSpares · codexRotate · alwaysDeep) — "완성을 노리는 유저"의 행동이다.
 */
import { content } from '../src/content';
import { simulate, STRATEGIES, type SimResult, type Strategy } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 365) || 365;
const SEEDS = Number(args[args.indexOf('--seeds') + 1] || 3) || 3;
const styleArg = args.indexOf('--style') >= 0 ? args[args.indexOf('--style') + 1]! : 'normal';

const TARGET = content.monsterList.filter((m) => m.rarity !== 'transcendent').length;
const LEGENDARY_TOTAL = content.monsterList.filter((m) => m.rarity === 'legendary').length;

const pad = (s: string | number, n: number) => String(s).padStart(n);
const padE = (s: string, n: number) => {
  const w = [...s].reduce((sum, c) => sum + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

/** 완성을 노리는 유저 — 상점·출석·모래시계에 더해 합성·지역 순회·항상 심층 */
const COMPLETIONIST = {
  useGoldShop: true,
  lurePerTeam: true,
  useHourglasses: true,
  checkInDaily: true,
  craftHourglasses: true,
  fuseSpares: true,
  codexRotate: true,
  alwaysDeep: true,
} as const;

function run(strategy: Strategy, seedSalt: string): SimResult {
  return simulate(content, strategy, { days: DAYS, ...COMPLETIONIST, seedSalt });
}

/** 도감이 N종에 처음 닿은 일차 (초월 제외 집계는 SimResult에 없으므로 총합으로 근사하되 상한을 216으로 본다) */
function dayReaching(result: SimResult, n: number): number | null {
  const hit = result.days.find((d) => d.captured >= n);
  return hit ? hit.day : null;
}

const styles = styleArg === 'all' ? STRATEGIES : STRATEGIES.filter((s) => s.name === styleArg);

console.log(`\n=== 도감 완성 추정 (${DAYS}일 · 시드 ${SEEDS}개) ===`);
console.log(`목표 ${TARGET}종 (초월 3종 제외) · 그중 전설 ${LEGENDARY_TOTAL}종이 꼬리`);
console.log(`완성 행동: 합성(등급 사다리) · 도감 덜 찬 지역 순회 · 항상 심층 · 골드 상점 · 출석 · 모래시계\n`);

const MARKS = [100, 150, 180, 192, 200, 210, TARGET];

for (const strategy of styles) {
  const results = Array.from({ length: SEEDS }, (_, i) => run(strategy, `-c${i}`));
  console.log(`▶ ${strategy.label}`);
  console.log(`  ${padE('도감', 8)} ${MARKS.map((m) => pad(`${m}종`, 8)).join('')}`);
  const cells = MARKS.map((m) => {
    const days = results.map((r) => dayReaching(r, m)).filter((d): d is number => d !== null).sort((a, b) => a - b);
    if (days.length === 0) return pad('미달', 8);
    const median = days[Math.floor(days.length / 2)]!;
    return pad(days.length < results.length ? `~D${median}?` : `D${median}`, 8);
  });
  console.log(`  ${padE('도달일', 8)} ${cells.join('')}`);

  /**
   * 완성 일차는 **시드 분산이 크다** — 마지막 전설 몇 종이 순전히 운이라
   * 중앙값 하나로 말하면 과대 확신이 된다. 전 시드 값을 그대로 보여준다.
   */
  const finals = results
    .map((r) => dayReaching(r, TARGET))
    .map((d) => (d === null ? `미완(${DAYS}일)` : `D${d}`));
  console.log(`  ${padE('완성 분포', 10)} ${finals.join(' · ')}`);

  const last = results.map((r) => r.days[r.days.length - 1]?.captured ?? 0);
  const runs = results.map((r) => r.totals.runs);
  console.log(
    `  ${DAYS}일차 도감 ${Math.min(...last)}~${Math.max(...last)}종 · 런 ${Math.round(runs.reduce((a, b) => a + b, 0) / runs.length)}회` +
      ` · 전멸 ${Math.round(results.reduce((s, r) => s + r.totals.wipes, 0) / results.length)}회\n`,
  );
}
console.log(`  ※ "미달"은 ${DAYS}일 안에 못 닿았다는 뜻. "~Dn?"은 일부 시드만 닿은 값(중앙값)이라 낙관적이다.`);
console.log('');

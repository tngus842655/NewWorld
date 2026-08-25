/**
 * 도감 완성 — 어떤 행동이 얼마나 기여하는가 (2026-08-25)
 *
 *   npx tsx scripts/codex-ablation.ts [--days 400] [--style normal] [--seeds 3]
 *
 * codex-sim.ts가 "얼마나 걸리나"를 재고, 여기서는 "**왜** 그만큼 걸리나"를 하나씩 꺼보며 잰다.
 *
 * ⚠️ 완성 일차는 **시드 분산이 매우 크다** — 마지막 전설 몇 종이 순전히 운이라
 * 같은 설정에서도 D160과 미완이 함께 나온다. 그래서 중앙값 하나가 아니라 **전 시드 값**을 찍는다.
 * 항목 간 차이를 읽을 때는 분포가 겹치는지부터 볼 것.
 */
import { content } from '../src/content';
import { simulate, STRATEGIES, type SimOptions } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 400) || 400;
const SEEDS = Number(args[args.indexOf('--seeds') + 1] || 3) || 3;
const NAME = args.indexOf('--style') >= 0 ? args[args.indexOf('--style') + 1]! : 'normal';
const strategy = STRATEGIES.find((s) => s.name === NAME) ?? STRATEGIES[1]!;

const TARGET = content.monsterList.filter((m) => m.rarity !== 'transcendent').length;

/** 완성을 노리는 유저의 전부 켠 상태 */
const ALL_ON: SimOptions = {
  days: DAYS,
  useGoldShop: true,
  lurePerTeam: true,
  useHourglasses: true,
  checkInDaily: true,
  craftHourglasses: true,
  fuseSpares: true,
  codexRotate: true,
  alwaysDeep: true,
};

const CASES: { label: string; over: Partial<SimOptions> }[] = [
  { label: '전부 ON (기준)', over: {} },
  { label: '합성 OFF', over: { fuseSpares: false } },
  { label: '지역 순회 OFF', over: { codexRotate: false } },
  { label: '항상 심층 OFF (밤에만 심층)', over: { alwaysDeep: false } },
  { label: '미끼 3개 고정 (팀별 확보 OFF)', over: { lurePerTeam: false } },
  { label: '골드 상점 OFF', over: { useGoldShop: false } },
];

const padE = (s: string, n: number) => {
  const w = [...s].reduce((sum, c) => sum + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

console.log(`\n=== 도감 ${TARGET}종 완성 — 행동별 기여 (${strategy.label} · ${DAYS}일 · 시드 ${SEEDS}개) ===`);
console.log(`   각 칸은 시드별 완성 일차. 분포가 겹치면 "차이 없음"으로 읽어야 한다\n`);

for (const c of CASES) {
  const out: string[] = [];
  let sumCaptured = 0;
  for (let i = 0; i < SEEDS; i++) {
    const r = simulate(content, strategy, { ...ALL_ON, ...c.over, seedSalt: `abl${i}` });
    const done = r.days.find((d) => d.captured >= TARGET);
    const last = r.days[r.days.length - 1]!;
    sumCaptured += last.captured;
    out.push(done ? `D${done.day}` : `미완(${last.captured}종)`);
  }
  console.log(`  ${padE(c.label, 28)} ${out.join(' · ')}   [${DAYS}일차 평균 ${Math.round(sumCaptured / SEEDS)}종]`);
}
console.log('');

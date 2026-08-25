/**
 * 과금 구간별 지역 해금 소요일 추정 (2026-08-25)
 *
 *   npx tsx scripts/spend-sim.ts [--days 30] [--style normal|hardcore|idle|all]
 *
 * ⚠️ 전제: **IAP는 아직 없다** (docs/GDD.md:451·503 — 충전은 M6 Google Play Billing 예정).
 * 현재 다이아의 유일 획득처는 월간 출석 달력 = 월 160개. 따라서 "과금 구간"은
 * IAP가 붙었을 때를 가정한 추정이며, 다이아 단가는 아래 WON_PER_DIAMOND 가정에 달려 있다.
 *
 * 모든 구간이 공통으로 하는 것 (무과금을 과소평가하지 않기 위해):
 *   - 골드 상점 일일 한도까지 구매 (미끼·재료 꾸러미·모래시계 5종)
 *   - 미끼를 팀 수 × 3개 확보 (파견당 적재 상한이 3이라 4군이면 12개가 필요하다)
 *   - 보유 모래시계는 전부 진행 중 원정에 사용
 */
import { content } from '../src/content';
import { simulate, STRATEGIES, type SimResult, type Strategy } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 30) || 30;
const styleArg = args.indexOf('--style') >= 0 ? args[args.indexOf('--style') + 1]! : 'all';

// ── 가정 ─────────────────────────────────────────────────────────────────────
/**
 * 다이아 단가는 **가챠 1회당 원화**로 역산했다. 재화 1개당 단가는 게임마다 8배씩 흩어져
 * (명일방주 합성옥 2.5원 · 블루아카이브 청휘석 15원 · 원신 결정 20원) 직접 비교가 무의미하지만,
 * 뽑기 1회 비용으로 환산하면 1,500~2,400원 대역에 수렴한다.
 * NewWorld의 몬스터 뽑기가 30💎이므로 **1💎 = 50원**이면 1,500원 — 시장 대역 하단.
 * 방치형은 수집형보다 뽑기 가치가 낮으니 하단이 맞다. 패키지 사다리는 60원(소액)~46원(대형).
 */
const WON_PER_DIAMOND = 50;
/** 무과금이 출석으로 받는 월 다이아 (balance.json attendance: D3 10 · D7 20 · D14 30 · D21 40 · D28 60) */
const ATTENDANCE_PER_MONTH = content.balance.attendance.rewards.reduce((sum, r) => sum + (r.diamonds ?? 0), 0);

interface Tier {
  key: string;
  label: string;
  /** 월 결제액(원). 0 = 무과금 */
  wonPerMonth: number;
  /** 그 금액으로 실제 받는 유료 다이아 (패키지 보너스 반영) */
  paidDiamonds: number;
}
/**
 * 패키지 사다리 (한국 구글플레이 가격 격자 + 대형 패키지 보너스):
 *   1,200원 20💎(60원) · 9,900원 190💎(52.1원) · 49,000원 1,020💎(48.0원) · 99,000원 2,150💎(46.0원)
 */
const TIERS: Tier[] = [
  { key: 'f2p', label: '무과금', wonPerMonth: 0, paidDiamonds: 0 },
  { key: 'low', label: '과금 하', wonPerMonth: 10_000, paidDiamonds: 190 },
  { key: 'mid', label: '과금 중', wonPerMonth: 50_000, paidDiamonds: 1_040 },
  { key: 'high', label: '과금 상', wonPerMonth: 200_000, paidDiamonds: 4_300 },
];

const diamondsPerDay = (tier: Tier): number => (tier.paidDiamonds + ATTENDANCE_PER_MONTH) / 30;

const ORDER = ['whispering-woods', 'sunken-marsh', 'ashen-volcano'] as const;
const SHORT: Record<string, string> = { 'whispering-woods': '숲', 'sunken-marsh': '늪', 'ashen-volcano': '화산' };
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padE = (s: string, n: number) => {
  const w = [...s].reduce((sum, c) => sum + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

/** 시드 하나만 보면 ±1~2일이 그냥 운이라 여러 번 돌려 중앙값을 쓴다 */
const SEEDS = Number(args[args.indexOf('--seeds') + 1] || 7) || 7;

/** 다이아 사용처 — 시간(모래시계) vs 도감(고급 뽑기). 어느 쪽이 빠른지는 실측으로 고른다 */
const POLICY = (args.indexOf('--policy') >= 0 ? args[args.indexOf('--policy') + 1]! : 'time') as 'time' | 'codex';

/** 제대로 노는 유저의 기본 행동 — 무과금도 전부 한다 */
const ACTIVE = {
  useGoldShop: true,
  lurePerTeam: true,
  useHourglasses: true,
  checkInDaily: true,
  craftHourglasses: true,
} as const;

function run(strategy: Strategy, tier: Tier, seedSalt: string, policy = POLICY): SimResult {
  return simulate(content, strategy, {
    days: DAYS,
    ...ACTIVE,
    spendPolicy: policy,
    // 출석 다이아는 checkInDaily가 계단으로 준다. 여기 perDay는 **유료 충전분**만
    diamonds: { initial: 0, perDay: tier.paidDiamonds / 30 },
    seedSalt,
  });
}

interface Agg {
  /** 지역별 해금 일차 — 미달은 DAYS+1로 센다 */
  unlock: Record<string, { median: number; min: number; max: number; missed: number }>;
  runs: number;
  captured: number;
  diamondsSpent: number;
  hourglassHours: number;
  gachaNew: number;
  purchases: Record<string, number>;
}

function aggregate(strategy: Strategy, tier: Tier): Agg {
  const results = Array.from({ length: SEEDS }, (_, i) => run(strategy, tier, `-s${i}`));
  const unlock: Agg['unlock'] = {};
  for (const id of ORDER) {
    const days = results.map((r) => r.unlockDay[id] ?? DAYS + 1).sort((a, b) => a - b);
    unlock[id] = {
      median: days[Math.floor(days.length / 2)]!,
      min: days[0]!,
      max: days[days.length - 1]!,
      missed: days.filter((d) => d > DAYS).length,
    };
  }
  const avg = (pick: (r: SimResult) => number) => results.reduce((s, r) => s + pick(r), 0) / results.length;
  const purchases: Record<string, number> = {};
  for (const r of results) for (const [id, n] of Object.entries(r.spend.purchases)) purchases[id] = (purchases[id] ?? 0) + n / results.length;
  return {
    unlock,
    runs: Math.round(avg((r) => r.totals.runs)),
    captured: Math.round(avg((r) => r.days[r.days.length - 1]?.captured ?? 0)),
    diamondsSpent: Math.round(avg((r) => r.spend.diamondsSpent)),
    hourglassHours: Math.round(avg((r) => r.spend.hourglassMinutes) / 60),
    gachaNew: Math.round(avg((r) => r.spend.gachaNewSpecies)),
    purchases,
  };
}

/** 해금 일차 → "며칠째" 표기. D1 = 시작 당일 */
const dayLabel = (d: number | undefined) => (d === undefined ? `${DAYS}일+` : `D${d}`);
/** D1을 0일 경과로 보고 실시간 환산 */
const elapsed = (d: number | undefined) => (d === undefined ? `${DAYS}일 이상` : d <= 1 ? '당일' : `${d - 1}일`);

const styles = styleArg === 'all' ? STRATEGIES : STRATEGIES.filter((s) => s.name === styleArg);

// ── 분해: 무과금 유저의 행동이 해금을 얼마나 당기는가 ────────────────────────
// GDD §9.1의 목표 곡선은 "상점을 전혀 안 쓰고 미끼 3개만 든" 봇으로 잡혔다.
// 실제 유저가 골드 상점 일일 한도만 챙겨도 곡선이 크게 앞당겨진다 — 그 폭을 여기서 잰다.
if (args.includes('--ablation')) {
  const strategy = STRATEGIES.find((s) => s.name === 'normal')!;
  const steps: { label: string; opts: Parameters<typeof simulate>[2] }[] = [
    { label: '① 기본 봇 (simulate.ts와 동일)', opts: { days: DAYS } },
    { label: '② + 미끼를 팀 수만큼 확보', opts: { days: DAYS, lurePerTeam: true } },
    { label: '③ + 골드 상점 일일 한도까지', opts: { days: DAYS, lurePerTeam: true, useGoldShop: true } },
    { label: '④ + 보유 모래시계 사용', opts: { days: DAYS, lurePerTeam: true, useGoldShop: true, useHourglasses: true } },
    { label: '⑤ + 재료를 모래시계로 세공', opts: { days: DAYS, lurePerTeam: true, useGoldShop: true, useHourglasses: true, craftHourglasses: true } },
    { label: '⑥ + 월간 출석 (= 무과금 최선)', opts: { days: DAYS, lurePerTeam: true, useGoldShop: true, useHourglasses: true, craftHourglasses: true, checkInDaily: true } },
  ];
  console.log(`\n=== 무과금 분해 — "보통"(하루 4회) 기준, 무엇이 곡선을 당기는가 ===`);
  console.log(`  ${padE('행동', 34)} ${pad('숲', 5)} ${pad('늪', 5)} ${pad('화산', 6)}   ${pad('런', 5)} ${pad('도감', 5)}`);
  for (const step of steps) {
    const r = simulate(content, strategy, step.opts);
    const last = r.days[r.days.length - 1];
    console.log(
      `  ${padE(step.label, 34)} ${ORDER.map((id) => pad(dayLabel(r.unlockDay[id]), 5)).join(' ')}   ${pad(r.totals.runs, 5)} ${pad(last?.captured ?? 0, 5)}`,
    );
  }
  console.log(`  ※ ①이 GDD §9.1 목표 곡선을 잡은 기준이다. 실유저는 최소 ③~⑤ 수준으로 논다.`);
  console.log('');
}

console.log(`\n=== 과금 구간별 지역 해금 소요 (${DAYS}일 시뮬) ===`);
console.log(`가정: 다이아 1개 = ${WON_PER_DIAMOND}원 · 출석 다이아 월 ${ATTENDANCE_PER_MONTH}개 (무과금 유일 획득처)`);
console.log(`구간별 월 다이아(유료+출석): ${TIERS.map((t) => `${t.label} ${t.paidDiamonds + ATTENDANCE_PER_MONTH}`).join(' · ')} → 하루 ${TIERS.map((t) => diamondsPerDay(t).toFixed(0)).join('/')}`);
console.log(`⚠️ IAP 미구현 — 과금 구간은 충전이 붙었을 때의 추정치`);

const cell = (u: Agg['unlock'][string]) => {
  const mid = u.median > DAYS ? `${DAYS}일+` : `D${u.median}`;
  const spread = u.min === u.max ? '' : `(${u.min}~${u.max > DAYS ? `${DAYS}+` : u.max})`;
  return `${mid}${spread}`;
};

const table: { style: string; tier: string; agg: Agg }[] = [];
for (const strategy of styles) {
  console.log(`\n▶ ${strategy.label} — 시드 ${SEEDS}개 중앙값(최소~최대)`);
  console.log(`  ${padE('구간', 10)} ${pad('월 결제', 8)} ${pad('숲', 11)} ${pad('늪', 11)} ${pad('화산', 11)}  ${pad('런', 5)} ${pad('도감', 5)} ${pad('💎', 6)} 모래시계`);
  for (const tier of TIERS) {
    const agg = aggregate(strategy, tier);
    table.push({ style: strategy.name, tier: tier.key, agg });
    console.log(
      `  ${padE(tier.label, 10)} ${pad(tier.wonPerMonth === 0 ? '-' : `${(tier.wonPerMonth / 10_000).toFixed(0)}만원`, 8)} ` +
        `${ORDER.map((id) => pad(cell(agg.unlock[id]!), 11)).join(' ')}  ` +
        `${pad(agg.runs, 5)} ${pad(agg.captured, 5)} ${pad(agg.diamondsSpent, 6)} ${agg.hourglassHours}시간`,
    );
  }
}

// ── 요약: "보통" 유저 기준 실시간 환산 ───────────────────────────────────────
const normalRows = table.filter((r) => r.style === 'normal');
if (normalRows.length > 0) {
  console.log(`\n=== 요약 — "보통"(하루 4회 접속) 기준 체감 소요 (중앙값) ===`);
  console.log(`  ${padE('구간', 10)} ${ORDER.map((id) => pad(SHORT[id]!, 10)).join(' ')}`);
  for (const row of normalRows) {
    const tier = TIERS.find((t) => t.key === row.tier)!;
    console.log(`  ${padE(tier.label, 10)} ${ORDER.map((id) => pad(elapsed(row.agg.unlock[id]!.median), 10)).join(' ')}`);
  }
  const f2p = normalRows.find((r) => r.tier === 'f2p')!.agg;
  console.log(`\n  무과금 대비 단축일 (중앙값 차):`);
  for (const row of normalRows.filter((r) => r.tier !== 'f2p')) {
    const tier = TIERS.find((t) => t.key === row.tier)!;
    const diffs = ORDER.map((id) => {
      const d = f2p.unlock[id]!.median - row.agg.unlock[id]!.median;
      return `${SHORT[id]} ${d > 0 ? `-${d}일` : d < 0 ? `+${-d}일` : '동일'}`;
    });
    console.log(`  ${padE(tier.label, 10)} ${diffs.join(' · ')}`);
  }
}

// ── 다이아 소비 내역 (정책이 뭘 샀는지 보이게) ───────────────────────────────
console.log(`\n=== 다이아 소비 내역 ("보통" 기준, 시드 평균) ===`);
for (const row of normalRows) {
  const tier = TIERS.find((t) => t.key === row.tier)!;
  const items = Object.entries(row.agg.purchases)
    .filter(([id]) => content.shopProducts.find((p) => p.id === id)?.shop === 'diamond')
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${content.shopProducts.find((p) => p.id === id)!.name} ${n.toFixed(0)}회`);
  console.log(`  ${padE(tier.label, 10)} 사용 ${pad(row.agg.diamondsSpent, 6)}💎 · 뽑기 신규 ${pad(row.agg.gachaNew, 3)}종 · 모래시계 ${pad(row.agg.hourglassHours, 5)}시간`);
  console.log(`             ${items.join(' · ') || '없음'}`);
}
console.log('');

/**
 * 게이트 상호작용 측정 (2026-08-25)
 *
 *   npx tsx scripts/gate-interaction.ts [--days 35]
 *
 * 진행 게이트는 하나가 아니다 — 지역 해금(도감·재료)과 파티 슬롯(도감·골드)이 **직렬로 물려** 있다.
 * 슬롯이 늦으면 파티가 약하고, 약한 파티는 도감을 못 채워 지역 해금이 또 밀린다.
 * 그래서 각자 단독으로 잰 값은 합류 시점에 무효다 — 여기서 합친 상태를 다시 잰다.
 *
 * 실측 사례 (2026-08-25): 지역 게이트 재조정과 슬롯 문턱 재조정을 각자 브랜치에서 재고 합쳤더니
 * "보통"은 그대로인데 **방치만** 늪 D11→D17 · 화산 D17→D25 · 전멸 6→21회로 밀렸다.
 * 게이트를 조이면 항상 가장 느린 세그먼트에 곱으로 걸린다.
 */
import { loadContent, type Content } from '../src/content';
import { simulate, STRATEGIES } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 35) || 35;

interface SlotCase {
  label: string;
  captured: [number, number];
  gold: [number, number];
}

function contentWith(slots: SlotCase): Content {
  const base = loadContent();
  return {
    ...base,
    balance: {
      ...base.balance,
      party: {
        ...base.balance.party,
        slotUnlocks: [
          { slots: 4, gold: slots.gold[0], totalCaptured: slots.captured[0] },
          { slots: 5, gold: slots.gold[1], totalCaptured: slots.captured[1] },
        ],
      },
    },
  } as Content;
}

const CASES: SlotCase[] = [
  { label: '이전 (도감 10/25 · 골드 3,000/12,000)', captured: [10, 25], gold: [3_000, 12_000] },
  { label: '현행 (도감 40/104 · 골드 6,000/40,000)', captured: [40, 104], gold: [6_000, 40_000] },
  { label: '완화안 (도감 24/60 · 골드 6,000/40,000)', captured: [24, 60], gold: [6_000, 40_000] },
  { label: '완화안2 (도감 30/80 · 골드 6,000/40,000)', captured: [30, 80], gold: [6_000, 40_000] },
];

const ORDER = ['whispering-woods', 'sunken-marsh', 'ashen-volcano'] as const;
const SHORT: Record<string, string> = { 'whispering-woods': '숲', 'sunken-marsh': '늪', 'ashen-volcano': '화산' };
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padE = (s: string, n: number) => {
  const w = [...s].reduce((sum, c) => sum + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
};

console.log(`\n=== 파티 슬롯 문턱이 지역 해금에 주는 영향 (${DAYS}일, 기본 봇) ===`);
console.log(`   슬롯은 지역 해금 조건이 아닌데도 해금 일차를 움직인다 — 파티 크기가 도감 채우는 속도를 정하기 때문`);
for (const slots of CASES) {
  console.log(`\n▶ ${slots.label}`);
  const content = contentWith(slots);
  for (const strategy of STRATEGIES) {
    const r = simulate(content, strategy, { days: DAYS });
    const cells = ORDER.map((id) => `${SHORT[id]} ${pad(r.unlockDay[id] ? `D${r.unlockDay[id]}` : '미달', 4)}`);
    const last = r.days[r.days.length - 1];
    const wipeRate = r.totals.runs > 0 ? ((r.totals.wipes / r.totals.runs) * 100).toFixed(0) : '－';
    console.log(
      `   ${padE(strategy.label, 20)} ${cells.join(' · ')}  | 런 ${pad(r.totals.runs, 4)} · 전멸 ${pad(r.totals.wipes, 3)}(${pad(wipeRate + '%', 4)}) · 도감 ${pad(last?.captured ?? 0, 3)}`,
    );
  }
}
console.log(`\n   ※ GDD §9.1: "방치는 숲 콘텐츠 중심으로 첫 주를 보내며 전멸률이 낮게 유지되어야 한다"`);
console.log('');

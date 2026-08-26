/**
 * M3 밸런스 시뮬레이터 (ROADMAP M3, TECH §10)
 * 봇 전략 3종(scripts/bot.ts)이 같은 core 로직으로 N일을 플레이한 진행 리포트를 낸다.
 *
 *   npx tsx scripts/simulate.ts [--days 7] [--json <출력경로>] [--codex] [--gates]
 *
 * 목표 곡선(GDD §9.1, 2026-08-26 12지역 개편 — "보통" 기준):
 *   티어1 D1~4 → 티어2 진입 D4~7 → 티어3 진입 D10~16 → 티어4 진입 D26~36 → 최종 D40~56
 * 봇 로직 자체는 scripts/bot.ts — 해금 조건을 바꿔가며 재는 unlock-sweep.ts와 공유한다.
 */
import { content } from '../src/content';
import { simulate, STRATEGIES } from './bot';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 7) || 7;
const jsonIdx = args.indexOf('--json');
const JSON_OUT = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const CODEX_MODE = args.includes('--codex'); // 도감 우선 파견 (지역 24종 채우기 속도 측정용)
const SHOW_GATES = args.includes('--gates'); // 해금 게이트 중 무엇이 병목인지 (도감 vs 재료)

const results = STRATEGIES.map((strategy) => simulate(content, strategy, { days: DAYS, codexMode: CODEX_MODE }));

const REGION_LABEL: Record<string, string> = {
  'misty-coast': '해안', 'pearl-shallows': '갯벌', 'storm-cape': '곶',
  'whispering-woods': '숲', 'moonlit-thicket': '덤불', 'elder-canopy': '우듬지',
  'sunken-marsh': '늪', 'peat-mire': '이탄', 'frozen-abyss': '심연',
  'ashen-volcano': '화산', 'lava-gorge': '협곡', 'crater-heart': '심장부',
};
/** "보통" 유저 기준 목표 (GDD §9.1, 2026-08-26 12지역). 하드코어는 하한의 절반까지 허용으로 본다. */
const GOAL: Record<string, [number, number]> = {
  'pearl-shallows': [1, 2], 'storm-cape': [2, 4],
  'whispering-woods': [4, 7], 'moonlit-thicket': [6, 9], 'elder-canopy': [7, 12],
  'sunken-marsh': [10, 16], 'peat-mire': [14, 22], 'frozen-abyss': [21, 28],
  'ashen-volcano': [26, 36], 'lava-gorge': [30, 45], 'crater-heart': [38, 56],
};
/** 파티 슬롯 목표 창 ("보통" 기준 — 12지역 개편 후 잠정, slot-sweep 재계측 전) */
const SLOT_GOAL: Record<number, [number, number]> = { 4: [4, 9], 5: [18, 32] };

console.log(`\n=== NewWorld ${DAYS}일 진행 시뮬레이션 ===`);
for (const result of results) {
  console.log(`\n▶ ${result.label}`);
  console.log('  일차 | 누적골드 | 도감 | 상위3 CP | 런 | 전멸 | 슬롯 | 해금');
  for (const row of result.days) {
    console.log(
      `   D${row.day}  | ${String(row.gold).padStart(7)} | ${String(row.captured).padStart(3)} | ${String(row.topCp).padStart(7)} | ${String(row.runs).padStart(3)} | ${String(row.wipes).padStart(3)} | ${String(row.partySlots).padStart(4)} | 지역${row.unlocked}`,
    );
  }
  const unlocks = Object.entries(result.unlockDay)
    .filter(([id]) => id !== 'misty-coast')
    .map(([id, day]) => {
      const [lo, hi] = GOAL[id] ?? [0, 99];
      const mark = day >= lo && day <= hi ? '✅' : day < lo ? '⚡빠름' : '🐌느림';
      return `${REGION_LABEL[id] ?? id} D${day}(목표 D${lo}~${hi}) ${mark}`;
    });
  console.log(`  해금: ${unlocks.length > 0 ? unlocks.join(' · ') : '없음'}`);
  // 게이트 병목 — 도감 조건과 재료 조건이 각각 언제 채워졌는가 (늦게 채워진 쪽이 실제 제동)
  if (SHOW_GATES) {
    const gates = ['whispering-woods', 'sunken-marsh', 'ashen-volcano'].map((id) => {
      const codex = result.codexReadyDay[id];
      const mat = result.materialReadyDay[id];
      const fmt = (d: number | undefined) => (d === undefined ? '미달' : `D${d}`);
      const bind = codex === undefined || mat === undefined
        ? '미달'
        : codex > mat ? '도감' : codex < mat ? '재료' : '동시';
      return `${REGION_LABEL[id]}(도감 ${fmt(codex)} · 재료 ${fmt(mat)} → 병목 ${bind})`;
    });
    console.log(`  게이트: ${gates.join(' · ')}`);
  }
  // 파티 슬롯 게이트 (2026-08-25) — 도감/골드 중 무엇이 제동인지까지 표기
  const slots = Object.entries(result.slotGate).map(([slots, obs]) => {
    const [lo, hi] = SLOT_GOAL[Number(slots)] ?? [0, 99];
    if (obs.buyDay === undefined) return `${slots}칸 미달(도감 ${obs.codexDay ? `D${obs.codexDay}` : '미충족'}·골드 ${obs.goldDay ? `D${obs.goldDay}` : '미충족'})`;
    const mark = obs.buyDay >= lo && obs.buyDay <= hi ? '✅' : obs.buyDay < lo ? '⚡빠름' : '🐌느림';
    // 마지막으로 충족된 조건이 곧 제동이다
    const brake = (obs.codexDay ?? 0) >= (obs.goldDay ?? 0) ? '도감' : '골드';
    return `${slots}칸 D${obs.buyDay}(목표 D${lo}~${hi}) ${mark} 제동=${brake}(도감 ${obs.capturedAtBuy}종)`;
  });
  console.log(`  파티 슬롯: ${slots.length > 0 ? slots.join(' · ') : '없음'}`);
  // 지역 도감 16종(포획 가능 완채 — 업적 16계단) 도달 일차
  const codexGoals = content.regionList.map((region) => {
    const label = REGION_LABEL[region.id] ?? region.id;
    const hit = result.days.find((row) => (row.byRegion[region.id] ?? 0) >= 16);
    const last = result.days[result.days.length - 1];
    return `${label} ${hit ? `D${hit.day}` : `미달(${last?.byRegion[region.id] ?? 0}/16)`}`;
  });
  console.log(`  도감 16종 도달: ${codexGoals.join(' · ')}`);
  console.log(`  총계: 런 ${result.totals.runs} · 전멸 ${result.totals.wipes} · 유물 ${result.totals.artifacts} · 전설 목격 ${result.totals.legendarySeen ? 'O' : 'X'}`);
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  console.log(`\nJSON → ${JSON_OUT}`);
}

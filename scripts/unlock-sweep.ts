/**
 * 지역 해금 조건 스윕 (2026-08-25 · 2026-08-26 12지역 개편)
 *
 *   npx tsx scripts/unlock-sweep.ts [--days 70] [--search] [--seeds 3]
 *
 * 해금은 11관문 체인이다 — 티어 내부는 도감 단독, 티어 진입은 도감 AND 재료.
 * 어느 쪽이 실제 제동인지는 숫자를 봐선 알 수 없어서, 조건을 바꿔가며 봇 3종을 돌려
 * **해금 일차**로 판정한다.
 *
 * 판정 기준 (GDD §9.1, 2026-08-26 재설정 — 총 러닝타임 ~50일):
 *   - "보통" 유저: 티어1 D1~3 · 티어2 D4~12 · 티어3 D12~28 · 티어4 D28~55
 *   - 하드코어: 보통의 2~2.5배 속도까지 허용 (그보다 빠르면 게이트가 헐렁한 것)
 *   - 방치: 밀리는 건 수용하되 목표의 ~1.5배 안에는 닿아야 한다
 */
import { loadContent, type Content } from '../src/content';
import { simulate, STRATEGIES, type SimResult } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 70) || 70;
const SEEDS = Number(args[args.indexOf('--seeds') + 1] || 1) || 1;
const SEARCH = args.includes('--search');

/** 관문 순서 (order 2~12). 티어 진입은 재료 조건 동반 */
const GATES = [
  'pearl-shallows', 'storm-cape',
  'whispering-woods', 'moonlit-thicket', 'elder-canopy',
  'sunken-marsh', 'peat-mire', 'frozen-abyss',
  'ashen-volcano', 'lava-gorge', 'crater-heart',
] as const;
type GateId = (typeof GATES)[number];
const TIER_ENTRIES = new Set<GateId>(['whispering-woods', 'sunken-marsh', 'ashen-volcano']);

const SHORT: Record<GateId, string> = {
  'pearl-shallows': '갯벌', 'storm-cape': '곶',
  'whispering-woods': '숲', 'moonlit-thicket': '덤불', 'elder-canopy': '우듬지',
  'sunken-marsh': '늪', 'peat-mire': '이탄', 'frozen-abyss': '심연',
  'ashen-volcano': '화산', 'lava-gorge': '협곡', 'crater-heart': '심장부',
};

/** 목표 창 — "보통" 유저의 해금 일차 (12비트 계단: 초반 촘촘 → 후반 묵직) */
const GOAL: Record<GateId, [number, number]> = {
  'pearl-shallows': [1, 2],
  'storm-cape': [2, 4],
  'whispering-woods': [4, 6],
  'moonlit-thicket': [6, 9],
  'elder-canopy': [8, 12],
  'sunken-marsh': [12, 16],
  'peat-mire': [16, 22],
  'frozen-abyss': [21, 28],
  'ashen-volcano': [28, 36],
  'lava-gorge': [35, 45],
  'crater-heart': [44, 56],
};
/**
 * 방치 유저 수용선 — 목표 상한의 ~2배 (계측 기간을 넘으면 미달로 계산).
 * 2026-08-26 확정 곡선에서 방치는 보통의 약 2배로 닿는다 — 러닝타임이 3배로 늘며
 * 방치 격차도 비례해 커진 것이고, 마지막 두 관문이 70일을 넘는 것은 수용한 설계다 (GDD §9.1).
 */
const IDLE_CAP: Record<GateId, number> = Object.fromEntries(
  GATES.map((id) => [id, Math.min(DAYS, Math.round(GOAL[id][1] * 2))]),
) as Record<GateId, number>;

/** 한 후보 = 관문별 도감 조건 + 티어 진입 재료 조건 (2종 대칭이라 한 숫자) */
type Candidate = { label: string; codex: Record<GateId, number>; mats: Record<GateId, number> };

function contentWith(c: Candidate): Content {
  const content = loadContent();
  for (const id of GATES) {
    const region = content.regions.get(id)! as {
      materials: readonly string[];
      unlock: { codexCaptured?: Record<string, number>; materials?: Record<string, number> };
    };
    const prevId = content.regionList[content.regions.get(id)!.order - 2]!.id;
    region.unlock.codexCaptured = { [prevId]: c.codex[id] };
    if (TIER_ENTRIES.has(id)) {
      const prevMaterials = content.regions.get(prevId)!.materials;
      region.unlock.materials = Object.fromEntries(prevMaterials.map((m) => [m, c.mats[id]]));
    }
  }
  return content;
}

const current = (): Candidate => {
  const content = loadContent();
  const codex = {} as Record<GateId, number>;
  const mats = {} as Record<GateId, number>;
  for (const id of GATES) {
    const region = content.regions.get(id)!;
    codex[id] = Object.values(region.unlock.codexCaptured ?? {})[0] ?? 0;
    mats[id] = Object.values(region.unlock.materials ?? {})[0] ?? 0;
  }
  return { label: '현행 (regions.json)', codex, mats };
};

interface Row {
  strategy: string;
  unlock: Record<string, number | undefined>;
  bind: Record<string, string>;
  codexReady: Record<string, number | undefined>;
  matReady: Record<string, number | undefined>;
}

/** 시드 여러 개의 해금 일차 중앙값 (미달 시드는 DAYS+10으로 치고 중앙값이 기간 안일 때만 값 인정) */
function run(c: Candidate): Row[] {
  const content = contentWith(c);
  return STRATEGIES.map((strategy) => {
    const results: SimResult[] = Array.from({ length: SEEDS }, (_, i) =>
      simulate(content, strategy, { days: DAYS, seedSalt: SEEDS > 1 ? `-u${i}` : '' }));
    const per = (field: 'unlockDay' | 'codexReadyDay' | 'materialReadyDay') =>
      Object.fromEntries(GATES.map((id) => {
        const days = results.map((r) => r[field][id] ?? DAYS + 10).sort((a, b) => a - b);
        const m = days[Math.floor(days.length / 2)]!;
        return [id, m > DAYS ? undefined : m];
      }));
    const u = per('unlockDay');
    const cr = per('codexReadyDay');
    const mr = per('materialReadyDay');
    const bind: Record<string, string> = {};
    for (const id of GATES) {
      const codex = cr[id];
      const mat = TIER_ENTRIES.has(id) ? mr[id] : undefined;
      bind[id] =
        !TIER_ENTRIES.has(id) ? '도감'
        : codex === undefined && mat === undefined ? '－'
        : codex === undefined ? '도감'
        : mat === undefined ? '재료'
        : codex > mat ? '도감' : codex < mat ? '재료' : '동시';
    }
    return { strategy: strategy.name, unlock: u, bind, codexReady: cr, matReady: mr };
  });
}

function verdict(rows: Row[]): { text: string; penalty: number } {
  const normal = rows.find((r) => r.strategy === 'normal')!;
  const hard = rows.find((r) => r.strategy === 'hardcore')!;
  const idle = rows.find((r) => r.strategy === 'idle')!;
  let penalty = 0;
  const marks: string[] = [];
  for (const id of GATES) {
    const [lo, hi] = GOAL[id];
    const d = normal.unlock[id];
    if (d === undefined) { penalty += 20; marks.push(`${SHORT[id]}✗`); continue; }
    const off = d < lo ? lo - d : d > hi ? d - hi : 0;
    penalty += off * 2;
    marks.push(d >= lo && d <= hi ? `${SHORT[id]}✅` : d < lo ? `${SHORT[id]}⚡${lo - d}` : `${SHORT[id]}🐌${d - hi}`);
  }
  // 하드코어가 보통의 2.5배보다 빠르면 게이트가 헐렁하다
  const ratios = GATES.map((id) => {
    const n = normal.unlock[id];
    const h = hard.unlock[id];
    return n && h ? n / h : NaN;
  }).filter((x) => !Number.isNaN(x));
  const worst = ratios.length > 0 ? Math.max(...ratios) : NaN;
  if (worst > 2.5) penalty += (worst - 2.5) * 6;
  // 방치 수용선
  let idleLate = 0;
  for (const id of GATES) {
    const d = idle.unlock[id];
    if (d === undefined) { penalty += id === 'crater-heart' ? 4 : 10; idleLate++; continue; }
    if (d > IDLE_CAP[id]) { penalty += (d - IDLE_CAP[id]) * 1; idleLate++; }
  }
  // 티어 진입에서 도감이 주 제동으로 살아 있는가 (재료가 훨씬 먼저 차면 재료는 죽은 숫자)
  for (const id of TIER_ENTRIES) {
    const codex = normal.codexReady[id];
    const mat = normal.matReady[id];
    if (codex === undefined || mat === undefined) continue;
    const gap = codex - mat; // >0 도감이 병목
    if (gap < 0) penalty += Math.min(4, -gap); // 재료가 병목 — 역진적
    else if (gap > 3) penalty += (gap - 3) * 0.5; // 재료가 죽은 숫자
  }
  const text = `${marks.join(' ')} | 하드코어 ${Number.isNaN(worst) ? '－' : `${worst.toFixed(1)}x`}${worst > 2.6 ? '⚠' : ''} | 방치 지각 ${idleLate}관문`;
  return { text, penalty };
}

function report(c: Candidate): number {
  const rows = run(c);
  console.log(`\n▶ ${c.label}`);
  console.log(`   도감 ${GATES.map((id) => `${SHORT[id]}${c.codex[id]}`).join(' ')} · 재료 ${[...TIER_ENTRIES].map((id) => `${SHORT[id]}${c.mats[id]}`).join(' ')}`);
  for (const row of rows) {
    const cells = GATES.map((id) => {
      const d = row.unlock[id];
      return `${SHORT[id]}${d ? `D${d}` : '✗'}`;
    });
    console.log(`   ${row.strategy.padEnd(9)} ${cells.join(' ')}`);
  }
  const v = verdict(rows);
  console.log(`   판정(${v.penalty.toFixed(1)}): ${v.text}`);
  return v.penalty;
}

// ── 자동 탐색 — 체인이 순차적이라 앞 관문부터 확정하는 단계별 탐욕 ───────────
function searchBest(): void {
  const base = current();
  const stage = (id: GateId, codexValues: number[], matValues: number[] | null): void => {
    console.log(`\n── ${SHORT[id]} (${id}) ──`);
    const combos: { codex: number; mat: number }[] = [];
    for (const cv of codexValues) for (const mv of matValues ?? [base.mats[id]]) combos.push({ codex: cv, mat: mv });
    const scored = combos.map(({ codex, mat }) => {
      const candidate: Candidate = {
        label: '', codex: { ...base.codex, [id]: codex }, mats: { ...base.mats, [id]: mat },
      };
      const rows = run(candidate);
      const v = verdict(rows);
      const d = rows.find((r) => r.strategy === 'normal')!.unlock[id];
      return { codex, mat, penalty: v.penalty, day: d };
    }).sort((a, b) => a.penalty - b.penalty);
    for (const s of scored.slice(0, 5)) {
      console.log(`   ${String(s.penalty.toFixed(1)).padStart(6)}  도감${String(s.codex).padStart(2)}${matValues ? ` 재료${String(s.mat).padStart(2)}` : ''}  보통 ${s.day ? `D${s.day}` : '✗'}`);
    }
    base.codex[id] = scored[0]!.codex;
    base.mats[id] = scored[0]!.mat;
  };

  // 테스트 불변식: 도감 4~16종(포획 가능 16 대비 25~100%), 티어 진입 비율 단조, 재료 ≤ 도감×1.5
  stage('pearl-shallows', [4, 5, 6, 8], null);
  stage('storm-cape', [6, 8, 10], null);
  stage('whispering-woods', [8, 10, 12], [8, 12, 16]);
  stage('moonlit-thicket', [8, 9, 10, 12], null);
  stage('elder-canopy', [10, 11, 12, 13], null);
  stage('sunken-marsh', [12, 13, 14], [12, 16, 20]);
  stage('peat-mire', [10, 12, 13], null);
  stage('frozen-abyss', [12, 13, 14], null);
  stage('ashen-volcano', [14, 15, 16], [16, 20, 24]);
  stage('lava-gorge', [12, 13, 14], null);
  stage('crater-heart', [13, 14, 15, 16], null);

  console.log('\n── 탐색 결과 ──');
  base.label = '탐색 최적';
  report(base);
  console.log('\nregions.json 반영값:');
  for (const id of GATES) {
    console.log(`   ${id}: 도감 ${base.codex[id]}${TIER_ENTRIES.has(id) ? ` + 재료 ${base.mats[id]}×2` : ''}`);
  }
}

console.log(`\n=== 지역 해금 조건 스윕 — 12지역 (${DAYS}일 · 시드 ${SEEDS}) ===`);
if (SEARCH) searchBest();
else report(current());
console.log('');

/**
 * 지역 해금 조건 스윕 (2026-08-25)
 *
 *   npx tsx scripts/unlock-sweep.ts [--days 21] [--grid]
 *
 * 해금 조건은 두 개의 게이트(도감 종 수 · 재료 개수)를 AND로 건다. 어느 쪽이 실제 제동인지는
 * 숫자를 봐선 알 수 없어서, 조건을 바꿔가며 봇 3종을 돌려 **해금 일차**로 판정한다.
 *
 * 판정 기준 (GDD §9.1):
 *   - "보통" 유저: 숲 D1~2 · 늪 D6~8 · 화산 D10~14
 *   - 하드코어: 보통의 2~2.5배 속도까지 허용 (그보다 빠르면 게이트가 헐렁한 것)
 *   - 방치: 밀리는 건 수용하되 첫 2~3주 안에는 화산까지 닿아야 한다
 */
import { loadContent, type Content } from '../src/content';
import { simulate, STRATEGIES } from './bot';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1] || 21) || 21;
const GRID = args.includes('--grid');
const SEARCH = args.includes('--search');

/** 한 후보 = 지역별 (도감 조건, 재료 조건). 재료는 2종 대칭이라 한 숫자로 적는다. */
interface Candidate {
  label: string;
  woodsCodex: number; // 숲 해금 — 해안 도감 N종
  marshCodex: number; // 늪 해금 — 숲 도감 N종
  marshMat: number; // 늪 해금 — 숲 재료 2종 각 N개
  volcanoCodex: number; // 화산 해금 — 늪 도감 N종
  volcanoMat: number; // 화산 해금 — 늪 재료 2종 각 N개
}

function contentWith(c: Candidate): Content {
  const content = loadContent();
  const set = (regionId: string, codexFrom: string, codexN: number, mats: Record<string, number> | null): void => {
    const region = content.regions.get(regionId)! as {
      unlock: { codexCaptured?: Record<string, number>; materials?: Record<string, number> };
    };
    region.unlock.codexCaptured = { [codexFrom]: codexN };
    if (mats) region.unlock.materials = mats;
  };
  set('whispering-woods', 'misty-coast', c.woodsCodex, null);
  set('sunken-marsh', 'whispering-woods', c.marshCodex, { 'dew-branch': c.marshMat, 'spirit-moss': c.marshMat });
  set('ashen-volcano', 'sunken-marsh', c.volcanoCodex, { 'grave-reed': c.volcanoMat, 'chill-amber': c.volcanoMat });
  return content;
}

const GOAL: Record<string, [number, number]> = {
  'whispering-woods': [1, 2],
  'sunken-marsh': [6, 8],
  'ashen-volcano': [10, 14],
};
const ORDER = ['whispering-woods', 'sunken-marsh', 'ashen-volcano'] as const;
const SHORT: Record<string, string> = { 'whispering-woods': '숲', 'sunken-marsh': '늪', 'ashen-volcano': '화산' };

interface Row {
  strategy: string;
  unlock: Record<string, number | undefined>;
  bind: Record<string, string>;
  codexReady: Record<string, number | undefined>;
  matReady: Record<string, number | undefined>;
}

function run(c: Candidate): Row[] {
  const content = contentWith(c);
  return STRATEGIES.map((strategy) => {
    const result = simulate(content, strategy, { days: DAYS });
    const bind: Record<string, string> = {};
    for (const id of ORDER) {
      const codex = result.codexReadyDay[id];
      const mat = result.materialReadyDay[id];
      bind[id] =
        codex === undefined && mat === undefined ? '－'
        : codex === undefined ? '도감'
        : mat === undefined ? '재료'
        : codex > mat ? '도감' : codex < mat ? '재료' : '동시';
    }
    return {
      strategy: strategy.name,
      unlock: Object.fromEntries(ORDER.map((id) => [id, result.unlockDay[id]])),
      bind,
      codexReady: Object.fromEntries(ORDER.map((id) => [id, result.codexReadyDay[id]])),
      matReady: Object.fromEntries(ORDER.map((id) => [id, result.materialReadyDay[id]])),
    };
  });
}

/** 보통 유저가 목표 구간 안인가 + 하드코어가 2~2.5배 안인가 + 방치가 기간 내 화산에 닿는가 */
function verdict(rows: Row[]): string {
  const normal = rows.find((r) => r.strategy === 'normal')!;
  const hard = rows.find((r) => r.strategy === 'hardcore')!;
  const idle = rows.find((r) => r.strategy === 'idle')!;
  const marks: string[] = [];
  for (const id of ORDER) {
    const [lo, hi] = GOAL[id]!;
    const d = normal.unlock[id];
    marks.push(d === undefined ? `${SHORT[id]}✗` : d >= lo && d <= hi ? `${SHORT[id]}✅` : d < lo ? `${SHORT[id]}⚡` : `${SHORT[id]}🐌`);
  }
  const ratios = ORDER.map((id) => {
    const n = normal.unlock[id];
    const h = hard.unlock[id];
    return n && h ? n / h : NaN;
  }).filter((x) => !Number.isNaN(x));
  const worstRatio = ratios.length > 0 ? Math.max(...ratios) : NaN;
  const idleVolcano = idle.unlock['ashen-volcano'];
  return `보통 ${marks.join(' ')} | 하드코어 배속 ${Number.isNaN(worstRatio) ? '－' : `${worstRatio.toFixed(1)}x`}${worstRatio > 2.6 ? '⚠' : ''} | 방치 화산 ${idleVolcano ? `D${idleVolcano}` : '미달⚠'}`;
}

function report(c: Candidate): void {
  const rows = run(c);
  console.log(`\n▶ ${c.label}`);
  console.log(`   숲=해안도감${c.woodsCodex} · 늪=숲도감${c.marshCodex}+재료${c.marshMat}×2 · 화산=늪도감${c.volcanoCodex}+재료${c.volcanoMat}×2`);
  for (const row of rows) {
    const cells = ORDER.map((id) => {
      const d = row.unlock[id];
      const c = row.codexReady[id];
      const m = row.matReady[id];
      const day = (x: number | undefined) => (x === undefined ? '－' : `D${x}`);
      return `${SHORT[id]} ${d ? `D${String(d).padStart(2)}` : ' 미달'}[도감${day(c)}/재료${day(m)}]`;
    });
    console.log(`   ${row.strategy.padEnd(9)} ${cells.join(' · ')}`);
  }
  console.log(`   판정: ${verdict(rows)}`);
}

// ── 후보 ─────────────────────────────────────────────────────────────────────
// 지역당 포획 가능 종은 비전설 48 + 전설 6 = 54. 도감 조건을 그 비율로 읽는다.
const CANDIDATES: Candidate[] = [
  { label: '① 현행 (도감 8/20/20 · 재료 20/32)', woodsCodex: 8, marshCodex: 20, marshMat: 20, volcanoCodex: 20, volcanoMat: 32 },
  // 도감을 주 제동으로, 재료는 "비용"으로 낮춘 안들.
  // 격자 결과: 재료를 16→48로 올려도 보통 유저는 거의 안 밀리고 방치만 3일 밀린다(역진적).
  { label: '② 도감 10/24/40 · 재료 16/24', woodsCodex: 10, marshCodex: 24, marshMat: 16, volcanoCodex: 40, volcanoMat: 24 },
  { label: '③ 도감 10/26/40 · 재료 16/24', woodsCodex: 10, marshCodex: 26, marshMat: 16, volcanoCodex: 40, volcanoMat: 24 },
  { label: '④ 도감 12/24/40 · 재료 16/24', woodsCodex: 12, marshCodex: 24, marshMat: 16, volcanoCodex: 40, volcanoMat: 24 },
  { label: '⑤ 도감 10/24/38 · 재료 16/24', woodsCodex: 10, marshCodex: 24, marshMat: 16, volcanoCodex: 38, volcanoMat: 24 },
  { label: '⑥ 도감 10/28/40 · 재료 16/24', woodsCodex: 10, marshCodex: 28, marshMat: 16, volcanoCodex: 40, volcanoMat: 24 },
  { label: '⑦ 도감 10/24/40 · 재료 20/32 (재료 현행 유지)', woodsCodex: 10, marshCodex: 24, marshMat: 20, volcanoCodex: 40, volcanoMat: 32 },
  { label: '⑧ 도감 10/24/40 · 재료 12/16 (재료 최소)', woodsCodex: 10, marshCodex: 24, marshMat: 12, volcanoCodex: 40, volcanoMat: 16 },
];

// ── 자동 탐색 ────────────────────────────────────────────────────────────────
/**
 * 게이트가 순차적이라(숲이 늦으면 늪도 늦다) 전수 조합은 낭비다. 앞 게이트부터 확정하는
 * 단계별 탐욕 탐색을 쓴다. 점수는 낮을수록 좋다.
 */
function score(rows: Row[]): { penalty: number; detail: string } {
  const normal = rows.find((r) => r.strategy === 'normal')!;
  const hard = rows.find((r) => r.strategy === 'hardcore')!;
  const idle = rows.find((r) => r.strategy === 'idle')!;
  let penalty = 0;
  const notes: string[] = [];

  // 1) "보통" 유저가 목표 구간 밖이면 벗어난 일수만큼 (가장 중요)
  for (const id of ORDER) {
    const [lo, hi] = GOAL[id]!;
    const d = normal.unlock[id];
    if (d === undefined) { penalty += 20; notes.push(`보통 ${SHORT[id]}미달`); continue; }
    const off = d < lo ? lo - d : d > hi ? d - hi : 0;
    if (off > 0) { penalty += off * 2; notes.push(`보통 ${SHORT[id]}${off}일`); }
  }
  // 2) 하드코어가 2.5배보다 빠르면 게이트가 헐렁하다
  const ratios = ORDER.map((id) => {
    const n = normal.unlock[id];
    const h = hard.unlock[id];
    return n && h ? n / h : 0;
  });
  const worst = Math.max(...ratios);
  if (worst > 2.5) { penalty += (worst - 2.5) * 6; notes.push(`배속 ${worst.toFixed(1)}x`); }
  // 3) 방치가 지나치게 밀리면 (GDD가 수용한 선: 숲 D3 · 늪 D13 · 화산 D18)
  const idleCap: Record<string, number> = { 'whispering-woods': 3, 'sunken-marsh': 13, 'ashen-volcano': 18 };
  for (const id of ORDER) {
    const d = idle.unlock[id];
    if (d === undefined) { penalty += 15; notes.push(`방치 ${SHORT[id]}미달`); continue; }
    if (d > idleCap[id]!) { penalty += (d - idleCap[id]!) * 1.5; notes.push(`방치 ${SHORT[id]}+${d - idleCap[id]!}`); }
  }
  // 4) 두 게이트가 비슷한 시점에 채워져야 한다 — 한쪽이 크게 앞서면 반대쪽 조건은 죽은 숫자다.
  //    도감이 주 제동("이 지역을 탐험했다"), 재료는 바로 뒤따르는 보조 제동이 되게 한다.
  let dead = 0;
  for (const id of ORDER) {
    const c = normal.codexReady[id];
    const m = normal.matReady[id];
    if (c === undefined || m === undefined) continue;
    const gap = c - m; // >0 도감이 병목 · <0 재료가 병목
    if (gap < 0) { penalty += Math.min(4, -gap); dead++; notes.push(`${SHORT[id]}도감死`); }
    else if (gap > 2) { penalty += (gap - 2) * 0.8; dead++; notes.push(`${SHORT[id]}재료死`); }
  }
  penalty -= (ORDER.length - dead) * 1.5; // 두 게이트가 다 살아 있는 관문마다 가점
  return { penalty, detail: notes.join(' · ') };
}

function searchBest(): void {
  const base: Candidate = { label: '', woodsCodex: 12, marshCodex: 28, marshMat: 12, volcanoCodex: 28, volcanoMat: 18 };
  const show = (c: Candidate, s: { penalty: number; detail: string }, rows: Row[]) =>
    `${String(s.penalty.toFixed(1)).padStart(6)}  숲${String(c.woodsCodex).padStart(2)} 늪${String(c.marshCodex).padStart(2)}+${String(c.marshMat).padStart(2)} 화산${String(c.volcanoCodex).padStart(2)}+${String(c.volcanoMat).padStart(2)}  |  ` +
    ORDER.map((id) => `${SHORT[id]} ${rows.find((r) => r.strategy === 'normal')!.unlock[id] ?? '－'}`).join(' ') +
    `  |  ${s.detail}`;

  const stage = <K extends keyof Candidate>(title: string, keys: K[], values: number[][]): Candidate => {
    console.log(`\n── ${title} ──`);
    const combos: Candidate[] = [];
    const walk = (i: number, acc: Candidate): void => {
      if (i === keys.length) { combos.push({ ...acc }); return; }
      for (const v of values[i]!) walk(i + 1, { ...acc, [keys[i]!]: v });
    };
    walk(0, base);
    const scored = combos.map((c) => {
      const rows = run(c);
      return { c, s: score(rows), rows };
    }).sort((a, b) => a.s.penalty - b.s.penalty);
    for (const entry of scored.slice(0, 6)) console.log(`   ${show(entry.c, entry.s, entry.rows)}`);
    const winner = scored[0]!.c;
    for (const k of keys) base[k] = winner[k] as Candidate[K];
    return winner;
  };

  stage('1단계: 숲 해금 (해안 도감 N종)', ['woodsCodex'], [[8, 9, 10, 11, 12, 13, 14]]);
  stage('2단계: 늪 해금 (숲 도감 N종 + 숲 재료 N개씩)', ['marshCodex', 'marshMat'], [[20, 24, 26, 28, 30, 32, 36], [6, 8, 10, 12, 16, 20]]);
  stage('3단계: 화산 해금 (늪 도감 N종 + 늪 재료 N개씩)', ['volcanoCodex', 'volcanoMat'], [[20, 24, 28, 30, 32, 36, 40], [8, 12, 16, 20, 26, 32]]);

  console.log(`\n── 탐색 결과 ──`);
  report({ ...base, label: '탐색 최적' });
}

console.log(`\n=== 지역 해금 조건 스윕 (${DAYS}일) ===`);
console.log('   괄호 안은 그 게이트의 병목 — 도감/재료 중 늦게 채워진 쪽');
if (SEARCH) {
  searchBest();
} else {
  for (const candidate of CANDIDATES) report(candidate);
}

if (args.includes('--matrix')) {
  // 숲 게이트 × 화산 도감 게이트 — 늪은 24종+재료16으로 고정, 화산 재료는 24로 고정.
  // 칸은 화산 해금 일차 "보통/하드코어/방치".
  console.log(`\n=== 격자: 숲 도감 조건 × 화산 도감 조건 → 화산 해금 일차 (보통/하드코어/방치) ===`);
  const woodsList = [8, 9, 10, 12];
  const volcanoList = [24, 30, 34, 36, 40, 44];
  console.log(`   ${'숲\\화산'.padEnd(9)}${volcanoList.map((v) => `      ${String(v).padStart(2)}종`).join('')}`);
  for (const w of woodsList) {
    const cells = volcanoList.map((v) => {
      const rows = run({ label: '', woodsCodex: w, marshCodex: 24, marshMat: 16, volcanoCodex: v, volcanoMat: 24 });
      const d = (name: string) => rows.find((r) => r.strategy === name)!.unlock['ashen-volcano'];
      return `${String(d('normal') ?? '－').padStart(3)}/${String(d('hardcore') ?? '－').padStart(2)}/${String(d('idle') ?? '－').padStart(2)}`;
    });
    console.log(`   ${String(w).padStart(5)}종   ${cells.join('  ')}`);
  }
  console.log(`   목표: 보통 D10~14 · 하드코어는 보통의 1/2~1/2.5 · 방치는 ${DAYS}일 안에 도달`);
}

if (GRID) {
  // 화산 관문의 두 축 — 늪 도감 조건 × 늪 재료 조건. 숲=10종, 늪=24종+재료16 고정.
  // 칸은 "화산 해금일(보통/하드코어/방치)" + 보통 기준 병목.
  console.log(`\n=== 격자: 화산 도감 조건 × 화산 재료 조건 → 화산 해금 일차 ===`);
  const codexes = [24, 30, 34, 36, 40];
  const mats = [16, 24, 32, 40, 48];
  console.log(`   ${'도감\\재료'.padEnd(9)}${mats.map((m) => `        ${String(m).padStart(2)}개`).join('')}`);
  for (const codex of codexes) {
    const cells = mats.map((mat) => {
      const rows = run({ label: '', woodsCodex: 10, marshCodex: 24, marshMat: 16, volcanoCodex: codex, volcanoMat: mat });
      const pick = (name: string) => rows.find((r) => r.strategy === name)!;
      const d = (name: string) => pick(name).unlock['ashen-volcano'];
      const bind = pick('normal').bind['ashen-volcano'] ?? '－';
      const tag = bind === '도감' ? '도' : bind === '재료' ? '재' : bind === '동시' ? '동' : '－';
      return `${String(d('normal') ?? '－').padStart(3)}/${String(d('hardcore') ?? '－').padStart(2)}/${String(d('idle') ?? '－').padStart(2)}${tag}`;
    });
    console.log(`   ${String(codex).padStart(6)}종  ${cells.join('  ')}`);
  }
  console.log(`   칸 = 보통/하드코어/방치 + 보통 기준 병목(도=도감 · 재=재료 · 동=동시). 목표 보통 D10~14`);
}
console.log('');

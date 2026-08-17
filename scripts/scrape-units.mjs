// 4399 七龙纪 공식 가이드(동결 보존 중)에서 유닛 데이터를 수집해
// data/units/{race}.json 으로 저장한다. 재실행 가능(멱등).
//
//   node scripts/scrape-units.mjs
//
// URL 목록은 살아있는 유닛 페이지 사이드바에서 추출한 것(2026-08-17 확인).
// 한국어 유닛명은 한국 서비스 공식 종족소개 페이지 기준.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://web.4399.com';

const RACES = {
  rl: { raceId: 'human', nameKo: '휴먼' },
  jl: { raceId: 'elf', nameKo: '엘프' },
  wl: { raceId: 'undead', nameKo: '언데드' },
  em: { raceId: 'devil', nameKo: '악마' },
  zl: { raceId: 'neutral', nameKo: '중립' },
};

// [중국명, 한국 공식명, 경로]
const UNITS = [
  ['长枪兵', '창병', '/qlj/bingzhongfenlei/rl/200809/07-321.html'],
  ['弓箭手', '궁수', '/qlj/bingzhongfenlei/rl/200809/07-320.html'],
  ['狮鹫', '그리핀', '/qlj/bingzhongfenlei/rl/200809/07-319.html'],
  ['剑士', '검사', '/qlj/bingzhongfenlei/rl/200809/07-318.html'],
  ['牧师', '사제', '/qlj/bingzhongfenlei/rl/200809/07-317.html'],
  ['骑士', '기사단', '/qlj/bingzhongfenlei/rl/200809/07-316.html'],
  ['天使', '천사', '/qlj/bingzhongfenlei/rl/200809/07-315.html'],
  ['人类投石车', '투석차(휴먼)', '/qlj/bingzhongfenlei/rl/200809/07-314.html'],
  ['半人马', '켄타우로스', '/qlj/bingzhongfenlei/jl/200809/07-329.html'],
  ['石怪', '드워프', '/qlj/bingzhongfenlei/jl/200809/07-328.html'],
  ['精灵射手', '엘프궁수', '/qlj/bingzhongfenlei/jl/200809/07-327.html'],
  ['飞马', '페가수스', '/qlj/bingzhongfenlei/jl/200809/07-326.html'],
  ['树妖', '드라이어드', '/qlj/bingzhongfenlei/jl/200809/07-325.html'],
  ['独角兽', '유니콘', '/qlj/bingzhongfenlei/jl/200809/07-324.html'],
  ['绿龙', '그린', '/qlj/bingzhongfenlei/jl/200809/07-323.html'],
  ['精灵投石车', '투석차(엘프)', '/qlj/bingzhongfenlei/jl/200809/07-322.html'],
  ['骷髅兵', '해골병', '/qlj/bingzhongfenlei/wl/200809/07-337.html'],
  ['僵尸', '좀비', '/qlj/bingzhongfenlei/wl/200809/07-336.html'],
  ['鬼魂', '고스트', '/qlj/bingzhongfenlei/wl/200809/07-335.html'],
  ['吸血鬼', '뱀파이어', '/qlj/bingzhongfenlei/wl/200809/07-334.html'],
  ['巫师', '리치', '/qlj/bingzhongfenlei/wl/200809/07-333.html'],
  ['黑骑士', '블랙나이트', '/qlj/bingzhongfenlei/wl/200809/07-332.html'],
  ['骨龙', '해골 드래곤', '/qlj/bingzhongfenlei/wl/200809/07-331.html'],
  ['亡灵投石车', '투석차(언데드)', '/qlj/bingzhongfenlei/wl/200809/07-330.html'],
  ['小怪物', '임프', '/qlj/bingzhongfenlei/em/200809/07-344.html'],
  ['歌勒', '곡스', '/qlj/bingzhongfenlei/em/200809/07-343.html'],
  ['地狱犬', '헬하운드', '/qlj/bingzhongfenlei/em/200809/07-342.html'],
  ['恶鬼', '악마', '/qlj/bingzhongfenlei/em/200809/07-341.html'],
  ['邪神', '사신', '/qlj/bingzhongfenlei/em/200809/07-340.html'],
  ['火怪', '악의화신', '/qlj/bingzhongfenlei/em/200809/07-339.html'],
  ['恶魔', '사탄', '/qlj/bingzhongfenlei/em/200809/07-338.html'],
  ['狼人', '놀', '/qlj/bingzhongfenlei/zl/200809/07-351.html'],
  ['蜥蜴人', '리자드맨', '/qlj/bingzhongfenlei/zl/200809/07-350.html'],
  ['龙蝇', '서펜트 플라이', '/qlj/bingzhongfenlei/zl/200809/07-349.html'],
  ['巨蜥', '바실리스크', '/qlj/bingzhongfenlei/zl/200809/07-348.html'],
  ['野牛', '미노타우로스', '/qlj/bingzhongfenlei/zl/200809/07-347.html'],
  ['飞龙', '와이번', '/qlj/bingzhongfenlei/zl/200809/07-346.html'],
  ['九头怪', '히드라', '/qlj/bingzhongfenlei/zl/200809/07-345.html'],
];

// 비용표 컬럼(중국어) → 필드명
const COST_COLS = {
  木材: 'wood',
  石头: 'stone',
  水晶: 'crystal',
  粮食: 'food',
  金币: 'gold',
  兵阶: 'tier',
  速度: 'speed',
  每小时消耗粮食: 'foodUpkeepPerHour',
  '建造时间(秒)': 'trainSeconds',
};

// 레벨표 컬럼(중국어) → 필드명
const STAT_COLS = {
  等级: 'level',
  生命值: 'hp',
  物理攻击: 'patk',
  魔法攻击: 'matk',
  物理防御: 'pdef',
  魔法防御: 'mdef',
};

const STAT_LABELS = { hp: '생명', patk: '물리공격', matk: '마법공격', pdef: '물리방어', mdef: '마법방어' };

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** HTML에서 모든 <table>을 [ [셀,...], ... ] 형태로 파싱 */
function parseTables(html) {
  const tables = [];
  for (const t of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [];
    for (const tr of t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
        stripTags(m[1]),
      );
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function mapRow(header, row, colMap) {
  const out = {};
  header.forEach((col, i) => {
    const key = colMap[col];
    if (!key || row[i] === undefined) return;
    const n = Number(row[i].replace(/[^\d.-]/g, ''));
    out[key] = Number.isFinite(n) && row[i] !== '' ? n : row[i];
  });
  return out;
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (data preservation)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function scrapeUnit(nameCn, nameKo, urlPath) {
  const html = await fetchPage(BASE + urlPath);
  const tables = parseTables(html);

  const costTable = tables.find((t) => t[0]?.includes('木材'));
  const statTable = tables.find((t) => t[0]?.includes('等级'));
  if (!costTable || !statTable) {
    throw new Error(`표를 찾지 못함 (tables=${tables.length})`);
  }

  const meta = mapRow(costTable[0], costTable[1], COST_COLS);
  const stats = statTable
    .slice(1)
    .map((row) => mapRow(statTable[0], row, STAT_COLS))
    .filter((r) => typeof r.level === 'number');

  // 본문 설명: 유닛명 뒤에 오는 설명 문단 (표 이전 텍스트에서 추출)
  const bodyText = stripTags(html.slice(0, html.indexOf('<table')));
  const descStart = bodyText.lastIndexOf(nameCn);
  const descriptionCn = descStart >= 0 ? bodyText.slice(descStart + nameCn.length).trim().slice(0, 300) : '';

  const images = [
    ...new Set(
      [...html.matchAll(/src=["'](http:\/\/img\.my4399\.com[^"']+)["']/g)]
        .map((m) => m[1])
        .filter((u) => !u.endsWith('www.jpg')),
    ),
  ];

  const raceCode = urlPath.split('/')[3];
  const race = RACES[raceCode];

  return {
    id: `${race.raceId}-t${meta.tier}`,
    raceId: race.raceId,
    nameKo,
    nameCn,
    tier: meta.tier,
    cost: { wood: meta.wood, stone: meta.stone, crystal: meta.crystal, food: meta.food, gold: meta.gold },
    speed: meta.speed,
    foodUpkeepPerHour: meta.foodUpkeepPerHour,
    trainSeconds: meta.trainSeconds,
    statColumns: Object.values(STAT_LABELS),
    stats,
    descriptionCn,
    imageUrls: images,
    sourceUrl: BASE + urlPath,
    provenance: '4399',
  };
}

const byRace = {};
let failed = 0;
for (const [nameCn, nameKo, urlPath] of UNITS) {
  const raceCode = urlPath.split('/')[3];
  try {
    const unit = await scrapeUnit(nameCn, nameKo, urlPath);
    (byRace[raceCode] ??= []).push(unit);
    console.log(`✓ ${RACES[raceCode].nameKo} ${nameKo} (${nameCn}) — tier ${unit.tier}, 레벨 ${unit.stats.length}행`);
  } catch (e) {
    failed++;
    console.error(`✗ ${nameKo} (${urlPath}): ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300)); // 서버 예의
}

const outDir = path.resolve(import.meta.dirname, '../data/units');
await mkdir(outDir, { recursive: true });
for (const [code, units] of Object.entries(byRace)) {
  units.sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99));
  const file = path.join(outDir, `${RACES[code].raceId}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        $comment: `七龙纪 4399 공식 가이드에서 수집 (${new Date().toISOString().slice(0, 10)}). 한국어 명칭은 한국 서비스 공식 종족소개 기준.`,
        raceId: RACES[code].raceId,
        raceNameKo: RACES[code].nameKo,
        units,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`→ ${file} (${units.length}개 유닛)`);
}
console.log(failed ? `\n실패 ${failed}건 — 위 로그 확인` : '\n전체 수집 성공');

// 4399 七龙纪 공식 가이드에서 장비 데이터를 수집해 data/equipment/base.json으로 저장한다.
// 재실행 가능(멱등).
//
//   node scripts/scrape-equipment.mjs
//
// 원작 사양(공식 가이드 원문): 16세트, 무기 5종, 방패 12종.
// 희귀도 6단계(普通/优秀/精良/史诗/传说/神器 = 회색/녹색/파랑/보라/주황/빨강).
// 무기 성격: 도끼=순수 물공, 활·검·셉터=물공+마공, 마법지팡이=순수 마공.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://web.4399.com/qlj/wuqizhuangbei/200809';

// ── 한국어 명칭 (원작 한국판 장비명 자료가 없어 중국어 원문을 번역) ──
const WEAPON_TYPES = [
  { key: 'wand', cn: '魔杖', ko: '마법 지팡이', tableIndex: 1, style: 'magic' },
  { key: 'axe', cn: '斧头', ko: '도끼', tableIndex: 2, style: 'physical' },
  { key: 'sword', cn: '剑', ko: '검', tableIndex: 3, style: 'hybrid' },
  { key: 'scepter', cn: '权杖', ko: '셉터', tableIndex: 4, style: 'hybrid' },
  { key: 'bow', cn: '弓', ko: '활', tableIndex: 5, style: 'hybrid' },
];

const NAME_KO = {
  // 마법 지팡이
  先知魔仗: '예언자의 지팡이', 沉默魔仗: '침묵의 지팡이', 通灵魔仗: '강령의 지팡이',
  生命魔仗: '생명의 지팡이', 统御魔仗: '통솔의 지팡이', 预言魔仗: '계시의 지팡이',
  传说魔仗: '전설의 지팡이', 混乱魔仗: '혼돈의 지팡이', 庄严魔仗: '장엄한 지팡이',
  燃烧魔仗: '불타는 지팡이', 命运魔仗: '운명의 지팡이',
  // 도끼
  狂暴战斧: '광폭한 전투도끼', 敬畏战斧: '경외의 전투도끼', 雷铸战斧: '벼락으로 벼린 도끼',
  君主利斧: '군주의 날도끼', 黎明之斧: '여명의 도끼', 白骨战斧: '백골 전투도끼',
  撕裂之斧: '찢는 도끼', 咆哮之斧: '포효하는 도끼', 荣耀战斧: '영광의 전투도끼',
  天铸战斧: '천상의 전투도끼', 死亡召唤: '죽음의 부름',
  // 검
  魔铁之剑: '마철검', 无情之剑: '무정검', 保护者之剑: '수호자의 검', 黑骑士之剑: '흑기사의 검',
  凋零之剑: '시들음의 검', 寒冰之剑: '한빙검', 水晶之剑: '수정검', 厄运之剑: '액운의 검',
  末日之剑: '종말의 검', 制裁之剑: '제재의 검', 幻影之剑: '환영검',
  // 셉터
  晶石权仗: '정석 셉터', 灵魂权仗: '영혼 셉터', 贵族权仗: '귀족 셉터', 冰冷权仗: '냉기 셉터',
  紫心权仗: '자심 셉터', 月亮权仗: '달의 셉터', 水晶权仗: '수정 셉터', 引导权仗: '인도의 셉터',
  赦免权仗: '사면의 셉터', 烁星权仗: '빛나는 별 셉터', 落星权仗: '떨어지는 별 셉터',
  // 활
  游侠长弓: '유격병의 장궁', 虚灵长弓: '허령의 장궁', 击心强弓: '심장을 꿰뚫는 강궁',
  天火鹰弓: '천화의 매활', 破石之弓: '바위를 부수는 활', 护卫之弓: '호위의 활',
  飓风之弓: '폭풍의 활', 灵魂之弦: '영혼의 활시위', 惩戒之弓: '징계의 활',
  上古神弓: '상고의 신궁', 亚山之弓: '아산의 활',
  // 방패
  白金之盾: '백금 방패', 黑暗之盾: '암흑 방패', 龙鳞之盾: '용비늘 방패', 信仰之盾: '신앙의 방패',
  帝王之盾: '제왕의 방패', 虚无之盾: '허무의 방패', 徽记之盾: '문장 방패', 谴责之盾: '견책의 방패',
  翡翠之盾: '비취 방패', 金狮之盾: '황금사자 방패', 灰烬之盾: '잿더미 방패', 亚山之盾: '아산의 방패',
};

const SET_KO = {
  勇气: '용기', 力量: '힘', 愤怒: '분노', 征服: '정복',
  战神: '전신', 毁灭: '파멸', 雷霆: '뇌정', 光明: '광명',
  博学: '박학', 巫师: '마법사', 奥术: '비술', 灵风: '영풍',
  风暴: '폭풍', 虚空: '허공', 神秘: '신비', 神圣: '신성',
};

// 부위: 세트 부위명 접미사 → 슬롯
const PIECE_SLOT = {
  头: { slot: 'head', ko: '투구' },
  胸: { slot: 'chest', ko: '갑옷' },
  腿: { slot: 'legs', ko: '각반' },
  手: { slot: 'hands', ko: '장갑' },
  鞋: { slot: 'feet', ko: '신발' },
};

const RARITIES = [
  { id: 'common', cn: '普通', ko: '일반', color: '#9a9a9a' },
  { id: 'uncommon', cn: '优秀', ko: '우수', color: '#4caf50' },
  { id: 'rare', cn: '精良', ko: '정교', color: '#3d8fd8' },
  { id: 'epic', cn: '史诗', ko: '서사', color: '#a45cd8' },
  { id: 'legendary', cn: '传说', ko: '전설', color: '#e08a2e' },
  { id: 'artifact', cn: '神器', ko: '신기', color: '#d43b3b' },
];

const SLOTS = [
  { id: 'weapon', ko: '무기' },
  { id: 'shield', ko: '방패' },
  { id: 'head', ko: '투구' },
  { id: 'chest', ko: '갑옷' },
  { id: 'legs', ko: '각반' },
  { id: 'hands', ko: '장갑' },
  { id: 'feet', ko: '신발' },
  { id: 'ring', ko: '반지' },
  { id: 'necklace', ko: '목걸이' },
];

function cell(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/　/g, '')
    .trim();
}

function parseTables(html) {
  return (html.match(/<table[\s\S]*?<\/table>/gi) || []).map((t) =>
    (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) =>
      [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cell(m[1])),
    ),
  );
}

const num = (s) => {
  const n = Number(String(s).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

async function fetchPage(id) {
  const res = await fetch(`${BASE}/07-${id}.html`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (data preservation)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (07-${id})`);
  return await res.text();
}

// ── 무기·방패 ──
const weaponHtml = await fetchPage(305);
const weaponTables = parseTables(weaponHtml);

const weapons = WEAPON_TYPES.map(({ key, cn, ko, tableIndex, style }) => {
  const rows = weaponTables[tableIndex].slice(1);
  const items = rows
    .filter((r) => r.length >= 5 && r[1])
    .map((r) => ({
      heroLevel: num(r[0]),
      nameCn: r[1],
      nameKo: NAME_KO[r[1]] ?? r[1],
      attack: num(r[2]),
      patk: num(r[3]),
      matk: num(r[4]),
    }));
  return { key, nameCn: cn, nameKo: ko, style, items };
});

const shieldRows = weaponTables[6].slice(1);
const shields = shieldRows
  .filter((r) => r.length >= 5 && r[1])
  .map((r) => ({
    heroLevel: num(r[0]),
    nameCn: r[1],
    nameKo: NAME_KO[r[1]] ?? r[1],
    defense: num(r[2]),
    pdef: num(r[3]),
    mdef: num(r[4]),
  }));

// ── 방어구 세트 (전사형 304 / 법사형 303) ──
async function parseArmor(pageId, type) {
  const html = await fetchPage(pageId);
  // 페이지에 중첩 표가 있어 <table> 단위로 자르면 인덱스가 어긋난다.
  // "○○套装(N级)" 제목 위치를 기준으로 다음 제목 직전까지를 한 세트 구간으로 본다.
  const titles = [...html.matchAll(/([一-龥]{2,4})套装\((\d+)级\)/g)];
  const sets = [];

  for (let i = 0; i < titles.length; i++) {
    const m = titles[i];
    const start = m.index + m[0].length;
    const end = i + 1 < titles.length ? titles[i + 1].index : html.length;
    const section = html.slice(start, end);

    const rows = (section.match(/<tr[\s\S]*?<\/tr>/gi) || [])
      .map((tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cell(c[1])))
      .filter((r) => r.length >= 4 && r[0] && r[0] !== '套装名称');
    if (!rows.length) continue;

    const baseCn = m[1];
    const pieces = [];
    let setBonus = null;
    for (const r of rows) {
      const suffix = r[0].slice(-1);
      const info = PIECE_SLOT[suffix];
      if (info) {
        pieces.push({
          slot: info.slot,
          nameCn: r[0],
          nameKo: `${SET_KO[baseCn] ?? baseCn}의 ${info.ko}`,
          defense: num(r[1]),
          pdef: num(r[2]),
          mdef: num(r[3]),
        });
      } else if (r[0].endsWith('套装')) {
        setBonus = { defense: num(r[1]), pdef: num(r[2]), mdef: num(r[3]) };
      }
    }
    if (pieces.length) {
      sets.push({
        id: `${type}-${sets.length + 1}`,
        type,
        nameCn: `${baseCn}套装`,
        nameKo: `${SET_KO[baseCn] ?? baseCn} 세트`,
        heroLevel: num(m[2]),
        pieces,
        setBonus,
      });
    }
  }
  return sets;
}

const warriorSets = await parseArmor(304, 'warrior');
const mageSets = await parseArmor(303, 'mage');

// ── 액세서리 ──
const accHtml = await fetchPage(302);
const accTables = parseTables(accHtml);
const ACC_KO = {
  魔法戒指: { ko: '마법 반지', effect: 'magicCrit', effectKo: '마법 치명타율 증가' },
  经验戒指: { ko: '경험 반지', effect: 'xpGain', effectKo: '획득 경험치 증가' },
  力量戒指: { ko: '힘 반지', effect: 'physCrit', effectKo: '물리 치명타율 증가' },
  幸运戒指: { ko: '행운 반지', effect: 'luck', effectKo: '행운 증가' },
  掠夺项链: { ko: '약탈 목걸이', effect: 'plunder', effectKo: '약탈 비율 증가' },
  说服项链: { ko: '설득 목걸이', effect: 'persuade', effectKo: '설득 효과 증가' },
  统驭项链: { ko: '통솔 목걸이', effect: 'commandLimit', effectKo: '지휘 병력 상한 증가' },
  逃跑项链: { ko: '도주 목걸이', effect: 'escape', effectKo: '도주율 증가' },
  神行项链: { ko: '신행 목걸이', effect: 'marchSpeed', effectKo: '행군 속도 증가' },
  寻宝项链: { ko: '보물탐색 목걸이', effect: 'dropRate', effectKo: '장비 획득 확률 증가' },
};

const accessories = [];
for (const table of accTables) {
  for (const r of table.slice(1)) {
    if (r.length < 4) continue;
    const info = ACC_KO[r[1]];
    if (!info) continue;
    accessories.push({
      slot: r[0] === '戒指' ? 'ring' : 'necklace',
      nameCn: r[1],
      nameKo: info.ko,
      effect: info.effect,
      effectKo: info.effectKo,
      // "3%、6%、9%" / "1倍、2倍、3倍" → 등급별 수치
      tiers: r[3]
        .split(/[、,，]/)
        .map((s) => num(s))
        .filter((n) => n > 0),
      unit: r[3].includes('倍') ? 'multiplier' : 'percent',
    });
  }
}

// ── 저장 ──
const out = {
  $comment:
    '4399 七龙纪 공식 가이드에서 수집한 원작 장비 데이터. ' +
    '무기/방패/방어구 세트 수치와 액세서리 효과는 실측(provenance: 4399). ' +
    '한국어 명칭은 한국판 장비명 자료가 없어 중국어 원문을 번역한 것. ' +
    '드롭 확률·강화 규칙 등 게임 내 획득 방식은 원자료에 없어 별도 estimate로 둔다.',
  provenance: '4399',
  rarities: RARITIES,
  slots: SLOTS,
  weapons,
  shields,
  armorSets: [...warriorSets, ...mageSets],
  accessories,
};

const dir = path.resolve(import.meta.dirname, '../data/equipment');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'base.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`무기 ${weapons.length}종:`, weapons.map((w) => `${w.nameKo}(${w.items.length})`).join(', '));
console.log(`방패 ${shields.length}종`);
console.log(`세트 ${out.armorSets.length}개 (전사 ${warriorSets.length} / 법사 ${mageSets.length})`);
console.log(`액세서리 ${accessories.length}종`);
console.log(`→ ${path.join(dir, 'base.json')}`);

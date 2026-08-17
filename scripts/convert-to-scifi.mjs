// 칠용전설 유닛 데이터를 SF 컨셉으로 변환한다.
//
//   node scripts/convert-to-scifi.mjs
//
// 수치(체력·공격·방어·비용·속도·훈련시간)는 4399 실측값을 **그대로** 유지한다.
// 검증된 밸런스 곡선을 살리면서 이름·세계관만 바꾸는 것이 목적이다.
// 종족 성향 대응:
//   휴먼(균형)   → 연합   Coalition
//   언데드(물량) → 군체   Swarm
//   엘프(정예)   → 성단   Cluster
//   중립         → 야생종
//   악마         → 침략군

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../data/units');

/** 원본 종족 → 새 종족 */
const RACE_MAP = {
  human: { id: 'coalition', ko: '연합', desc: '균형 잡힌 인류 연합군' },
  undead: { id: 'swarm', ko: '군체', desc: '값싼 개체를 대량으로 쏟아내는 유기 생명체' },
  elf: { id: 'cluster', ko: '성단', desc: '고가의 정예 병기를 운용하는 고등 문명' },
  neutral: { id: 'wild', ko: '야생종', desc: '행성 토착 생물' },
  devil: { id: 'invader', ko: '침략군', desc: '외계에서 침투한 적성 세력' },
};

/** 병계별 새 이름 (원본 유닛명 → 새 이름) */
const UNIT_NAMES = {
  // 연합 (구 휴먼)
  창병: '보병',
  궁수: '저격병',
  그리핀: '정찰비행체',
  검사: '돌격병',
  사제: '지원드론',
  기사단: '강습기갑',
  천사: '전략폭격기',
  '투석차(휴먼)': '공성전차',
  // 군체 (구 언데드)
  해골병: '갈퀴충',
  좀비: '육질충',
  고스트: '포자충',
  뱀파이어: '흡혈충',
  리치: '술사충',
  블랙나이트: '갑각충',
  '해골 드래곤': '비룡충',
  '투석차(언데드)': '파열충',
  // 성단 (구 엘프)
  켄타우로스: '정예병',
  드워프: '중장병',
  엘프궁수: '광선병',
  페가수스: '비행정',
  드라이어드: '파장술사',
  유니콘: '수호기',
  그린: '전투함',
  '투석차(엘프)': '파괴포',
  // 야생종 (구 중립)
  놀: '들개',
  리자드맨: '비늘수',
  '서펜트 플라이': '날벌레',
  바실리스크: '암반수',
  미노타우로스: '뿔수',
  와이번: '비행수',
  히드라: '다두수',
  // 침략군 (구 악마)
  임프: '병체',
  곡스: '방사체',
  헬하운드: '추격체',
  악마: '전투체',
  사신: '파동체',
  악의화신: '화염체',
  사탄: '지배체',
};

/** 스탯 컬럼 이름을 SF 용어로 */
const STAT_COLUMNS = ['체력', '실탄공격', '에너지공격', '장갑', '보호막'];

let total = 0;
for (const [oldRace, info] of Object.entries(RACE_MAP)) {
  const src = JSON.parse(await readFile(path.join(dir, `${oldRace}.json`), 'utf8'));

  const units = src.units.map((u) => {
    const nameKo = UNIT_NAMES[u.nameKo];
    if (!nameKo) throw new Error(`이름 매핑 없음: ${u.nameKo} (${oldRace})`);
    return {
      // 수치는 그대로, 식별자와 이름만 교체
      id: `${info.id}-t${u.tier}`,
      raceId: info.id,
      nameKo,
      tier: u.tier,
      cost: u.cost,
      speed: u.speed,
      foodUpkeepPerHour: u.foodUpkeepPerHour,
      trainSeconds: u.trainSeconds,
      statColumns: STAT_COLUMNS,
      stats: u.stats,
      imageUrls: [],
      provenance: u.provenance,
      /** 밸런스 출처 추적용 — 어느 원본 유닛의 수치를 물려받았는지 */
      derivedFrom: { race: oldRace, nameKo: u.nameKo, sourceUrl: u.sourceUrl },
    };
  });

  const out = {
    $comment:
      `${info.ko} 병종. 능력치·비용·훈련시간은 4399 七龙纪 공식 가이드 실측값을 그대로 물려받았고` +
      `(derivedFrom 참조), 이름과 세계관만 자체 창작으로 교체했다. 검증된 밸런스 곡선을 유지하기 위함.`,
    raceId: info.id,
    raceNameKo: info.ko,
    raceDesc: info.desc,
    units,
  };
  await writeFile(path.join(dir, `${info.id}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ ${info.ko.padEnd(4)} ${info.id}.json — ${units.length}종: ${units.map((u) => u.nameKo).join(', ')}`);
  total += units.length;
}
console.log(`\n총 ${total}종 변환 완료`);

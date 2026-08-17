// data/units/*.json에 기록된 원작 유닛 이미지를 내려받아
// public/assets/units/{unitId}.gif 로 저장한다. 재실행 가능(멱등).
//
//   node scripts/fetch-unit-images.mjs
//
// 주의: 내려받는 이미지는 원작(七龙纪) 저작물이다. 개인 개발·참고용으로만 쓰고,
// public/assets/units/ 는 .gitignore로 저장소에서 제외한다.
// 공개 배포 시에는 자체 제작 아트로 교체해야 한다.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const RACES = ['human', 'elf', 'undead', 'devil', 'neutral'];
const outDir = path.resolve(import.meta.dirname, '../public/assets/units');
await mkdir(outDir, { recursive: true });

let ok = 0;
let fail = 0;

for (const race of RACES) {
  const file = path.resolve(import.meta.dirname, `../data/units/${race}.json`);
  const data = JSON.parse(await readFile(file, 'utf8'));

  for (const unit of data.units) {
    const url = unit.imageUrls?.[0];
    if (!url) {
      console.warn(`- ${unit.nameKo}: 이미지 URL 없음`);
      fail++;
      continue;
    }
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'http://web.4399.com/qlj/' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = path.extname(new URL(url).pathname) || '.gif';
      await writeFile(path.join(outDir, `${unit.id}${ext}`), buf);
      console.log(`✓ ${unit.nameKo.padEnd(14)} ${unit.id}${ext} (${buf.length}바이트)`);
      ok++;
    } catch (e) {
      console.error(`✗ ${unit.nameKo}: ${e.message}`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 200)); // 서버 예의
  }
}

console.log(`\n완료: 성공 ${ok} / 실패 ${fail}`);
console.log(`→ ${outDir}`);

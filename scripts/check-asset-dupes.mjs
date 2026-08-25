/**
 * 전 에셋 중복 검사 (docs/ASSETS.md §3-1)
 *
 *   node scripts/check-asset-dupes.mjs [--all]
 *
 * public/assets/ 의 모든 WebP를 지각 해시로 서로 대조해 같은 그림이 두 곳에 쓰인 곳을 찾는다.
 * 기본은 '중복'만, --all 을 주면 '의심'까지 보여준다.
 *
 * 도감은 아이콘이 곧 종의 정체성이라 같은 그림이 두 종에 붙으면 바로 티가 난다.
 * 눈으로 322장을 대조하는 건 비현실적이므로 이 스크립트가 그 일을 한다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUPE_THRESHOLD, HASH_BITS, SUSPECT_THRESHOLD, hammingDistance, perceptualHash, verdict } from './asset-hash.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..');
const showAll = process.argv.includes('--all');

// 의도된 변종 묶음 — 같은 조각을 색만 바꿔 쓰는 경우(초월 3색 드래곤 등)는 중복이 아니다.
// 매핑 대장의 variantOf 필드가 근거다 — 코드에 하드코딩하지 않는다.
const manifest = JSON.parse(readFileSync(join(here, 'assets-manifest.json'), 'utf8'));
const variantGroup = new Map();
for (const group of ['monsters', 'artifacts', 'hourglasses']) {
  for (const [id, entry] of Object.entries(manifest[group] ?? {})) {
    if (entry?.variantOf) variantGroup.set(`${group}/${id}`, entry.variantOf);
  }
}

const assets = [];
for (const group of ['monsters', 'artifacts', 'hourglasses']) {
  const dir = join(REPO, 'public/assets', group);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.webp')) assets.push({ key: `${group}/${file.replace('.webp', '')}`, file: join(dir, file) });
  }
}
for (const a of assets) a.hash = await perceptualHash(a.file);
console.log(`에셋 ${assets.length}장 해시 완료 (중복선 ${DUPE_THRESHOLD}/${HASH_BITS}, 의심선 ${SUSPECT_THRESHOLD})\n`);

const found = [];
for (let i = 0; i < assets.length; i++) {
  for (let j = i + 1; j < assets.length; j++) {
    const ga = variantGroup.get(assets[i].key), gb = variantGroup.get(assets[j].key);
    if (ga && ga === gb) continue; // 같은 변종 묶음 — 실루엣 공유가 의도된 것
    const distance = hammingDistance(assets[i].hash, assets[j].hash);
    const v = verdict(distance);
    if (v === 'ok') continue;
    if (v === 'suspect' && !showAll) continue;
    found.push({ a: assets[i].key, b: assets[j].key, distance, verdict: v });
  }
}
found.sort((x, y) => x.distance - y.distance);

if (found.length === 0) {
  console.log(showAll ? '✅ 중복·의심 없음' : '✅ 중복 없음 (--all 로 의심까지 보기)');
} else {
  for (const f of found) {
    const pct = ((f.distance / HASH_BITS) * 100).toFixed(0);
    console.log(`${f.verdict === 'dupe' ? '❌ 중복' : '⚠️  의심'}  ${f.a}  ≡  ${f.b}   거리 ${f.distance} (${pct}%)`);
  }
  console.log(`\n${found.filter((f) => f.verdict === 'dupe').length}건 중복 · ${found.filter((f) => f.verdict === 'suspect').length}건 의심`);
}
process.exitCode = found.some((f) => f.verdict === 'dupe') ? 1 : 0;

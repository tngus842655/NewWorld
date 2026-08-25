/**
 * 에셋 한 점 교체 (docs/ASSETS.md §3-1)
 *
 *   node scripts/swap-asset.mjs <monsters|artifacts|hourglasses> <id> <새PNG경로> [--slug <slug>] [--by <작가>]
 *
 * 예) IconScout에서 받은 파일로 초월 몬스터 아이콘 교체
 *   node scripts/swap-asset.mjs monsters emberwing-sovereign ~/Downloads/dragon.png --slug dragon-123456 --by "Some Artist"
 *
 * 하는 일 (수동으로 하면 빠뜨리기 쉬운 순서를 고정한다):
 *   1. id가 콘텐츠에 실제로 있는지 확인 — 오타로 엉뚱한 파일을 만드는 사고 방지
 *   2. **기존 전 에셋과 픽셀 해시 대조** — 이미 쓰인 이미지를 다시 넣는 중복 회귀 차단
 *      (2026-08-24 라운드에서 slime·reaper·green-snake가 이 방식으로 3건 중복됐다)
 *   3. 원본 PNG를 BAK에 보관 (재다운로드 비용 절약, 저장소엔 넣지 않는다)
 *   4. 256px WebP로 변환해 public/assets/에 덮어쓰기 (build-assets.mjs와 동일 규격)
 *   5. scripts/assets-manifest.json 갱신 — "무엇을 어디서 받았나"의 진실
 *
 * --force 를 주면 중복이어도 강행한다 (의도적으로 같은 이미지를 공유할 때만).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { HASH_BITS, hammingDistance, perceptualHash, verdict } from './asset-hash.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..');
const RAW_ROOT = 'C:/Workspace/BAK/NewWorld-assets-raw';
const SIZE = 256;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--force'));
const [group, id, pngPath] = positional;
const force = args.includes('--force');

if (!group || !id || !pngPath) {
  console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, ''));
  process.exit(1);
}
if (!['monsters', 'artifacts', 'hourglasses'].includes(group)) {
  console.error(`group은 monsters | artifacts | hourglasses 중 하나여야 합니다 (받은 값: ${group})`);
  process.exit(1);
}
if (!existsSync(pngPath)) {
  console.error(`PNG를 찾을 수 없습니다: ${pngPath}`);
  process.exit(1);
}

// 1) id 실재 확인 — 콘텐츠의 asset 필드를 기준으로 (id와 asset이 다를 수 있다)
const contentFile = group === 'monsters' ? 'monsters.json' : group === 'artifacts' ? 'items.json' : 'hourglasses.json';
const contentRaw = JSON.parse(readFileSync(join(REPO, 'src/content/data', contentFile), 'utf8'));
const entries = Array.isArray(contentRaw)
  ? contentRaw
  : contentRaw[group === 'artifacts' ? 'artifacts' : Object.keys(contentRaw)[0]];
const known = new Set(entries.map((e) => e.asset ?? e.id));
if (!known.has(id)) {
  console.error(`'${id}'는 ${contentFile}의 asset id가 아닙니다. 오타를 확인하세요.`);
  console.error(`비슷한 것: ${[...known].filter((k) => k.includes(id.slice(0, 5))).slice(0, 5).join(', ') || '(없음)'}`);
  process.exit(1);
}

// 2) 중복 대조 — 지각 해시로. 정확 해시(sha256)는 PNG↔WebP 사이에서 무력하다 (asset-hash.mjs 주석 참조)
//    ★ 어떤 파일도 쓰기 전에 끝낸다 — 2026-08-25에 쓰기를 먼저 해서 에셋 1점을 덮어썼다
const incoming = await perceptualHash(pngPath);
const hits = [];
for (const g of ['monsters', 'artifacts', 'hourglasses']) {
  const dir = join(REPO, 'public/assets', g);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.webp')) continue;
    const existingId = file.replace('.webp', '');
    if (g === group && existingId === id) continue; // 자기 자신(교체 대상)은 제외
    const distance = hammingDistance(await perceptualHash(join(dir, file)), incoming);
    const v = verdict(distance);
    if (v !== 'ok') hits.push({ where: `${g}/${existingId}`, distance, verdict: v });
  }
}
hits.sort((a, b) => a.distance - b.distance);
for (const hit of hits) {
  const pct = ((hit.distance / HASH_BITS) * 100).toFixed(0);
  console.error(`${hit.verdict === 'dupe' ? '❌ 중복' : '⚠️  의심'} — ${hit.where} 와 거리 ${hit.distance}/${HASH_BITS} (${pct}%)`);
}
if (hits.some((h) => h.verdict === 'dupe') && !force) {
  console.error('   같은 이미지를 두 곳에 쓰면 도감에서 바로 티가 납니다. 다른 이미지를 고르거나, 의도적이라면 --force 를 주세요.');
  console.error('   ※ 아무것도 변경하지 않았습니다.');
  process.exit(1);
}

// 3) 원본 보관 → 4) 변환 → 5) 대장 갱신 (여기서부터 파일을 쓴다)
mkdirSync(join(RAW_ROOT, group), { recursive: true });
copyFileSync(pngPath, join(RAW_ROOT, group, `${id}.png`));

const outFile = join(REPO, 'public/assets', group, `${id}.webp`);
await sharp(pngPath)
  .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 82, alphaQuality: 90 })
  .toFile(outFile);

const slug = flag('slug');
const by = flag('by');
if (slug || by) {
  const mp = join(here, 'assets-manifest.json');
  const manifest = JSON.parse(readFileSync(mp, 'utf8'));
  manifest[group][id] = { slug: slug ?? manifest[group][id]?.slug ?? '(미기재)', contributor: by ?? manifest[group][id]?.contributor ?? '(미기재)' };
  writeFileSync(mp, JSON.stringify(manifest, null, 2) + '\n');
} else {
  console.warn('⚠️  --slug / --by 를 주지 않아 매핑 대장을 갱신하지 않았습니다 (출처 추적이 끊깁니다).');
}

console.log(`✅ ${group}/${id} 교체 완료`);
console.log(`   원본  ${join(RAW_ROOT, group, `${id}.png`)}`);
console.log(`   변환본 ${outFile}`);
console.log('   브라우저를 새로고침하면 바로 보입니다.');

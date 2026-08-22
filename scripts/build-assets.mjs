/**
 * 에셋 변환 파이프라인 (docs/ASSETS.md §3)
 * BAK의 원본 PNG(500px) → public/assets/monsters/{id}.webp (256px, 투명 유지)
 *
 *   node scripts/build-assets.mjs [--raw <원본폴더>] [--size 256]
 *
 * 원본은 저장소에 넣지 않는다(IconScout 라이선스). 매핑 대장: scripts/assets-manifest.json
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const RAW_DIR = resolve(argOf('raw', 'C:/Workspace/BAK/NewWorld-assets-raw/monsters'));
const OUT_DIR = resolve(here, '../public/assets/monsters');
const SIZE = Number(argOf('size', '256'));

const manifest = JSON.parse(readFileSync(join(here, 'assets-manifest.json'), 'utf8'));
const expected = Object.keys(manifest.monsters);

mkdirSync(OUT_DIR, { recursive: true });
const rawFiles = new Set(readdirSync(RAW_DIR));

let done = 0;
const missing = [];
for (const id of expected) {
  const src = `${id}.png`;
  if (!rawFiles.has(src)) {
    missing.push(id);
    continue;
  }
  await sharp(join(RAW_DIR, src))
    .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(join(OUT_DIR, `${id}.webp`));
  done++;
}

console.log(`변환 완료: ${done}/${expected.length} → ${OUT_DIR}`);
if (missing.length > 0) {
  console.error(`원본 누락: ${missing.join(', ')}`);
  process.exitCode = 1;
}

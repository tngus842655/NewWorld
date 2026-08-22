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

const RAW_ROOT = resolve(argOf('raw', 'C:/Workspace/BAK/NewWorld-assets-raw'));
const OUT_ROOT = resolve(here, '../public/assets');
const SIZE = Number(argOf('size', '256'));

const manifest = JSON.parse(readFileSync(join(here, 'assets-manifest.json'), 'utf8'));
const groups = [
  { name: 'monsters', ids: Object.keys(manifest.monsters) },
  { name: 'artifacts', ids: Object.keys(manifest.artifacts ?? {}) },
];

const missing = [];
for (const group of groups) {
  const rawDir = join(RAW_ROOT, group.name);
  const outDir = join(OUT_ROOT, group.name);
  mkdirSync(outDir, { recursive: true });
  const rawFiles = new Set(readdirSync(rawDir));
  let done = 0;
  for (const id of group.ids) {
    const src = `${id}.png`;
    if (!rawFiles.has(src)) {
      missing.push(`${group.name}/${id}`);
      continue;
    }
    await sharp(join(rawDir, src))
      .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 90 })
      .toFile(join(outDir, `${id}.webp`));
    done++;
  }
  console.log(`${group.name}: ${done}/${group.ids.length} → ${outDir}`);
}

if (missing.length > 0) {
  console.error(`원본 누락: ${missing.join(', ')}`);
  process.exitCode = 1;
}

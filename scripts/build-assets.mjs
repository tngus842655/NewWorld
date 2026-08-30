/**
 * 에셋 변환 파이프라인 (docs/ASSETS.md §3)
 * BAK의 원본 PNG(500px) → public/assets/monsters/{id}.webp (256px, 투명 유지)
 *
 *   node scripts/build-assets.mjs [--raw <원본폴더>] [--size 256] [--only <그룹>]
 *
 * --only 는 한 그룹만 변환한다 (예: --only ui). BAK 원본이 낡은 그룹까지 싸잡아 리빌드해
 * 커밋된 webp를 역행시킨 사고가 있었다 (ASSETS.md §3, 2026-08-29) — 새 에셋 추가는 이 옵션으로.
 *
 * 원본은 저장소에 넣지 않는다(IconScout 라이선스). 매핑 대장: scripts/assets-manifest.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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

const ONLY = argOf('only', null);

const manifest = JSON.parse(readFileSync(join(here, 'assets-manifest.json'), 'utf8'));
const allGroups = [
  { name: 'monsters', ids: Object.keys(manifest.monsters) },
  { name: 'artifacts', ids: Object.keys(manifest.artifacts ?? {}) },
  { name: 'hourglasses', ids: Object.keys(manifest.hourglasses ?? {}) },
  { name: 'ui', ids: Object.keys(manifest.ui ?? {}) }, // 앱바 지도 아이콘 등 UI 에셋 (2026-08-27)
];
const groups = ONLY ? allGroups.filter((g) => g.name === ONLY) : allGroups;
if (groups.length === 0) {
  console.error(`--only ${ONLY}: 그룹 없음 (가능: ${allGroups.map((g) => g.name).join(', ')})`);
  process.exit(1);
}

const missing = [];
for (const group of groups) {
  const rawDir = join(RAW_ROOT, group.name);
  const outDir = join(OUT_ROOT, group.name);
  // 원본 폴더가 통째로 없는 그룹은 건너뛴다 — 일부 그룹만 BAK에 있는 기기에서도 나머지는 변환되게
  if (!existsSync(rawDir)) {
    console.warn(`${group.name}: 원본 폴더 없음 (${rawDir}) — 건너뜀`);
    continue;
  }
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

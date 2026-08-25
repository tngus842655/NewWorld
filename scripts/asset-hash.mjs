/**
 * 에셋 중복 판정용 지각 해시 (dHash 16×16 = 256bit).
 *
 * **왜 sha256이 아닌가**: 원본은 PNG(무손실), 저장소의 변환본은 WebP q82(손실)다.
 * 같은 그림인데도 픽셀의 43%가 다르다 — 포맷이 다른 순간 정확 해시는 항상 "다름"을 뱉는다.
 * 2026-08-25에 이 함정에 빠져 중복 검사가 전부 통과로 나왔고, 그 상태로 진행하다 에셋 1점을 덮어썼다.
 *
 * **왜 여백을 자르는가**: 아이콘은 피사체가 가운데 작게 있고 나머지가 투명이다.
 * 자르지 않으면 격자 대부분이 배경이라 어떤 두 그림이든 거리가 비슷하게 나온다(실측: 변별 실패).
 *
 * 실측 분리도 (2026-08-25, 이 저장소의 실제 에셋으로):
 *   같은 그림 PNG↔WebP  7~11%
 *   다른 그림            44~50%
 *   비슷하지만 다른 물건  15~21%  (삼지창/작살/창처럼 실루엣만 닮은 것)
 * → 13%(33비트)를 중복선, 22%(56비트)를 의심선으로 둔다.
 *   22%를 중복선으로 뒀더니 창 종류를 서로 중복으로 오판했다 — 13%가 세 구간을 정확히 가른다.
 */
import sharp from 'sharp';

const GRID_W = 16;
const GRID_H = 16;
export const HASH_BITS = GRID_W * GRID_H; // 256
export const DUPE_THRESHOLD = Math.round(HASH_BITS * 0.13); // 33
export const SUSPECT_THRESHOLD = Math.round(HASH_BITS * 0.22); // 56

/** 파일 → 256비트 dHash (64자리 hex) */
export async function perceptualHash(file) {
  let img = sharp(file);
  // 투명 여백 제거 — 실패해도(전면 불투명 등) 원본 그대로 진행한다
  try {
    img = sharp(await img.trim({ threshold: 1 }).toBuffer());
  } catch {
    img = sharp(file);
  }
  const buf = await img
    .flatten({ background: { r: 0, g: 0, b: 0 } }) // 알파를 검정으로 통일 — 안 하면 배경색에 따라 해시가 흔들린다
    .greyscale()
    .resize(GRID_W + 1, GRID_H, { fit: 'fill' })
    .raw()
    .toBuffer();

  let bits = 0n;
  for (let row = 0; row < GRID_H; row++) {
    for (let col = 0; col < GRID_W; col++) {
      const i = row * (GRID_W + 1) + col;
      bits = (bits << 1n) | (buf[i] > buf[i + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(HASH_BITS / 4, '0');
}

/** 두 dHash의 해밍 거리 (0 = 동일, 최대 256) */
export function hammingDistance(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** 거리 → 사람이 읽을 판정 */
export function verdict(distance) {
  if (distance <= DUPE_THRESHOLD) return 'dupe';
  if (distance <= SUSPECT_THRESHOLD) return 'suspect';
  return 'ok';
}

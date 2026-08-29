// 런처 아이콘·스플래시·스토어 아이콘을 원본 아이콘 하나에서 만들어 낸다 (MoneyGame 이식, 2026-08-29).
// `npx cap add android`가 찍어주는 기본값은 Capacitor 로고라 그대로 두면 안 된다.
//
//   node scripts/android-assets.mjs
//
// 아이콘을 새로 그리면 SOURCE 파일만 갈아 끼우고 다시 돌리면 된다.

import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import sharp from 'sharp';

const SOURCE = 'public/app-icon/icon-512-v1.png';
const RES = 'android/app/src/main/res';
const STORE = 'store';

// 아트워크 가장자리의 심해 네이비 — 적응형 아이콘 배경으로 깔면
// 원/스퀘어 어느 마스크로 잘려도 아트워크와의 이음매가 눈에 띄지 않는다.
const ICON_BG = '#0d2440';
// capacitor.config.ts backgroundColor / styles.css --bg와 같은 값.
// 네이티브 스플래시 → 웹뷰로 넘어갈 때 색이 튀지 않게 맞춘다.
const SPLASH_BG = '#12141c';

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// 적응형 아이콘은 108dp 캔버스 중 안쪽 72dp만 어떤 마스크에서도 살아남는다.
// 이 아트워크는 위(게임명)·아래(캠프) 양쪽에 내용이 있어서 한쪽으로 밀 수 없다 —
// 66dp로 줄여 중앙에 두면 원형 마스크에서도 양끝이 잘리지 않는다.
const ART_DP = 66;
const ART_SHIFT_DP = 0;

const rounded = (size, ratio) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${size * ratio}" ry="${size * ratio}" fill="#fff"/></svg>`,
  );

// 원본을 size×size로 줄이고 모서리를 ratio만큼 깎는다 (0.5면 원형)
async function art(size, ratio) {
  const flat = await sharp(SOURCE).resize(size, size).png().toBuffer();
  if (!ratio) return flat;
  return sharp(flat)
    .composite([{ input: rounded(size, ratio), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function launcherIcons() {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = `${RES}/mipmap-${density}`;
    await mkdir(dir, { recursive: true });

    // API 25 이하가 쓰는 아이콘. 마스크가 없어 런처가 파일 그대로 보여주므로 모서리를 미리 깎는다.
    const legacy = Math.round(48 * scale);
    await writeFile(`${dir}/ic_launcher.png`, await art(legacy, 0.2));
    await writeFile(`${dir}/ic_launcher_round.png`, await art(legacy, 0.5));

    // 적응형 전경 (108dp 캔버스에 아트워크를 얹은 투명 PNG)
    const canvas = Math.round(108 * scale);
    const inner = Math.round(ART_DP * scale);
    const left = Math.round((canvas - inner) / 2);
    const top = left + Math.round(ART_SHIFT_DP * scale);
    await sharp({
      create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: await art(inner, 0), left, top }])
      .png({ compressionLevel: 9 })
      .toFile(`${dir}/ic_launcher_foreground.png`);
  }

  await writeFile(
    `${RES}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${ICON_BG}</color>
</resources>
`,
  );

  // 기본 템플릿이 남긴 Capacitor 로고 벡터 — 적응형 아이콘이 @color/@mipmap을 쓰므로 참조되지 않는다
  await rm(`${RES}/drawable/ic_launcher_background.xml`, { force: true });
  await rm(`${RES}/drawable-v24`, { recursive: true, force: true });
}

async function splash() {
  // 기본 템플릿은 밀도·방향별 splash.png를 배경으로 늘려 써서 비율마다 찌그러진다.
  // 색 위에 아이콘을 얹는 레이어 하나로 바꾼다 (MoneyGame과 동일).
  for (const density of Object.keys(DENSITIES)) {
    await rm(`${RES}/drawable-port-${density}`, { recursive: true, force: true });
    await rm(`${RES}/drawable-land-${density}`, { recursive: true, force: true });
  }
  await rm(`${RES}/drawable/splash.png`, { force: true });

  await writeFile(`${RES}/drawable/splash_icon.png`, await art(384, 0.2));
  await writeFile(
    `${RES}/values/splash.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splashBackground">${SPLASH_BG}</color>
</resources>
`,
  );
  await writeFile(
    `${RES}/drawable/splash.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splashBackground" />
    <item>
        <bitmap android:gravity="center" android:src="@drawable/splash_icon" />
    </item>
</layer-list>
`,
  );
}

async function storeIcon() {
  await mkdir(STORE, { recursive: true });
  // Play 스토어 아이콘 규격 512×512 32비트 PNG — 원본 그대로 (모서리는 Play가 깎는다)
  await copyFile(SOURCE, `${STORE}/icon-512.png`);
}

await launcherIcons();
await splash();
await storeIcon();
console.log(`아이콘·스플래시·스토어 아이콘 생성 완료 (${SOURCE})`);

// アプリアイコンを SVG から生成（tasks と同じ「淡い背景＋光のにじみ＋ガラス調タイル＋中央のグリフ」構成）。
// challenges は暖色（クリーム × ピーチ × コーラル）で、中央は「挑戦の火」を表す炎。
// 実行: node scripts/icons.mjs （sharp が必要）
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "public", "icons");
await mkdir(out, { recursive: true });

// 外炎：左右非対称にゆらいだ雫形。内炎：芯の明るい小さな炎
const OUTER =
  "M512 262 C 548 338, 648 404, 660 520 C 674 650, 600 760, 512 760 C 418 760, 352 684, 360 588 " +
  "C 366 514, 410 470, 438 420 C 458 456, 466 494, 488 512 C 500 438, 482 352, 512 262 Z";
const INNER =
  "M520 520 C 548 562, 590 600, 588 652 C 586 706, 552 736, 512 736 C 470 736, 440 706, 442 664 " +
  "C 444 624, 474 600, 486 566 C 496 586, 504 598, 516 604 C 520 578, 512 548, 520 520 Z";

const svg = (pad = 0) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffdf8"/><stop offset="1" stop-color="#fff3e2"/>
    </linearGradient>
    <radialGradient id="b1" cx="0.2" cy="0.18" r="0.6">
      <stop offset="0" stop-color="#ffb46b" stop-opacity=".85"/><stop offset="1" stop-color="#ffb46b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="b2" cx="0.86" cy="0.88" r="0.6">
      <stop offset="0" stop-color="#ffd86a" stop-opacity=".8"/><stop offset="1" stop-color="#ffd86a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".94"/><stop offset="1" stop-color="#fffaf5" stop-opacity=".6"/>
    </linearGradient>
    <linearGradient id="flame" x1="0.3" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#ffb43f"/><stop offset=".55" stop-color="#ff7a32"/><stop offset="1" stop-color="#f2453d"/>
    </linearGradient>
    <linearGradient id="core" x1="0.5" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#fff3c4"/><stop offset="1" stop-color="#ffc35a"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="22"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect width="1024" height="1024" fill="url(#b1)"/>
  <rect width="1024" height="1024" fill="url(#b2)"/>
  <g transform="translate(${pad} ${pad}) scale(${(1024 - pad * 2) / 1024})">
    <rect x="212" y="212" width="600" height="600" rx="170" fill="url(#glass)" stroke="#ffffff" stroke-width="10"/>
    <g transform="translate(512 512) scale(0.82) translate(-512 -512)">
      <path d="${OUTER}" fill="#ff8a3d" opacity=".45" filter="url(#glow)"/>
      <path d="${OUTER}" fill="url(#flame)"/>
      <path d="${INNER}" fill="url(#core)"/>
    </g>
  </g>
</svg>`;

// 既存の manifest / index.html が参照しているファイル名に合わせて出力する
const targets = [
  ["apple-touch-icon.png", 180, 0],
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["icon-maskable-512.png", 512, 90],
];
for (const [name, size, pad] of targets) {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile(join(out, name));
}
await writeFile(join(out, "icon.svg"), svg(0).trim());
console.log("icons generated");

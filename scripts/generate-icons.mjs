// 用本机 Chrome 把 SVG 图标渲染成 PWA 需要的 PNG（iOS/Android 加主屏要 PNG）
// 用法: node scripts/generate-icons.mjs  [--escalate]（沙箱下需要提权，因为要启动 Chrome）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'web', 'public', 'icons');
const svg = fs.readFileSync(path.join(ICON_DIR, 'icon.svg'), 'utf8');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sizes = [192, 512, 180]; // 180 是 apple-touch-icon

const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  headless: true,
  args: ['--no-sandbox', '--remote-debugging-port=0'],
});

for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style></head><body>${svg}</body></html>`,
  );
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await page.screenshot({ path: path.join(ICON_DIR, name), omitBackground: true });
  await page.close();
  console.log(`✅ ${name} (${size}×${size})`);
}

await browser.close();
console.log(`输出目录: ${ICON_DIR}`);

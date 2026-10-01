// 线上部署端到端检查：用真实 Chrome 打开一个**已经部署好的**地址，
// 确认"第一次访问的人"能正常拿到数据 —— 这是唯一能发现"静态托管回落成 200 HTML"这类
// 只在部署环境才出现的问题的方法（本地 server 永远返回正确的 404，测不出来）。
//
// 用法:
//   node tests/check-live.mjs                                  # 默认查 Cloudflare Pages 地址
//   node tests/check-live.mjs https://xxx.github.io/places-choice/
//   EXPECT_PLACES=25820 node tests/check-live.mjs <url>
//
// 退出码 0 = 通过；1 = 有问题（逐条打印）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = (process.argv[2] ?? process.env.WEB_URL ?? 'https://places-choice.pages.dev/').replace(/\/?$/, '/');
const EXPECT_PLACES = Number(process.env.EXPECT_PLACES ?? 25820);

const problems = [];
const fail = (m) => problems.push(m);
const ok = (m) => console.log(`  ✅ ${m}`);

console.log(`[live] 目标: ${TARGET}`);
console.log(`[live] 期望地点数: ${EXPECT_PLACES}\n`);

/* ---------- 1) 后端探测接口必须 404 ---------- */
// 前端就是靠这个判断"没有后端"的。若返回 200（例如静态托管把未命中路径回落成 index.html），
// 前端会静默误判成"在线"并拿不到数据。
{
  const res = await fetch(`${TARGET}api/dataset`, { redirect: 'manual' }).catch((e) => ({ status: 0, err: e }));
  const status = res.status;
  const ct = res.headers?.get?.('content-type') ?? '';
  if (status === 404) ok(`/api/dataset → 404（前端会正确回退到静态快照）`);
  else if (status === 200) fail(`/api/dataset → 200（Content-Type: ${ct}）—— 静态托管把未命中路径回落成了 HTML，前端会误判"在线"且没数据。Cloudflare Pages 的修法是放一个顶层 404.html`);
  else fail(`/api/dataset → ${status}${res.err ? ` (${res.err.message})` : ''}，期望 404`);
}

/* ---------- 2) 静态数据文件必须完整 ---------- */
{
  const res = await fetch(`${TARGET}data/meta.json`).catch(() => null);
  if (!res || !res.ok) {
    fail(`/data/meta.json 取不到（${res ? res.status : '网络错误'}）`);
  } else {
    const meta = await res.json().catch(() => null);
    if (!meta?.placeCount) fail('/data/meta.json 内容不合法');
    else {
      if (meta.placeCount !== EXPECT_PLACES) fail(`快照地点数 ${meta.placeCount} ≠ 期望 ${EXPECT_PLACES}（可能又退化成种子数据）`);
      else ok(`/data/meta.json → ${meta.placeCount} 地点 / ${meta.cityCount} 城 / ${meta.categoryCount} 分类`);
    }
  }
}

/* ---------- 3) 真实浏览器：模拟第一次访问（全新 context，无缓存） ---------- */
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--remote-debugging-port=0'],
});
try {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    viewport: { width: 420, height: 900 }, // 手机尺寸：这才是真实使用场景
  });
  const page = await ctx.newPage();
  const errors = [];
  const apiProbes = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text().slice(0, 200);
    const url = m.location()?.url ?? '';
    // 静态部署没有后端，前端会主动探测 /api/* 并拿到 404/405 —— 这是**设计内的正常行为**
    // （就是靠这个失败来判断"没有后端"），不能算错误。真正的错误（资源 404、JS 异常）才记录。
    if (url.includes('/api/') && /Failed to load resource|status of (404|405)/i.test(text)) {
      apiProbes.push(`${url.replace(TARGET, '/')} → ${text.match(/status of (\d+)/)?.[1] ?? '?'}`);
      return;
    }
    errors.push(`${text}${url ? ` @ ${url.replace(TARGET, '/')}` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 等数据落地：首屏要下 6.5MB 快照并写进 IndexedDB
  await page.locator('canvas.wheel-canvas').first().waitFor({ timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  // 3a) 不能出现"拿不到数据"的错误提示
  if (body.includes('连不上后端')) {
    fail('页面显示了"连不上后端，且本地没有缓存数据"—— 全新访客拿不到数据，部署不可用');
  } else ok('没有出现"连不上后端"错误提示');

  // 3b) 地点数徽标
  const badge = await page.locator('.badge').first().innerText().catch(() => '');
  const mPlaces = badge.match(/(\d+)\s*市\s*·\s*(\d+)\s*个地点/);
  if (!mPlaces) fail(`没读到"X 市 · Y 个地点"徽标（读到的是「${badge.slice(0, 60)}」）`);
  else if (Number(mPlaces[2]) !== EXPECT_PLACES) fail(`界面显示 ${mPlaces[2]} 个地点 ≠ 期望 ${EXPECT_PLACES}`);
  else ok(`界面徽标 → ${mPlaces[1]} 市 · ${mPlaces[2]} 个地点`);

  // 3c) 必须走静态数据（无后端），且不能误判成"在线"
  const modeBadge = (await page.locator('.badge').nth(1).innerText().catch(() => '')).trim();
  if (modeBadge.includes('静态数据')) ok(`数据来源标识 → ${modeBadge}`);
  else if (modeBadge.includes('在线')) fail(`数据来源标识显示「${modeBadge}」，但它其实是静态部署 —— 前端误判成"在线"了`);
  else fail(`数据来源标识异常：「${modeBadge}」`);

  // 3d) 关键控件都在
  for (const [label, sel] of [['转盘 canvas', 'canvas.wheel-canvas'], ['转动按钮', 'button.primary'], ['城市按钮', 'button.chip[data-places]'], ['全选勾选', '.select-all input[type=checkbox]']]) {
    const n = await page.locator(sel).count();
    if (n === 0) fail(`缺少控件：${label}（${sel}）`);
    else ok(`控件存在：${label} ×${n}`);
  }

  // 3e) 真抽一次，证明离线本地引擎可用
  await page.locator('button.primary', { hasText: '开始转动' }).first().click().catch(() => {});
  await page.waitForTimeout(6500);
  const result = await page.locator('.result h3').first().innerText().catch(() => '');
  if (result.trim()) ok(`抽签出结果 → ${result.trim()}`);
  else fail('点了"开始转动"但没出结果（本地抽签引擎可能没跑起来）');

  // 3f) 控制台不能有**真**报错（/api/* 的探测失败是静态部署的正常现象，已单独归类）
  if (apiProbes.length) ok(`后端探测（预期失败，证明走静态快照）：${[...new Set(apiProbes)].join('、')}`);
  if (errors.length) fail(`控制台有 ${errors.length} 条真报错：${errors.slice(0, 3).join(' | ')}`);
  else ok('控制台无真报错（资源与 JS 均正常）');

  const shot = path.join(outDir, `live-${new URL(TARGET).hostname.replace(/\./g, '-')}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`  📸 截图: ${path.relative(path.join(__dirname, '..'), shot)}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.error(`\n❌ 线上部署检查失败（${problems.length} 项）：`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log(`\n✅ 线上部署检查通过：${TARGET} 全新访客可正常使用，数据完整，走静态快照`);

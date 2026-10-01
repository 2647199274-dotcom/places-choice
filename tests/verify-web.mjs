// Web 界面验证: 用真实 Chrome 打开转盘页, 截图 + 抓控制台错误 + 走一遍抽签流程
// 覆盖: 选城市抽签 / 随机城市 / 全省随机
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PAGE_URL = process.env.WEB_URL ?? 'http://127.0.0.1:5178/';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--remote-debugging-port=0'],
});
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'zh-CN',
  viewport: { width: 1360, height: 1000 },
});
const page = await ctx.newPage();
const errors = [];
const reqs = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('response', (r) => { if (r.url().includes('/api/')) reqs.push(`${r.status()} ${new URL(r.url()).pathname}`); });

const problems = [];
const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, 'ui-1-initial.png'), fullPage: true });

const initialText = await text();
console.log(`[ui] 首屏: ${initialText.slice(0, 200)}`);
console.log(`[ui] API: ${reqs.join(' | ')}`);

// 元素检查
for (const [label, sel] of Object.entries({
  '城市按钮': 'button.chip[data-places]',
  '转盘canvas': 'canvas.wheel-canvas',
  '指针': '.wheel-pointer',
  '转动按钮': 'button.primary',
})) {
  const n = await page.locator(sel).count();
  console.log(`[ui] ${label} = ${n}`);
  if (n === 0) problems.push(`缺少元素 ${label} (${sel})`);
}
const cityCount = await page.locator('button.chip[data-places]').count();
if (cityCount < 5) problems.push(`城市按钮只有 ${cityCount} 个，浙江 11 市应全部列出`);
const emptyChips = await page.locator('button.chip.empty').count();
console.log(`[ui] 城市数 = ${cityCount}，灰显(该城市无数据)项目 = ${emptyChips}`);

// ---- 场景 1: 指定城市 + 人工选项目 ----
await page.locator('button.chip[data-places]', { hasText: '宁波市' }).first().click();
await page.locator('button.chip', { hasText: '景区' }).first().click();
await page.locator('button.primary', { hasText: '开始转动' }).first().click();
await page.waitForTimeout(6200);
let body = await text();
let city1 = (body.match(/候?选池 (\d+) 家 · 上盘 \d+ 个扇区 · ([^ ]+?)(?= ·| 数|$)/) ?? [])[2] ?? '';
console.log(`\n[场景1 指定城市] ${body.includes('宁波市') ? '宁波' : '?'} → 结果卡: ${(body.match(/🍜|🏞️|🍲|🎤|🀄/) ? '' : '')}${(body.slice(body.indexOf('候选池'), body.indexOf('候选池') + 80))}`);
const place1 = (await page.locator('.result h3').first().innerText().catch(() => '')) || '';
const meta1 = (await page.locator('.result-meta').first().innerText().catch(() => '')) || '';
console.log(`           抽中「${place1}」 → ${meta1}`);
if (!place1) problems.push('场景1 没有抽中结果');
if (!meta1.includes('宁波')) problems.push(`场景1 结果城市不是宁波: ${meta1}`);
await page.screenshot({ path: path.join(outDir, 'ui-2-result-ningbo.png'), fullPage: true });

// ---- 场景 2: 随机城市 ----
await page.locator('.seg button', { hasText: '随机城市' }).first().click();
await page.waitForTimeout(300);
await page.locator('button.primary', { hasText: '开始转动' }).first().click();
await page.waitForTimeout(6200);
const place2 = (await page.locator('.result h3').first().innerText().catch(() => '')) || '';
const meta2 = (await page.locator('.result-meta').first().innerText().catch(() => '')) || '';
console.log(`\n[场景2 随机城市] 抽中「${place2}」 → ${meta2}`);
if (!place2) problems.push('场景2（随机城市）没有抽中结果');

// ---- 场景 3: 全省随机 ----
await page.locator('.seg button', { hasText: '全省随机' }).first().click();
await page.waitForTimeout(300);
await page.locator('button.primary', { hasText: '开始转动' }).first().click();
await page.waitForTimeout(6200);
const place3 = (await page.locator('.result h3').first().innerText().catch(() => '')) || '';
const meta3 = (await page.locator('.result-meta').first().innerText().catch(() => '')) || '';
const stageMeta = (await page.locator('.stage-meta').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
console.log(`\n[场景3 全省随机] 抽中「${place3}」 → ${meta3}`);
console.log(`           盘面信息: ${stageMeta}`);
if (!place3) problems.push('场景3（全省随机）没有抽中结果');
if (!stageMeta.includes('横跨')) problems.push(`场景3 候选池未跨多个城市: ${stageMeta}`);
await page.screenshot({ path: path.join(outDir, 'ui-3-result-province.png'), fullPage: true });

// ---- 高德链接 ----
const link = await page.locator('.result-actions a.primary').first().getAttribute('href').catch(() => null);
const navi = await page.locator('.result-actions a.ghost').first().getAttribute('href').catch(() => null);
console.log(`\n[ui] 高德主链接: ${link}`);
console.log(`[ui] 高德导航链接: ${navi}`);
if (!link || !/^https:\/\/(www\.amap\.com\/place\/|uri\.amap\.com\/)/.test(link)) problems.push(`高德链接异常: ${link}`);
if (!navi || !navi.startsWith('https://uri.amap.com/navigation')) problems.push(`导航链接异常: ${navi}`);

// ---- 场景 4: 断网离线（APK/无后端时的兜底路径） ----
await page.route('**/api/**', (route) => route.abort());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const offlineBody = await text();
const offlineBadge = await page.locator('.badge.warn').first().innerText().catch(() => '');
console.log(`\n[场景4 离线] 徽标: ${offlineBadge || '(未出现离线徽标)'}`);
if (!offlineBadge.includes('离线')) problems.push('断网后未进入离线模式（应显示"离线模式"徽标）');
if (!offlineBody.includes('本地缓存')) console.log('           （提示文案未出现，仅检查功能）');

await page.locator('button.primary', { hasText: '开始转动' }).first().click();
await page.waitForTimeout(6200);
const place4 = (await page.locator('.result h3').first().innerText().catch(() => '')) || '';
const meta4 = (await page.locator('.result-meta').first().innerText().catch(() => '')) || '';
const stage4 = (await page.locator('.stage-meta').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
console.log(`[场景4 离线] 抽中「${place4}」 → ${meta4}`);
console.log(`           盘面信息: ${stage4}`);
if (!place4) problems.push('离线模式下无法抽签（本地引擎未兜住）');
if (!stage4.includes('本地计算')) problems.push(`离线抽签未标注"本地计算": ${stage4}`);
const offlineLink = await page.locator('.result-actions a.primary').first().getAttribute('href').catch(() => null);
console.log(`[场景4 离线] 高德链接: ${offlineLink}`);
if (!offlineLink || !/^https:\/\/(www\.amap\.com\/place\/|uri\.amap\.com\/)/.test(offlineLink)) {
  problems.push(`离线结果卡的高德链接异常: ${offlineLink}`);
}
await page.screenshot({ path: path.join(outDir, 'ui-4-offline.png'), fullPage: true });
await page.unroute('**/api/**');

console.log(`\n[ui] draw 请求: ${reqs.filter((r) => r.includes('draw')).join(' | ')}`);
// 场景4 是故意屏蔽 API 的，浏览器必然报 net::ERR_FAILED，这类"预期内"的网络错误不算问题
const realErrors = errors.filter((e) => !/ERR_FAILED|ERR_ABORTED|Failed to load resource/i.test(e));
console.log(`[ui] 控制台错误: ${realErrors.length ? realErrors.join(' ;; ') : `无（另有 ${errors.length - realErrors.length} 条为离线测试故意屏蔽 API 产生的网络错误）`}`);
if (realErrors.length) problems.push(`控制台有 ${realErrors.length} 个真实错误: ${realErrors[0]}`);

await ctx.close();
await browser.close();

if (problems.length) {
  console.log(`\n❌ 界面校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log(`\n✅ 界面校验通过：指定城市/随机城市/全省随机/断网离线 四条路径均可抽签，结果城市标注正确，高德链接正常`);
console.log(`   截图: ${path.join(outDir, 'ui-1-initial.png')} 等 4 张`);

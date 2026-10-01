// Web 界面验证: 真实 Chrome 打开转盘页, 截图 + 抓控制台错误 + 走一遍抽签流程
// 覆盖: 默认全选 / 去锁定吃饭 / 区域维度筛选 / 随机城市 / 全省随机 / 断网离线
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
  viewport: { width: 1360, height: 1200 },
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

const problems = [];
const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const spin = async () => {
  await page.locator('button.primary', { hasText: '开始转动' }).first().click();
  await page.waitForTimeout(6200);
};
const resultName = () => page.locator('.result h3').first().innerText().catch(() => '');
const resultMeta = () => page.locator('.result-meta').first().innerText().catch(() => '');
const stageMeta = async () => (await page.locator('.stage-meta').first().innerText().catch(() => '')).replace(/\s+/g, ' ');

await page.goto(PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });
// 首屏要拉完整数据集（在线约 12k 地点 / 静态快照 2.8MB）并落盘 IndexedDB，
// 给它足够时间：直接等关键控件出现，而不是死等固定毫秒
await page.locator('.select-all input[type=checkbox]').first().waitFor({ timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(outDir, 'ui-1-initial.png'), fullPage: true });

const initial = await text();
console.log(`[ui] 首屏: ${initial.slice(0, 300)}`);

// ---- 结构检查 ----
const checks = {
  '城市按钮': 'button.chip[data-places]',
  '转盘canvas': 'canvas.wheel-canvas',
  '转动按钮': 'button.primary',
  '区域维度(可折叠)': 'details.area-dim',
  '项目分组(可折叠)': 'details.cat-group',
  '全选勾选': '.select-all input[type=checkbox]',
};
for (const [label, sel] of Object.entries(checks)) {
  const n = await page.locator(sel).count();
  console.log(`[ui] ${label} = ${n}`);
  if (n === 0) problems.push(`缺少元素：${label} (${sel})`);
}

// ---- 1. 默认全选 + 吃饭未被锁定 ----
const selectAllChecked = await page.locator('.select-all input[type=checkbox]').first().isChecked();
const selectedCount = (await page.locator('.select-all .count').first().innerText().catch(() => '')).trim();
console.log(`\n[需求1 默认全选] 全选框勾选=${selectAllChecked}，计数="${selectedCount}"`);
if (!selectAllChecked) problems.push('默认应为全选，但全选框未勾选');
const m = selectedCount.match(/已选\s*(\d+)\/(\d+)/);
if (!m || m[1] !== m[2]) problems.push(`默认全选未生效：${selectedCount}`);

const eatChip = page.locator('details.cat-group button.chip', { hasText: '吃饭' }).first();
const eatLocked = (await eatChip.getAttribute('class'))?.includes('locked');
console.log(`[需求2 吃饭不锁定] 吃饭按钮 class="${await eatChip.getAttribute('class')}"`);
if (eatLocked) problems.push('吃饭仍处于锁定状态（应可取消）');

// 取消吃饭 → 应真的取消掉
await eatChip.click();
await page.waitForTimeout(300);
const afterUncheck = (await page.locator('.select-all .count').first().innerText()).trim();
console.log(`[需求2] 取消吃饭后计数="${afterUncheck}"`);
if (afterUncheck === selectedCount) problems.push('取消吃饭无效（吃饭仍被强制保留）');
// 再勾回来
await eatChip.click();
await page.waitForTimeout(300);

// ---- 2. 区域维度筛选（地铁/地区/商圈/商场 四维） ----
const areaDims = await page.locator('details.area-dim .area-label').allInnerTexts();
console.log(`\n[需求3 区域维度] ${areaDims.join(' / ')}`);
for (const want of ['地铁', '地区', '商圈', '商场']) {
  if (!areaDims.some((d) => d.includes(want))) problems.push(`区域维度缺少「${want}」`);
}

// 选一个地铁站
const metroChips = page.locator('details.area-dim').first().locator('button.chip');
const metroCount = await metroChips.count();
console.log(`[需求3] 地铁选项 ${metroCount} 个（示例：${(await metroChips.first().innerText()).replace(/\s+/g, '')}）`);
if (metroCount === 0) problems.push('地铁维度没有可选区域');
const metroName = (await metroChips.first().innerText()).replace(/\s+/g, '').replace(/\d+$/, '');
await metroChips.first().click();
await page.waitForTimeout(600);
const pickedTags = await page.locator('.area-picked .tag').allInnerTexts();
console.log(`[需求3] 已选区域标签：${pickedTags.map((s) => s.trim()).join(' | ')}`);
if (pickedTags.length === 0) problems.push('选中区域后未出现已选标签');

// 再选一个地区（拱墅区/上城区等）
const districtDimIndex = 1;
const districtChips = page.locator('details.area-dim').nth(districtDimIndex).locator('button.chip');
let districtName = '';
if (await districtChips.count() > 0) {
  await page.locator('details.area-dim').nth(districtDimIndex).locator('summary').click();
  await page.waitForTimeout(200);
  districtName = (await districtChips.first().innerText()).replace(/\s+/g, '').replace(/\d+$/, '');
  await districtChips.first().click();
  await page.waitForTimeout(500);
  console.log(`[需求3] 追加地区筛选：${districtName}`);
}

// ---- 3. 带区域筛选抽签 ----
await spin();
const n1 = await resultName();
const m1 = await resultMeta();
const s1 = await stageMeta();
console.log(`\n[需求3 区域抽签] 抽中「${n1}」 → ${m1}`);
console.log(`           盘面: ${s1}`);
if (!n1) problems.push('带区域筛选时抽签失败');
if (districtName && !m1.includes(districtName)) problems.push(`筛选了${districtName}，但抽中的是 ${m1}`);
await page.screenshot({ path: path.join(outDir, 'ui-2-area-result.png'), fullPage: true });

// ---- 4. 高德链接 ----
const link = await page.locator('.result-actions a.primary').first().getAttribute('href').catch(() => null);
const navi = await page.locator('.result-actions a.ghost').first().getAttribute('href').catch(() => null);
console.log(`\n[ui] 高德链接: ${link}`);
if (!link || !/^https:\/\/(www\.amap\.com\/place\/|uri\.amap\.com\/)/.test(link)) problems.push(`高德链接异常: ${link}`);
if (!navi || !navi.startsWith('https://uri.amap.com/navigation')) problems.push(`导航链接异常: ${navi}`);
if (link && !link.includes('amap.com/place/')) {
  problems.push('抽中的是真实高德数据，但结果卡没给出高德详情页链接（poiid 未生效）');
}

// ---- 5. 随机城市 / 全省随机 ----
await page.locator('.seg button', { hasText: '随机城市' }).first().click();
await page.waitForTimeout(300);
await spin();
const n2 = await resultName();
console.log(`\n[场景 随机城市] 抽中「${n2}」 → ${await resultMeta()}`);
if (!n2) problems.push('随机城市抽签失败');

await page.locator('.seg button', { hasText: '全省随机' }).first().click();
await page.waitForTimeout(300);
await spin();
const n3 = await resultName();
const s3 = await stageMeta();
console.log(`[场景 全省随机] 抽中「${n3}」；盘面: ${s3}`);
if (!n3) problems.push('全省随机抽签失败');
if (!s3.includes('城')) problems.push(`全省随机未跨城市: ${s3}`);

// ---- 6. 断网 / 静态托管（无后端）----
const isStaticHost = PAGE_URL.includes('5180');
// 清掉 Service Worker 与所有本地缓存：SW 会直接返回已缓存资源，IndexedDB 残留数据会让"无后端"场景失去意义
await page.evaluate(async () => {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  localStorage.clear();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('trip-roulette');
    req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
    setTimeout(resolve, 2000);
  });
}).catch(() => {});
// 先正常加载一次（让离线引擎拿到并落盘数据集），再屏蔽 API 重载
await page.route('**/api/**', (route) => route.abort());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(isStaticHost ? 9000 : 4000);
// 确认数据集真的落盘了（IndexedDB），否则"离线可用"就是假的
const persisted = await page.evaluate(async () => {
  const openReq = indexedDB.open('trip-roulette', 1);
  const db = await new Promise((res) => {
    openReq.onsuccess = () => res(openReq.result);
    openReq.onerror = () => res(null);
    setTimeout(() => res(null), 3000);
  });
  if (!db) return { places: -1 };
  return await new Promise((res) => {
    const tx = db.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get('trip-roulette:dataset:v1');
    r.onsuccess = () => res({ places: r.result?.places?.length ?? 0 });
    r.onerror = () => res({ places: -2 });
  });
});
console.log(`\n[持久化] IndexedDB 里的数据集地点数 = ${persisted.places}（>0 才能离线重载后抽签）`);
if (persisted.places <= 0) problems.push(`数据集未持久化到 IndexedDB（places=${persisted.places}），离线重载后会没数据`);
const offlineBadge = await page.locator('.badge.warn').first().innerText().catch(() => '');
const offlineAll = await page.locator('.select-all input[type=checkbox]').first().isChecked().catch(() => false);
const allBadges = await page.locator('.badge').allInnerTexts().catch(() => []);
console.log(`\n[场景 无后端] 徽标="${offlineBadge}"；全部徽标=${JSON.stringify(allBadges)}；默认全选=${offlineAll}`);
if (!offlineBadge.includes('离线') && !offlineBadge.includes('静态')) {
  problems.push(`无后端环境下未进入离线/静态模式（徽标=${JSON.stringify(allBadges)}）`);
}
if (!offlineAll) problems.push('离线/静态模式下默认全选未生效');
await spin();
const n4 = await resultName();
const s4 = await stageMeta();
console.log(`[场景 无后端] 抽中「${n4}」；盘面: ${s4}`);
if (!n4) problems.push('无后端时抽签失败');
if (!s4.includes('本地计算')) problems.push(`应在本地计算: ${s4}`);
const link4 = await page.locator('.result-actions a.primary').first().getAttribute('href').catch(() => null);
console.log(`[场景 无后端] 高德链接: ${link4}`);
if (!link4 || !/^https:\/\/(www\.amap\.com\/place\/|uri\.amap\.com\/)/.test(link4)) problems.push(`无后端时高德链接异常: ${link4}`);
await page.screenshot({ path: path.join(outDir, 'ui-3-offline.png'), fullPage: true });
await page.unroute('**/api/**');

const realErrors = errors.filter((e) => !/ERR_FAILED|ERR_ABORTED|Failed to load resource/i.test(e));
console.log(`\n[ui] 控制台错误: ${realErrors.length ? realErrors.join(' ;; ') : '无'}`);
if (realErrors.length) problems.push(`控制台真实错误: ${realErrors[0]}`);

await ctx.close();
await browser.close();

if (problems.length) {
  console.log(`\n❌ 界面校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log('\n✅ 界面校验通过：默认全选、吃饭可取消、区域四维筛选（含交集）、随机城市/全省随机、断网离线 全部正常');
console.log(`   截图: ${outDir}\\ui-1-initial.png 等 3 张`);

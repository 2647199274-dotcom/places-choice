/**
 * 本地（离线）抽签引擎 vs 后端引擎 一致性验证
 *
 * 做法：在真实浏览器里用**同一个注入的确定性随机源**分别跑前端 localDraw 与后端 draw，
 * 对比扇区列表、落点下标、赢家、候选数。两者必须逐字段一致，
 * 否则"离线时转出来的结果规则和在线不一样"。
 *
 * 用法: node tests/verify-local.mjs   （需要 http://127.0.0.1:5178 正在运行）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { draw } from '../src/core/draw.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.WEB_URL ?? 'http://127.0.0.1:5178/';
const problems = [];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--remote-debugging-port=0', '--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({ locale: 'zh-CN' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(800);

// 数据集直接用后端接口（前端缓存的也是这份）
const dataset = await page.evaluate(async () => (await fetch('/api/dataset')).json());
const hasEngine = await page.evaluate(() => !!window.__tripRoulette);
console.log(`[准备] 数据集：${dataset.places.length} 条地点 / ${dataset.cities.length} 城 / ${dataset.categories.length} 分类`);
console.log(`[准备] 前端本地引擎挂载：${hasEngine ? '已挂载 ✅' : '未挂载 ❌'}`);
if (!hasEngine) problems.push('window.__tripRoulette 未挂载，无法对比前后端引擎');

const LCG = `(function(){let s=SEED>>>0;return function(n){s=(s*1103515245+12345)%2147483648;return Math.floor(s/2147483648*n);};})()`;

async function compare(name, opts) {
  const { categoryIds, cityPool, excludeVisited, minRating, maxCost, segmentCount = 10, seed = 42 } = opts;

  // 前端：本地引擎（注入同一随机源）
  const local = await page.evaluate(
    ({ categoryIds, cityPool, excludeVisited, minRating, maxCost, segmentCount, seed, lcgSource }) => {
      const eng = window.__tripRoulette;
      const rand = eval(lcgSource.replace('SEED', String(seed)));
      const ds = window.__ds;
      return eng.localDraw({
        places: ds.places,
        categories: ds.categories,
        cityPool,
        categoryIds,
        filters: { excludeVisited, minRating, maxCost },
        segmentCount,
        rand,
      });
    },
    { categoryIds, cityPool, excludeVisited, minRating, maxCost, segmentCount, seed, lcgSource: LCG },
  );

  // 后端：同一个随机源
  let s = seed >>> 0;
  const rand = (n) => { s = (s * 1103515245 + 12345) % 2147483648; return Math.floor((s / 2147483648) * n); };
  const serverPlaces = dataset.places.filter((p) => cityPool.includes(p.cityAdcode) || cityPool.includes(p.regionAdcode));
  const server = draw({
    region: { adcode: cityPool[0], name: dataset.cities.find((c) => c.adcode === cityPool[0])?.name ?? '' },
    cityPool,
    categoryIds,
    categories: dataset.categories,
    places: serverPlaces,
    filters: { excludeVisited, minRating, maxCost },
    segmentCount,
    rand,
  });

  if (!local && !server) {
    console.log(`[一致] ${name}：两端都判定无候选 ✅`);
    return;
  }
  if (!local || !server) {
    problems.push(`${name}: 一端有结果另一端没有（local=${!!local}, server=${!!server}）`);
    console.log(`[一致] ${name}：❌ 不一致（local=${!!local}, server=${!!server}）`);
    return;
  }

  const segEq =
    local.segments.length === server.segments.length &&
    local.segments.every((x, i) => x.placeId === server.segments[i].placeId && Math.abs(x.share - server.segments[i].share) < 1e-6);
  const ok =
    segEq &&
    local.winnerIndex === server.winnerIndex &&
    local.place.id === server.place.id &&
    local.candidateCount === server.candidateCount;

  console.log(
    `[一致] ${name}：候选 ${local.candidateCount}/${server.candidateCount}，扇区 ${local.segments.length} 个，` +
      `落点 #${local.winnerIndex}/#${server.winnerIndex}，赢家「${local.place.name}」${ok ? '✅ 逐字段一致' : '❌ 不一致'}`,
  );
  if (!ok) {
    problems.push(`${name}: 前后端引擎结果不一致（扇区一致=${segEq}, 落点 ${local.winnerIndex} vs ${server.winnerIndex}, 赢家 ${local.place.id} vs ${server.place.id}）`);
  }
}

// 把数据集塞进页面，供本地引擎使用
await page.evaluate((ds) => { window.__ds = ds; }, dataset);

const hangzhou = dataset.cities.find((c) => c.name === '杭州市');
const ningbo = dataset.cities.find((c) => c.name === '宁波市');
const allCities = dataset.cities.map((c) => c.adcode);

console.log('');
await compare('杭州 · 吃饭+火锅', { categoryIds: ['eat', 'hotpot'], cityPool: [hangzhou.adcode] });
await compare('宁波 · 景区+爬山', { categoryIds: ['sight', 'hike'], cityPool: [ningbo.adcode] });
await compare('杭州 · 随机 5 个项目', { categoryIds: ['eat', 'ktv', 'bar', 'coffee', 'sight'], cityPool: [hangzhou.adcode] });
await compare('全省随机 · 11 城混抽', { categoryIds: ['eat', 'sight'], cityPool: allCities, segmentCount: 12 });
await compare('杭州 · 人均≤50', { categoryIds: ['eat', 'snack'], cityPool: [hangzhou.adcode], maxCost: 50 });
await compare('杭州 · 评分≥4.5', { categoryIds: ['eat', 'sight'], cityPool: [hangzhou.adcode], minRating: 4.5 });
await compare('不存在的组合（应两端都无候选）', { categoryIds: ['bath'], cityPool: ['999999'] });
await compare('另一随机源 seed=7', { categoryIds: ['eat'], cityPool: [hangzhou.adcode], seed: 7 });
await compare('另一随机源 seed=20261001', { categoryIds: ['eat', 'sight'], cityPool: allCities, seed: 20261001 });

console.log(`\n[控制台错误] ${errors.length ? errors.join(' ;; ') : '无'}`);
if (errors.length) problems.push('页面有运行时错误');

await ctx.close();
await browser.close();

if (problems.length) {
  console.log(`\n❌ 离线引擎一致性校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log('✅ 离线引擎一致性校验通过：同一随机源下，前端本地抽签与后端抽签的扇区/落点/赢家/候选数逐字段一致');

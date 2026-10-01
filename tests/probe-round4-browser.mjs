// 第四轮: 真实浏览器渲染探测 (playwright-core + 本机 Chrome)
// 判断"JS 站点 + WAF"在真实浏览器下是否可拿到数据
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const log = [];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--remote-debugging-port=0'],
});
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  locale: 'zh-CN',
  viewport: { width: 1440, height: 900 },
});

const cases = [
  { name: 'amap_search_hotpot', url: 'https://www.amap.com/search?query=%E7%81%AB%E9%94%85&city=330100', waitFor: '.search-list, .poi-item, [class*=poi]', expect: '高德搜索结果(店名+地址+poiid)' },
  { name: 'ctrip_sight_hz', url: 'https://you.ctrip.com/sight/hangzhou14.html', waitFor: 'body', expect: '携程杭州景点列表' },
  { name: 'mafengwo_jd_hz', url: 'https://www.mafengwo.cn/jd/10210/gonglve.html', waitFor: 'body', expect: '马蜂窝杭州景点' },
  { name: 'dianping_hz_ch10', url: 'https://www.dianping.com/hangzhou/ch10', waitFor: 'body', expect: '大众点评(看是否验证码)' },
  { name: 'xhs_explore', url: 'https://www.xiaohongshu.com/explore', waitFor: 'body', expect: '小红书(看是否要登录)' },
  { name: 'bilibili_search', url: 'https://search.bilibili.com/all?keyword=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F', waitFor: 'body', expect: 'B站搜索(评价内容源)' },
  { name: 'qunar_ticket_hz', url: 'https://piao.qunar.com/ticket/list.htm?keyword=%E6%9D%AD%E5%B7%9E&from=mpl_search_suggest', waitFor: 'body', expect: '去哪儿门票(杭州景点)' },
];

for (const c of cases) {
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/api|service|json|search|poi|list/i.test(u) && !/\.(js|css|png|jpg|webp|gif|svg|woff2?)(\?|$)/i.test(u)) {
      apiCalls.push(`${r.status()} ${u.slice(0, 150)}`);
    }
  });
  let status = null, err = '';
  try {
    const resp = await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = resp ? resp.status() : null;
    try { await page.waitForSelector(c.waitFor, { timeout: 12000 }); } catch { log.push(`       (waitFor 选择器超时: ${c.waitFor})`); }
    await page.waitForTimeout(3500);
  } catch (e) {
    err = `${e.name}: ${e.message}`.slice(0, 160);
  }
  const title = await page.title().catch(() => '');
  const text = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
  const html = await page.content().catch(() => '');
  fs.writeFileSync(path.join(outDir, `r4_${c.name}.html`), html, 'utf8');
  fs.writeFileSync(path.join(outDir, `r4_${c.name}.txt`), text, 'utf8');
  await page.close();

  const clean = text.replace(/\s+/g, ' ').trim();
  const waf = /验证|滑动|滑块|captcha|安全|登录后|请登录|robot|异常/i.test(clean);
  log.push(`[browser] ${status ?? 'ERR'} text=${clean.length}B html=${html.length}B waf/login触发=${waf}  ${c.name}  期望=${c.expect} ${err}`);
  log.push(`  title=${title}`);
  log.push(`  text: ${clean.slice(0, 320)}`);
  const interesting = apiCalls.filter((x) => /search|poi|list|api|service/i.test(x)).slice(0, 12);
  if (interesting.length) log.push(`  xhr:\n    ${interesting.join('\n    ')}`);
}

await ctx.close();
await browser.close();

const report = log.join('\n');
fs.writeFileSync(path.join(outDir, 'r4-report.txt'), report, 'utf8');
console.log(report);

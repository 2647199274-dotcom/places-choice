// 第二轮探测: 挖掘高德真实接口路径 + 验证 HTML 源可解析性 + 公开数据集
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function grab(name, url, headers = {}, opts = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA_PC, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers }, redirect: 'follow', ...opts });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    fs.writeFileSync(path.join(outDir, `r2_${name}.txt`), text, 'utf8');
    return { name, status: res.status, bytes: buf.length, ms: Date.now() - started, ct: res.headers.get('content-type') || '', text, headers: Object.fromEntries(res.headers) };
  } catch (e) {
    return { name, error: `${e.name}: ${e.message}`, ms: Date.now() - started };
  }
}

const log = [];

// 1) 抓高德搜索/首页 HTML，挖出真实 service 路径
const pages = [
  ['amap_home', 'https://www.amap.com/', { Referer: 'https://www.amap.com/' }],
  ['amap_search_html', 'https://www.amap.com/search?query=%E7%81%AB%E9%94%85&city=330100', { Referer: 'https://www.amap.com/' }],
  ['amap_m_search', 'https://m.amap.com/search/mapview/keywords=%E7%81%AB%E9%94%85/city=330100', { 'User-Agent': UA_M }],
];
const htmls = {};
for (const [n, u, h] of pages) {
  const r = await grab(n, u, h);
  htmls[n] = r;
  log.push(`[html] ${r.status ?? 'ERR'} ${r.bytes ?? 0}B ${n} ${r.error || ''}`);
}

// 从 HTML/JS 中挖接口路径
const apiHits = new Set();
for (const [n, r] of Object.entries(htmls)) {
  if (!r.text) continue;
  const re = /["'`(]((?:https?:\/\/[a-z0-9.\-]*amap\.com)?\/[a-zA-Z0-9_\-./]*(?:service|api|rest)[a-zA-Z0-9_\-./]*)["'`)]/g;
  let m;
  while ((m = re.exec(r.text))) apiHits.add(m[1]);
}
log.push(`[mine] ${apiHits.size} 个候选接口路径`);
fs.writeFileSync(path.join(outDir, 'r2_amap_api_paths.txt'), [...apiHits].sort().join('\n'), 'utf8');

// 2) 直接试候选高德接口
const candidates = [
  ['amap_poiInfo_basic', 'https://www.amap.com/service/poiInfo?query_type=TQUERY&pagesize=20&pagenum=1&city=330100&keywords=%E7%81%AB%E9%94%85'],
  ['amap_poiInfo_nocity', 'https://www.amap.com/service/poiInfo?keywords=%E7%81%AB%E9%94%85'],
  ['amap_place_around', 'https://www.amap.com/service/place/around?longitude=120.1551&latitude=30.2741&radius=3000&types=050000'],
  ['amap_ugc_poi', 'https://www.amap.com/detail/get/detail?id=B023B0A6VD'],
  ['amap_m_search_service', 'https://m.amap.com/service/poiInfo?query_type=TQUERY&pagesize=20&pagenum=1&city=330100&keywords=%E7%81%AB%E9%94%85'],
  ['amap_rest_text_nokey2', 'https://restapi.amap.com/v3/place/around?location=120.1551,30.2741&radius=3000&types=050000&key=TESTKEY'],
  ['amap_weather_rest', 'https://restapi.amap.com/v3/weather/weatherInfo?city=330100&key=TESTKEY'],
];
for (const [n, u] of candidates) {
  const r = await grab(n, u, { Referer: 'https://www.amap.com/', 'X-Requested-With': 'XMLHttpRequest' });
  const snip = (r.text || '').replace(/\s+/g, ' ').slice(0, 200);
  log.push(`[api]  ${r.status ?? 'ERR'} ${String(r.bytes ?? 0).padStart(7)}B ${n} :: ${snip}${r.error || ''}`);
}

// 3) HTML 源可解析性: 看返回的是真内容还是验证/跳转页
const htmlSources = [
  ['ctrip_sight_hz', 'https://you.ctrip.com/sight/hangzhou14.html', { Referer: 'https://you.ctrip.com/' }],
  ['ctrip_sight_hz_m', 'https://m.ctrip.com/webapp/you/sight/hangzhou14.html', { 'User-Agent': UA_M }],
  ['mafengwo_jd_hz', 'https://www.mafengwo.cn/jd/10210/gonglve.html', { Referer: 'https://www.mafengwo.cn/' }],
  ['mafengwo_poi_hz', 'https://www.mafengwo.cn/poi/5426103.html', { Referer: 'https://www.mafengwo.cn/' }],
  ['dianping_ch10', 'https://www.dianping.com/hangzhou/ch10', { Referer: 'https://www.dianping.com/' }],
  ['dianping_m', 'https://m.dianping.com/hangzhou/ch10', { 'User-Agent': UA_M }],
  ['meituan_meishi_hz', 'https://hz.meituan.com/meishi/', { Referer: 'https://hz.meituan.com/' }],
  ['qunar_sight_hz', 'https://piao.qunar.com/ticket/list.htm?keyword=%E6%9D%AD%E5%B7%9E&region=&from=mpl_search_suggest', { Referer: 'https://piao.qunar.com/' }],
  ['tuniu_hz', 'https://www.tuniu.com/place/hangzhou/', {}],
  ['ly_hz', 'https://www.ly.com/scenery/List-321.html', { Referer: 'https://www.ly.com/' }],
  ['baidu_map_place_hz', 'https://map.baidu.com/search/%E7%81%AB%E9%94%85/@13350000,3600000,12z?querytype=s&wd=%E7%81%AB%E9%94%85&c=179&tn=B_NORMAL_MAP', { Referer: 'https://map.baidu.com/' }],
  ['bilibili_search_hz_meishi', 'https://search.bilibili.com/all?keyword=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F', { Referer: 'https://www.bilibili.com/' }],
  ['zhihu_search', 'https://www.zhihu.com/search?q=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F&type=content', { 'User-Agent': UA_M }],
  ['douban_group', 'https://www.douban.com/search?q=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F', {}],
  ['github_poi_dataset_search', 'https://api.github.com/search/repositories?q=amap+poi+scraper&sort=stars&per_page=15', { 'User-Agent': 'trip-roulette' }],
  ['github_dataset_hangzhou', 'https://api.github.com/search/repositories?q=%E9%AB%98%E5%BE%B7+POI+%E6%95%B0%E6%8D%AE&sort=stars&per_page=15', { 'User-Agent': 'trip-roulette' }],
  ['nominatim_hz_hotpot', 'https://nominatim.openstreetmap.org/search?q=hotpot+Hangzhou&format=json&limit=10', { 'User-Agent': 'trip-roulette/0.1 (contact: local)' }],
  ['overpass_kfc_hz', 'https://overpass-api.de/api/interpreter', { 'User-Agent': 'trip-roulette/0.1', 'Content-Type': 'application/x-www-form-urlencoded' }, { method: 'POST', body: 'data=' + encodeURIComponent('[out:json][timeout:20];node["amenity"="restaurant"](30.20,120.05,30.35,120.25);out center 5;') }],
];
for (const [n, u, h, o] of htmlSources) {
  const r = await grab(n, u, h, o);
  const body = (r.text || '');
  const markers = {
    waf: /whaleguard|waf|captcha|verify|滑塊|滑块|安全验证|robot/i.test(body),
    gbk: /charset=["']?(gb2312|gbk)/i.test(body),
    json_ok: false,
  };
  if (r.ct && r.ct.includes('json')) { try { JSON.parse(body); markers.json_ok = true; } catch {} }
  log.push(`[html] ${r.status ?? 'ERR'} ${String(r.bytes ?? 0).padStart(7)}B ${n.padEnd(24)} ct=${(r.ct || '').slice(0, 30)} waf=${markers.waf} gbk=${markers.gbk} json=${markers.json_ok} ${r.error || ''}`);
  log.push(`       ${body.replace(/\s+/g, ' ').slice(0, 150)}`);
}

const report = log.join('\n');
fs.writeFileSync(path.join(outDir, 'r2-report.txt'), report, 'utf8');
console.log(report);

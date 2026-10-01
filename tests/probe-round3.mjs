// 第三轮探测:
//  A. 高德链接形态验证 (用户点击后浏览器直接跳高德)
//  B. 官方 REST API 参数/返回结构 (无 key 时验证错误码, 用于确认接口通畅)
//  C. 无 key 的高德数据获取旁路 (搜索引/分享页)
//  D. OSM 替代源重试
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function head(name, url, headers = {}, opts = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA_PC, ...headers }, redirect: 'follow', ...opts });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    fs.writeFileSync(path.join(outDir, `r3_${name}.txt`), text, 'utf8');
    return { name, status: res.status, bytes: buf.length, ct: res.headers.get('content-type') || '', url: res.url, text, headers: res.headers };
  } catch (e) {
    return { name, error: `${e.name}: ${e.message}` };
  }
}

const log = [];

// A. 高德链接形态: 三种都可"点开即到高德"
const links = [
  ['A1 高德网页版POI链接(需poiid)', 'https://www.amap.com/place/B023B0A6VD'],
  ['A2 高德URI-标记点(手机/PC通用,可唤起App)', 'https://uri.amap.com/marker?position=120.1551,30.2741&name=%E8%A5%BF%E6%B9%96&src=mypage&coordinate=gaode&callnative=1'],
  ['A3 高德URI-搜索(最稳,无需poiid)', 'https://uri.amap.com/search?keyword=%E7%81%AB%E9%94%85&city=%E6%9D%AD%E5%B7%9E&view=map&callnative=0'],
  ['A4 高德短链分享(需登录态生成)', 'https://surl.amap.com/'],
  ['A5 高德导航链接', 'https://uri.amap.com/navigation?to=120.1551,30.2741,%E8%A5%BF%E6%B9%96&mode=car&policy=1&src=mypage&coordinate=gaode'],
];
for (const [n, u] of links) {
  const r = await head('link_' + n.slice(0, 2), u, { Referer: 'https://www.amap.com/' });
  log.push(`[link] ${r.status ?? 'ERR'} ${String(r.bytes ?? 0).padStart(7)}B ${n} -> final=${r.url || ''} ${r.error || ''}`);
}

// B. 官方 REST API 接口结构验证 (错误码 10001 = key 无效, 说明接口本身通畅)
const rest = [
  ['B1 关键字搜索 v3/place/text', 'https://restapi.amap.com/v3/place/text?key=INVALID&keywords=%E7%81%AB%E9%94%85&city=%E6%9D%AD%E5%B7%9E&citylimit=true&offset=25&page=1&extensions=all'],
  ['B2 周边搜索 v3/place/around', 'https://restapi.amap.com/v3/place/around?key=INVALID&location=120.1551,30.2741&radius=5000&types=050000&offset=25&page=1&extensions=all'],
  ['B3 关键字搜索 v5/place/text(新版)', 'https://restapi.amap.com/v5/place/text?key=INVALID&keywords=%E7%81%AB%E9%94%85&region=%E6%9D%AD%E5%B7%9E&page_size=25&page_num=1&show_fields=business,photos,rating'],
  ['B4 行政区划 v3/config/district', 'https://restapi.amap.com/v3/config/district?key=INVALID&keywords=%E6%9D%AD%E5%B7%9E&subdistrict=1&extensions=base'],
  ['B5 地理编码 v3/geocode/geo', 'https://restapi.amap.com/v3/geocode/geo?key=INVALID&address=%E8%A5%BF%E6%B9%96&city=%E6%9D%AD%E5%B7%9E'],
];
for (const [n, u] of rest) {
  const r = await head('rest_' + n.slice(0, 2), u);
  log.push(`[rest] ${r.status ?? 'ERR'} ${n} :: ${(r.text || '').replace(/\s+/g, ' ').slice(0, 180)} ${r.error || ''}`);
}

// C. 无 key 旁路: 搜索引擎索引里的高德 POI 页 + 高德分享页
const bypass = [
  ['C1 bing搜索site:amap.com/place 杭州火锅', 'https://www.bing.com/search?q=site%3Aamap.com%2Fplace+%E6%9D%AD%E5%B7%9E+%E7%81%AB%E9%94%85&count=30'],
  ['C2 高德分享页 m.amap.com', 'https://m.amap.com/navi/?dest=120.1551,30.2741&destName=%E8%A5%BF%E6%B9%96'],
  ['C3 高德POI搜索开放页(免key网页)', 'https://ditu.amap.com/search?query=%E7%81%AB%E9%94%85&city=330100'],
  ['C4 高德地点详情API(内部)', 'https://www.amap.com/detail/get/detail?id=B023B0A6VD&_=' + Date.now()],
  ['C5 高德tip搜索API(内部)', 'https://www.amap.com/service/poiInfo?query_type=TQUERY&pagesize=20&pagenum=1&qii=true&cluster_state=5&need_utd=true&utd_sceneid=1000&div=PC1000&addr_poi_merge=true&is_classify=true&zoom=12&city=330100&keywords=%E7%81%AB%E9%94%85&csid=&hlflag=true'],
];
for (const [n, u] of bypass) {
  const r = await head('bypass_' + n.slice(0, 2), u, { Referer: 'https://www.amap.com/', 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/plain, */*' });
  const t = (r.text || '').replace(/\s+/g, ' ');
  const looksJson = /^\s*\{/.test(t);
  log.push(`[bypass] ${r.status ?? 'ERR'} ${String(r.bytes ?? 0).padStart(7)}B json=${looksJson} ${n} :: ${t.slice(0, 160)} ${r.error || ''}`);
  if (/site%3Aamap|bing\.com/.test(u)) {
    const hits = [...t.matchAll(/amap\.com\/place\/([A-Za-z0-9]+)/g)].map((m) => m[1]);
    log.push(`         bing 提取到 poiid: ${JSON.stringify([...new Set(hits)])}`);
  }
}

// D. OSM 替代源重试 (换镜像)
const osm = [
  ['D1 overpass kumi', 'https://overpass.kumi.systems/api/interpreter', { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'trip-roulette/0.1' }, { method: 'POST', body: 'data=' + encodeURIComponent('[out:json][timeout:25];node["amenity"~"restaurant|cafe|bar"](30.20,120.05,30.35,120.25);out center 10;') }],
  ['D2 overpass main GET', 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent('[out:json][timeout:25];node["amenity"="restaurant"](30.20,120.05,30.35,120.25);out center 5;'), { 'User-Agent': 'trip-roulette/0.1' }, {}],
  ['D3 nominatim', 'https://nominatim.openstreetmap.org/search?q=restaurant+Hangzhou&format=json&limit=5', { 'User-Agent': 'trip-roulette/0.1 (local research)' }, {}],
];
for (const [n, u, h, o] of osm) {
  const r = await head('osm_' + n.slice(0, 2), u, h, o);
  const t = (r.text || '').replace(/\s+/g, ' ');
  log.push(`[osm]  ${r.status ?? 'ERR'} ${String(r.bytes ?? 0).padStart(7)}B ${n} :: ${t.slice(0, 200)} ${r.error || ''}`);
}

const report = log.join('\n');
fs.writeFileSync(path.join(outDir, 'r3-report.txt'), report, 'utf8');
console.log(report);

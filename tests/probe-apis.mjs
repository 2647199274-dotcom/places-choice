// 深度探测: 针对 JSON 接口 (含 POST) 的连通性/反爬测试
// 用法: node tests/probe-apis.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const UA_PC =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const targets = [
  {
    name: 'amap_webapi_tquery_get',
    url: 'https://www.amap.com/service/poiInfo?query_type=TQUERY&pagesize=20&pagenum=1&qii=true&cluster_state=5&need_utd=true&utd_sceneid=1000&div=PC1000&addr_poi_merge=true&is_classify=true&zoom=12&city=330100&keywords=%E7%81%AB%E9%94%85',
    headers: { Referer: 'https://www.amap.com/', 'User-Agent': UA_PC },
  },
  {
    name: 'amap_webapi_typing_search',
    url: 'https://www.amap.com/service/typingSearch?query_type=TQUERY&pagesize=20&pagenum=1&qii=true&cluster_state=5&need_utd=true&utd_sceneid=1000&div=PC1000&addr_poi_merge=true&is_classify=true&zoom=12&city=330100&keywords=%E5%92%96%E5%95%A1',
    headers: { Referer: 'https://www.amap.com/', 'User-Agent': UA_PC },
  },
  {
    name: 'amap_rest_nokey',
    url: 'https://restapi.amap.com/v3/place/text?keywords=%E7%81%AB%E9%94%85&city=%E6%9D%AD%E5%B7%9E&offset=5&page=1&key=INVALID_KEY_TEST',
  },
  {
    name: 'amap_uri_marker',
    url: 'https://uri.amap.com/marker?position=120.1551,30.2741&name=test',
    headers: { 'User-Agent': UA_MOBILE },
  },
  {
    name: 'xhs_webapi_search_post',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v1/search/notes',
    method: 'POST',
    headers: {
      'User-Agent': UA_PC,
      'Content-Type': 'application/json',
      Referer: 'https://www.xiaohongshu.com/',
      Origin: 'https://www.xiaohongshu.com',
    },
    body: JSON.stringify({ keyword: '杭州美食', page: 1, page_size: 20, search_id: 'x', sort: 'general' }),
  },
  {
    name: 'xhs_webapi_homefeed_post',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed',
    method: 'POST',
    headers: {
      'User-Agent': UA_PC,
      'Content-Type': 'application/json',
      Referer: 'https://www.xiaohongshu.com/',
      Origin: 'https://www.xiaohongshu.com',
    },
    body: JSON.stringify({ cursor_score: '', num: 20, refresh_type: 1, note_index: 0, category: 'homefeed.fashion_v3' }),
  },
  {
    name: 'dianping_shoplist',
    url: 'https://www.dianping.com/hangzhou/ch10',
    headers: { 'User-Agent': UA_PC, Referer: 'https://www.dianping.com/' },
  },
  {
    name: 'meituan_hz_deal_api',
    url: 'https://apimobile.meituan.com/group/v4/poi/pcsearch/1?uuid=test&userid=-1&limit=32&offset=0&cateId=-1&q=%E7%81%AB%E9%94%85',
    headers: { 'User-Agent': UA_PC, Referer: 'https://hz.meituan.com/' },
  },
  {
    name: 'ctrip_gonglve_poi_api',
    url: 'https://m.ctrip.com/restapi/soa2/18109/json/getAttractionList?head={}&contentType=json',
    method: 'POST',
    headers: { 'User-Agent': UA_PC, 'Content-Type': 'application/json', Referer: 'https://you.ctrip.com/' },
    body: JSON.stringify({ districtId: 14, pageIndex: 1, pageSize: 20 }),
  },
  {
    name: 'mafengwo_poi_api',
    url: 'https://www.mafengwo.cn/ajax/ajax_poi.php?act=getPoiList&mddid=10210&page=1',
    headers: { 'User-Agent': UA_PC, Referer: 'https://www.mafengwo.cn/' },
  },
  {
    name: 'qunar_touch_poi',
    url: 'https://touch.qunar.com/h5/around/aroundList?city=%E6%9D%AD%E5%B7%9E&type=sight',
    headers: { 'User-Agent': UA_MOBILE },
  },
  {
    name: 'bilibili_search',
    url: 'https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=%E6%9D%AD%E5%B7%9E%E7%BE%8E%E9%A3%9F',
    headers: { 'User-Agent': UA_PC, Referer: 'https://www.bilibili.com/' },
  },
  {
    name: 'baidu_map_qt_s',
    url: 'https://map.baidu.com/?qt=s&wd=%E7%81%AB%E9%94%85&c=179&rn=10&ie=utf-8&oue=1&fromproduct=jsapi&res=api',
    headers: { 'User-Agent': UA_PC, Referer: 'https://map.baidu.com/' },
  },
  {
    name: 'openstreetmap_overpass',
    url: 'https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%5Btimeout%3A25%5D%3Bnode%5Bamenity%3Drestaurant%5D%2830.20%2C120.05%2C30.35%2C120.25%29%3Bout%20center%2010%3B',
    headers: { 'User-Agent': 'trip-roulette/0.1 (research)' },
  },
  {
    name: 'wikipedia_zh_hangzhou',
    url: 'https://zh.wikipedia.org/api/rest_v1/page/summary/%E6%9D%AD%E5%B7%9E%E5%B8%82',
    headers: { 'User-Agent': 'trip-roulette/0.1' },
  },
];

async function probe(t) {
  const started = Date.now();
  const rec = { name: t.name, url: t.url, method: t.method || 'GET', status: null, ms: 0, bytes: 0, preview: '', error: '', json: null };
  try {
    const res = await fetch(t.url, {
      method: t.method || 'GET',
      headers: t.headers || {},
      body: t.body,
      redirect: 'follow',
    });
    rec.status = res.status;
    const buf = Buffer.from(await res.arrayBuffer());
    rec.bytes = buf.length;
    rec.ms = Date.now() - started;
    const text = buf.toString('utf8');
    rec.preview = text.replace(/\s+/g, ' ').slice(0, 400);
    const ct = res.headers.get('content-type') || '';
    rec.contentType = ct;
    if (ct.includes('json')) {
      try {
        const parsed = JSON.parse(text);
        rec.json = parsed;
        rec.jsonKeys = Object.keys(parsed).slice(0, 12);
      } catch {}
    }
    fs.writeFileSync(path.join(outDir, `api_${t.name}.txt`), text, 'utf8');
  } catch (e) {
    rec.error = `${e.name}: ${e.message}`;
    rec.ms = Date.now() - started;
  }
  return rec;
}

const results = [];
for (const t of targets) {
  process.stdout.write(`probe -> ${t.name}\n`);
  results.push(await probe(t));
}

for (const r of results) {
  const flag = r.error ? 'ERR ' : String(r.status);
  console.log(`${flag.padEnd(5)} ${String(r.bytes).padStart(7)}B ${String(r.ms).padStart(5)}ms  ${r.name}  ${r.error || ''}`);
  if (r.jsonKeys) console.log(`        jsonKeys=${JSON.stringify(r.jsonKeys)}`);
  if (r.preview) console.log(`        ${r.preview.slice(0, 160)}`);
}

fs.writeFileSync(path.join(outDir, 'probe-apis.json'), JSON.stringify(results, null, 2), 'utf8');
console.log(`\nsaved: ${path.join(outDir, 'probe-apis.json')}`);

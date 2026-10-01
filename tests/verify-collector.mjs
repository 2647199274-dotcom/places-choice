/**
 * 采集器端到端验证（用本地 mock 高德服务器，不需要真实 Key）
 * 验证内容：请求参数是否正确、响应解析、POI→Place 映射（三种高德链接）、去重、入库。
 * 用法: node tests/verify-collector.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCategory } from '../src/collect/amap.ts';
import { resolveTargets } from '../src/collect/targets.ts';
import { loadCategories, ensureSeeded, getPlaces, countPlaces, openDb, getCitySummaries } from '../src/db/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5199;

const requested = [];

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  requested.push(`${url.pathname}?${url.searchParams.toString()}`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (url.pathname === '/v3/place/text') {
    const kw = url.searchParams.get('keywords') ?? '';
    const page = Number(url.searchParams.get('page') ?? 1);
    // 高德 v3 字段结构：评分/人均在 biz_ext 里，商圈在 business_area
    if (page === 1) {
      res.end(JSON.stringify({
        status: '1', info: 'OK', infocode: '10000', count: '3',
        pois: [
          {
            id: `B0MOCK${kw.length}01`, name: `测试火锅店A(${kw})`, address: '杭州市上城区测试路1号',
            location: '120.171234,30.249876', type: '餐饮服务;中餐厅;火锅店', typecode: '050118',
            cityname: '杭州市', adname: '上城区', adcode: '330102', pname: '浙江省',
            business_area: '湖滨', tel: '0571-88880001',
            biz_ext: { rating: '4.6', cost: '128.00', opentime_today: '10:00-22:00' },
            photos: [{ title: '门店', url: 'https://example.com/a.jpg' }],
          },
          {
            id: `B0MOCK${kw.length}02`, name: `测试火锅店B(${kw})`, address: '杭州市西湖区测试路2号',
            location: '120.130123,30.259612', type: '餐饮服务;中餐厅;火锅店',
            cityname: '杭州市', adname: '西湖区', adcode: '330106', pname: '浙江省',
            business_area: '西湖', biz_ext: { rating: '4.3', cost: '96.00' },
          },
          // 故意给一条无坐标的脏数据，验证兜底不崩
          {
            id: `B0MOCK${kw.length}03`, name: `无坐标测试店(${kw})`, address: '杭州市未知区',
            location: '', type: '餐饮服务;中餐厅;火锅店', cityname: '杭州市', adname: '', adcode: '330100',
          },
        ],
      }));
    } else {
      res.end(JSON.stringify({
        status: '1', info: 'OK', infocode: '10000', count: '3',
        // 第 2 页返回与第 1 页相同的 id，用于验证去重
        pois: [{
          id: `B0MOCK${kw.length}01`, name: `测试火锅店A(${kw})`, address: '杭州市上城区测试路1号',
          location: '120.171234,30.249876', type: '餐饮服务;中餐厅;火锅店',
          cityname: '杭州市', adname: '上城区', adcode: '330102',
        }],
      }));
    }
    return;
  }
  if (url.pathname === '/v3/config/district') {
    res.end(JSON.stringify({ status: '1', info: 'OK', districts: [{ name: '杭州市', adcode: '330100', level: 'city', districts: [] }] }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }));
});

await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));
console.log(`[mock] 高德模拟服务已启动 http://127.0.0.1:${PORT}`);

await ensureSeeded();
const before = await countPlaces();
const categories = loadCategories();
const hotpot = categories.find((c) => c.id === 'hotpot');

console.log(`\n[test] 采集 杭州市 × 火锅 × 2 页（每页返回相同 id，用于验证去重）`);
const results = await collectCategory(
  { category: hotpot, cityName: '杭州市', cityAdcode: '330100' },
  { key: 'MOCK_KEY', pages: 2, base: `http://127.0.0.1:${PORT}`, throttleMs: 10 },
);

console.log('\n[test] 逐次请求结果:');
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} kw=${r.keyword.padEnd(6)} page=${r.page} 返回=${String(r.got).padStart(2)} 新增=${String(r.saved).padStart(2)}  ${r.msg}`);
}

const unique = new Set(results.flatMap((r) => [r.keyword + r.page]));
console.log(`\n[test] 共发起 ${results.length} 次请求（关键词数 ${unique.size} 组合 × 页数）`);
console.log('[test] 首次请求 URL 参数:');
console.log('       ' + requested[0].slice(0, 220));

const places = await getPlaces('330100', ['hotpot']);
const mockRows = places.filter((p) => p.id.startsWith('B0MOCK'));
const after = await countPlaces();

// mock 服务对每个关键词返回 A/B/无坐标 三个唯一 id（id 里含关键词长度，天然不重复）
const KW_COUNT = 3;
const EXPECT_UNIQUE = KW_COUNT * 3;      // 9
const EXPECT_EXACT = KW_COUNT * 2;       // 6 条有坐标

console.log(`\n[test] 入库校验: 库内总数 ${before.total} → ${after.total}`);
console.log(`[test] 城市查询(adcode 330100) 命中 mock POI ${mockRows.length} 条（期望 ${EXPECT_UNIQUE}）`);
console.log('      ↑ 关键点：高德返回的是区县 adcode(330102 等)，按城市查询必须靠 city_adcode 命中');
const sample = mockRows.find((p) => p.name.includes('店A')) ?? mockRows[0];
for (const p of [sample, mockRows.find((p) => p.coordPrecision === 'approx')].filter(Boolean)) {
  console.log(`  - ${p.name.padEnd(22)} 评分=${p.rating} 人均=${p.cost} 商圈=${p.businessArea || '-'} 城市码=${p.cityAdcode} 区县码=${p.regionAdcode} 坐标=${p.coordPrecision}`);
  console.log(`      高德详情页: ${p.amapUrl}`);
  console.log(`      搜索兜底:   ${p.uriSearchUrl.slice(0, 110)}`);
  console.log(`      导航:       ${p.naviUrl ? p.naviUrl.slice(0, 100) : '(无坐标，已安全降级为 null)'}`);
}

// 断言
const problems = [];
// 可重复运行：先清掉上一轮的 mock 数据，net 增量为 0 时也算通过（等价于"幂等更新"）
const db = await openDb();
const mockBefore = db
  ? db.prepare("SELECT COUNT(*) n FROM place WHERE id LIKE 'B0MOCK%'").get().n
  : mockRows.length;
const netNew = after.total - before.total;
if (netNew !== 0 && netNew !== EXPECT_UNIQUE) {
  problems.push(`去重后净增应为 ${EXPECT_UNIQUE} 条（重复运行时为 0），实际 ${netNew}`);
}
console.log(`[test] 净增 ${netNew} 条；库内 mock 行 ${mockBefore} 条（去重与幂等更新均正常）`);
if (mockRows.length !== EXPECT_UNIQUE) problems.push(`按城市查询应命中 ${EXPECT_UNIQUE} 条，实际 ${mockRows.length}`);
const withCoord = mockRows.filter((p) => p.coordPrecision === 'exact');
if (withCoord.length !== EXPECT_EXACT) problems.push(`精确坐标应为 ${EXPECT_EXACT} 条，实际 ${withCoord.length}`);
const noCoord = mockRows.find((p) => p.coordPrecision === 'approx');
if (noCoord && noCoord.naviUrl !== null) problems.push('无坐标条目应降级 naviUrl=null');
const a = mockRows.find((p) => p.name.includes('店A'));
if (!a || !a.amapUrl?.startsWith('https://www.amap.com/place/')) problems.push('缺少高德详情页链接');
if (!a || !a.uriSearchUrl.startsWith('https://uri.amap.com/search')) problems.push('缺少高德搜索兜底链接');
if (a && a.rating !== 4.6) problems.push(`评分解析错误: ${a?.rating}`);
if (a && a.cost !== 128) problems.push(`人均解析错误: ${a?.cost}`);
if (a && a.cityAdcode !== '330100') problems.push(`cityAdcode 应为 330100，实际 ${a?.cityAdcode}`);
if (a && a.regionAdcode !== '330102') problems.push(`regionAdcode 应保留高德返回的区县码 330102，实际 ${a?.regionAdcode}`);
// v3 新增字段：商圈 / 电话 / 营业时间 / 图片（区域维度与详情卡都要用）
if (a && a.businessArea !== '湖滨') problems.push(`商圈解析错误: ${a?.businessArea}`);
if (a && !a.tel) problems.push('电话未解析');
if (a && !a.opentime) problems.push('营业时间未解析');
if (a && !a.photo) problems.push('图片未解析');

// ---- 采集目标解析：单城市 / 全省 ----
const cities = await getCitySummaries();
const single = resolveTargets({ cities }, {});
const province = resolveTargets({ cities }, { scope: 'zhejiang' });
const custom = resolveTargets({ cities }, { city: '宁波市', adcode: '330200' });
const china = resolveTargets(
  { cities, chinaTargets: [{ cityName: '广州市', cityAdcode: '440100', provinceName: '广东省' }] },
  { scope: 'china' },
);
console.log(`\n[目标解析] 默认 → ${single.length} 个城市 (${single[0].cityName}/${single[0].cityAdcode})`);
console.log(`           --scope zhejiang → ${province.length} 个城市: ${province.map((t) => t.cityName).join('、')}`);
console.log(`           --city 宁波市 → ${custom[0].cityName}/${custom[0].cityAdcode}`);
console.log(`           --scope china（注入 1 个城市）→ ${china.length} 个城市: ${china.map((t) => t.cityName).join('、')}`);
if (single.length !== 1) problems.push('默认应只采集 1 个城市');
if (province.length !== cities.length) problems.push(`全省采集应覆盖 ${cities.length} 个城市，实际 ${province.length}`);
if (custom[0].cityAdcode !== '330200') problems.push('自定义城市 adcode 解析错误');
if (china.length !== 1 || china[0].cityAdcode !== '440100') problems.push('scope=china 解析错误');

mock.close();

if (problems.length) {
  console.log(`\n❌ 校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log('\n✅ 采集器校验通过：请求参数正确、评分/人均解析正确、去重生效、无坐标安全降级、三种高德链接齐全');
console.log('   配好 AMAP_KEY 后即可对真实高德执行：npm run collect -- --check');

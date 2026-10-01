/**
 * 全国采集框架验证（P6，不需要真实 Key）
 * 覆盖：高德 district 响应归一化（含直辖市特殊层级）、省→市展开、--province 过滤、
 *      全国目标解析、缓存读写、以及"很多城市"时的批量查询不崩。
 * 用法: node tests/verify-china.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDistricts, provincesToTargets, readRegionCache, writeRegionCache, REGION_CACHE } from '../src/collect/districts.ts';
import { resolveTargets } from '../src/collect/targets.ts';
import { getCitySummaries, getPlacesMulti, ensureSeeded } from '../src/db/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const problems = [];

// 备份并临时替换缓存，避免污染真实缓存
const backup = fs.existsSync(REGION_CACHE) ? fs.readFileSync(REGION_CACHE, 'utf8') : null;

// ---- 1. 归一化：直辖市 / 普通省 / 国家级包裹 ----
const rawFixture = [
  {
    name: '中华人民共和国', adcode: '100000', level: 'country',
    districts: [
      { name: '浙江省', adcode: '330000', level: 'province', districts: [
        { name: '杭州市', adcode: '330100', level: 'city', districts: [] },
        { name: '宁波市', adcode: '330200', level: 'city', districts: [] },
      ] },
      { name: '上海市', adcode: '310000', level: 'province', districts: [
        { name: '黄浦区', adcode: '310101', level: 'district', districts: [] },
        { name: '浦东新区', adcode: '310115', level: 'district', districts: [] },
      ] },
      { name: '广东省', adcode: '440000', level: 'province', districts: [
        { name: '广州市', adcode: '440100', level: 'city', districts: [] },
        { name: '深圳市', adcode: '440300', level: 'city', districts: [] },
      ] },
    ],
  },
];

const provinces = normalizeDistricts(rawFixture);
console.log(`[归一化] 省数 = ${provinces.length}`);
for (const p of provinces) console.log(`         ${p.adcode} ${p.name} → ${p.cities.map((c) => c.name).join('、')}`);

if (provinces.length !== 3) problems.push(`应解析出 3 个省，实际 ${provinces.length}`);
const sh = provinces.find((p) => p.name === '上海市');
if (!sh) problems.push('直辖市上海缺失');
else if (sh.cities.length !== 2) problems.push(`直辖市上海应把区当作城市，实际 ${sh.cities.length} 个`);
const gd = provinces.find((p) => p.name === '广东省');
if (!gd || gd.cities.length !== 2) problems.push('广东省城市解析错误');
console.log(`         ↑ 直辖市特殊层级处理：上海市 → 黄浦区/浦东新区（当作城市）✅`);

// ---- 2. 省 → 采集目标 展开 + --province 过滤 ----
const all = provincesToTargets(provinces);
const gdOnly = provincesToTargets(provinces, { provinceFilter: '广东省' });
const limited = provincesToTargets(provinces, { cityLimit: 1 });
console.log(`\n[展开] 全部 → ${all.length} 个城市目标；过滤广东省 → ${gdOnly.length}；每省限 1 城 → ${limited.length}`);
if (all.length !== 6) problems.push(`全国展开应为 6 个城市，实际 ${all.length}`);
if (gdOnly.length !== 2 || gdOnly.some((t) => t.provinceName !== '广东省')) problems.push('--province 过滤失败');
if (limited.length !== 3) problems.push(`每省限 1 城应为 3，实际 ${limited.length}`);
if (!all.every((t) => t.provinceName)) problems.push('采集目标缺少 provinceName');

// ---- 3. resolveTargets 的 china 分支 ----
const chinaTargets = resolveTargets({ cities: [], chinaTargets: all }, { scope: 'china' });
const guangdong = resolveTargets({ cities: [], chinaTargets: all }, { scope: 'china', province: '广东省' });
const capped = resolveTargets({ cities: [], chinaTargets: all }, { scope: 'china', 'city-limit': '4' });
console.log(`\n[scope=china] 全部 ${chinaTargets.length} 城；--province 广东省 ${guangdong.length} 城；--city-limit 4 → ${capped.length} 城`);
if (chinaTargets.length !== 6) problems.push('scope=china 未返回全部城市');
if (guangdong.length !== 2) problems.push('scope=china + --province 过滤失败');
if (capped.length !== 4) problems.push('--city-limit 未生效');

try {
  resolveTargets({ cities: [], chinaTargets: [] }, { scope: 'china' });
  problems.push('无省市列表时应抛出明确错误，但没有');
} catch (e) {
  console.log(`[边界] 无缓存且无 Key → 正确抛出：${e.message.slice(0, 60)}… ✅`);
}

// ---- 4. 缓存读写（含 BOM 容错：PowerShell 写出的 UTF-8 带 BOM 曾让缓存被静默忽略） ----
writeRegionCache(provinces);
const cache = readRegionCache();
console.log(`\n[缓存] 写入并读回 ${cache?.provinces.length} 个省（${path.basename(REGION_CACHE)}）✅`);
if (cache?.provinces.length !== 3) problems.push('缓存读写不一致');

fs.writeFileSync(REGION_CACHE, '\uFEFF' + fs.readFileSync(REGION_CACHE, 'utf8'), 'utf8');
const bomCache = readRegionCache();
console.log(`[缓存] 带 UTF-8 BOM 的文件也能读出 ${bomCache?.provinces.length} 个省 ${bomCache ? '✅' : '❌'}`);
if (!bomCache) problems.push('带 BOM 的缓存文件读取失败（会导致明明有缓存还去请求接口）');

// ---- 5. 真实库 + 大量城市批量查询（模拟全国量级） ----
await ensureSeeded();
const cities = await getCitySummaries();
// 用"很多 adcode"压一下 SQL 占位符：真实全国会有 300+ 城市
const fakeMany = [...cities.map((c) => c.adcode)];
for (let i = 0; i < 300; i++) fakeMany.push(`${String(900000 + i).padStart(6, '0')}`);
const big = await getPlacesMulti(fakeMany, ['eat', 'sight', 'hotpot', 'ktv']);
console.log(`[压力] 用 ${fakeMany.length} 个城市码 + 4 个分类批量查询 → ${big.length} 条（占位符 ${fakeMany.length * 2 + 4} 个）✅`);
if (big.length === 0) problems.push('大规模 adcode 批量查询返回 0，占位符或查询逻辑有问题');

// 恢复真实缓存
if (backup) fs.writeFileSync(REGION_CACHE, backup, 'utf8');
else fs.rmSync(REGION_CACHE, { force: true });

console.log('');
if (problems.length) {
  console.log(`❌ 全国框架校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log('✅ 全国采集框架校验通过：直辖市层级、省→市展开、--province/--city-limit 过滤、缓存读写、300+ 城市批量查询均正确');
console.log('   真实全国采集（Key 到位后）：npm run collect -- --scope china --plan 先看规模，再分批采集');

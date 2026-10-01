/**
 * 按高德官方行政区划校正 city 名称，并把"过于稀疏"的城市标记出来
 *
 * 背景：
 *  - 有 141 条数据散落在 118 个小城市（如"万宁市 1 条""三亚市 1 条"）——
 *    它们**不是脏数据**，而是查询关键词时高德返回的其他城市 POI（真实存在的店），
 *    但城市名当时是用"被查询城市名"写的，所以名字是错的（如新北市的咖啡被记成"杭州市"）。
 *  - 用官方区划表按 city_adcode 反查，把名字校正回来。
 *  - 这些 1 条的城市会让 UI 的城市列表变脏，因此另给出"可展示城市"阈值，
 *    但**数据保留**（用户真选到那个城市时仍然可用）。
 *
 * 用法: node scripts/repair-city-names.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDb, countPlaces } from '../src/db/index.ts';
import { readRegionCache } from '../src/collect/districts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');
const db = await requireDb();

// 1) 建立 city_adcode → 城市名 映射（高德官方区划缓存）
//    注意：区划接口里的名字不都能直接用 —— 直辖市会返回"北京城区"、台湾区划还有撞码现象，
//    所以这里只在"同一个 adcode 只出现一次且不是明显怪名"时才采用。
const nameByCode = new Map();
const dupCodes = new Set();
const looksOdd = (n) => /城区$|^省直辖|自治区直辖|^市辖区$/.test(n);
const cache = readRegionCache();
if (cache) {
  for (const p of cache.provinces) {
    for (const c of p.cities) {
      if (looksOdd(c.name)) continue;
      if (nameByCode.has(c.adcode) && nameByCode.get(c.adcode) !== c.name) {
        dupCodes.add(c.adcode); // 撞码：这个码不可信，宁可不改
        nameByCode.delete(c.adcode);
        continue;
      }
      nameByCode.set(c.adcode, c.name);
    }
  }
  console.log(`来自高德区划缓存：${nameByCode.size} 个可信城市码（抛弃 ${dupCodes.size} 个撞码/怪名）`);
}

// 2) 少量手工校准（直辖市与特别行政区，区划接口给的名字不适合展示）
const MANUAL = {
  110100: '北京市', 120100: '天津市', 310100: '上海市', 500100: '重庆市',
  810100: '香港特别行政区', 820100: '澳门特别行政区',
  469000: '海南省直辖县级行政区',
};
for (const [code, name] of Object.entries(MANUAL)) nameByCode.set(Number(code), name);

// 3) 校正 city 名称
const rows = db.prepare('SELECT id, city, city_adcode FROM place WHERE source = ?').all('amap');
const toFix = [];
const unknown = new Set();
const skipped = new Set();
for (const r of rows) {
  if (dupCodes.has(String(r.city_adcode)) || dupCodes.has(Number(r.city_adcode))) {
    skipped.add(r.city_adcode);
    continue; // 撞码的城市码不可信，保持原样
  }
  const want = nameByCode.get(Number(r.city_adcode)) ?? nameByCode.get(r.city_adcode);
  if (!want) { unknown.add(`${r.city_adcode}|${r.city}`); continue; }
  if (r.city !== want) toFix.push({ id: r.id, from: r.city, to: want });
}
console.log(`\n待校正城市名 ${toFix.length} 条；撞码跳过 ${skipped.size} 个码；无法映射 ${unknown.size} 个`);
for (const u of [...unknown].slice(0, 8)) console.log(`  ? ${u}`);
const samples = [...new Set(toFix.map((r) => `${r.from} → ${r.to}`))].slice(0, 10);
console.log('样例:', samples.join(' | '));

if (dry) {
  console.log('\n[dry] 未做修改。');
  process.exit(0);
}

const upd = db.prepare('UPDATE place SET city = ? WHERE id = ?');
db.transaction(() => { for (const r of toFix) upd.run(r.to, r.id); })();

// 4) 清理"城市码/城市名与实际区县码矛盾"的污染数据
//    案例：高德不认直辖市的 adcode，采"上海"时返回了北京的数据（区县码 1101xx），
//    这些行当时被记成"上海市(310100)"，属于错误数据，直接删除。
const all = db
  .prepare(`SELECT id, name, city, city_adcode, district_adcode FROM place WHERE source = 'amap' AND district_adcode <> ''`)
  .all();
const bad = all.filter((r) => {
  const derived = `${String(r.district_adcode).slice(0, 4)}00`;
  return String(r.city_adcode) !== derived;
});
console.log(`\n发现"城市码与区县码矛盾"的污染行 ${bad.length} 条`);
for (const r of bad.slice(0, 6)) {
  console.log(`  「${r.name}」 记成 ${r.city}(${r.city_adcode})，实际区县 ${r.district_adcode}`);
}
if (bad.length) {
  const del = db.prepare('DELETE FROM place WHERE id = ?');
  db.transaction(() => { for (const r of bad) del.run(r.id); })();
  console.log(`  → 已删除（属于抓错城市的脏数据，重跑对应城市采集即可补回）`);
}

const cities = db.prepare('SELECT city, COUNT(*) n FROM place GROUP BY city ORDER BY n DESC').all();
const after = await countPlaces();
console.log(`\n✅ 校正 ${toFix.length} 条城市名；删除 ${bad.length} 条污染数据；库内 ${after.total} 条 / ${cities.length} 城`);
console.log(`   数据 ≥5 条的城市：${cities.filter((c) => c.n >= 5).length} 个（建议 UI 只列这些）`);
console.log(`   数据 <5 条的城市：${cities.filter((c) => c.n < 5).length} 个（数据保留，UI 默认不展示）`);
console.log(`   Top12: ${cities.slice(0, 12).map((c) => `${c.city}:${c.n}`).join(' ')}`);

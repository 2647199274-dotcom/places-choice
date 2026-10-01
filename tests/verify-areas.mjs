/**
 * 区域维度（地铁/地区/商圈/商场）验证 —— 后端筛选用例
 * 用法: node tests/verify-areas.mjs
 */
import { ensureSeeded, getPlacesMulti, getCitySummaries, openDb } from '../src/db/index.ts';
import { listAreas, filterPlacesByAreas, buildMetroLinks, getMetroStations } from '../src/core/areas.ts';

const problems = [];
await ensureSeeded();
const cities = await getCitySummaries();
const hz = cities.find((c) => c.name === '杭州市');
if (!hz) {
  console.log('❌ 库里没有杭州市数据');
  process.exit(1);
}

const db = await openDb();
const allHz = await getPlacesMulti([hz.adcode], [
  'eat', 'hotpot', 'bbq', 'japan', 'westfood', 'snack', 'dessert', 'coffee', 'tea', 'bar', 'ktv',
  'mahjong', 'escape', 'movie', 'arcade', 'sight', 'hike', 'camp', 'museum', 'temple', 'mall',
  'bookstore', 'spa', 'bath', 'livehouse', 'park', 'nightmarket',
]);
console.log(`[数据] 杭州共 ${allHz.length} 条候选（含真实高德数据）`);

// ---- 1. 四个维度都能聚合出选项 ----
const dims = ['district', 'businessArea', 'mall', 'metro'];
const lists = {};
for (const d of dims) {
  lists[d] = await listAreas(hz.adcode, d);
  const top = lists[d].slice(0, 5).map((a) => `${a.name}(${a.placeCount})`).join(' ');
  console.log(`[维度] ${d.padEnd(13)} ${String(lists[d].length).padStart(4)} 个 → ${top}`);
  if (lists[d].length === 0) problems.push(`${d} 维度没有聚合出任何选项`);
}

// ---- 2. 地铁站关联 ----
const linked = await buildMetroLinks(hz.adcode);
const stations = await getMetroStations(hz.adcode);
console.log(`[地铁] 站点 ${stations.length} 个，关联地点 ${linked} 条`);
if (stations.length < 20) problems.push(`杭州地铁站只采到 ${stations.length} 个，偏少`);
if (linked < 100) problems.push(`地铁关联地点只有 ${linked} 条，偏少`);

// ---- 3. 每个维度取一个代表做过滤，验证结果确实落在该区域内 ----
const cases = [
  { dim: 'district', area: lists.district[0], check: (p) => p.district === lists.district[0].name },
  { dim: 'businessArea', area: lists.businessArea[0], check: (p) => p.businessArea === lists.businessArea[0].name },
  {
    dim: 'metro',
    area: lists.metro[0],
    // 地铁按距离关联，用关联表校验
    check: null,
  },
];

console.log('\n[过滤] 逐维度筛选：');
for (const c of cases) {
  const filtered = await filterPlacesByAreas(hz.adcode, [{ dimension: c.dim, key: c.area.key }], []);
  let ok = filtered.length > 0;
  if (c.check) ok = ok && filtered.every(c.check);
  if (c.dim === 'metro') {
    const ids = new Set(db.prepare('SELECT place_id FROM place_metro WHERE station_id = ?').all(c.area.key).map((r) => r.place_id));
    ok = ok && filtered.every((p) => ids.has(p.id));
  }
  console.log(`   ${c.dim.padEnd(13)} 「${c.area.name}」→ ${String(filtered.length).padStart(5)} 条  ${ok ? '✅ 全部落在该区域内' : '❌ 有不属于该区域的结果'}`);
  if (!ok) problems.push(`${c.dim} 过滤结果不正确（${c.area.name}，${filtered.length} 条）`);
}

// ---- 4. 多维取交集：结果必须同时满足所有条件且数量递减 ----
const dTop = lists.district[0];
const bTop = lists.businessArea[0];
const one = await filterPlacesByAreas(hz.adcode, [{ dimension: 'district', key: dTop.key }], []);
const two = await filterPlacesByAreas(
  hz.adcode,
  [{ dimension: 'district', key: dTop.key }, { dimension: 'businessArea', key: bTop.key }],
  [],
);
console.log(`\n[交集] ${dTop.name} 单独 → ${one.length} 条；再 ∩ ${bTop.name} → ${two.length} 条`);
if (two.length > one.length) problems.push('取交集后数量反而变多，交集逻辑有误');
const inBoth = two.every((p) => p.district === dTop.name && p.businessArea === bTop.name);
if (two.length > 0 && !inBoth) problems.push('交集结果里有不满足全部条件的地点');
console.log(`   交集结果全部同时满足两个条件：${two.length === 0 ? '（交集为空，符合预期时也算通过）' : inBoth ? '✅' : '❌'}`);

// ---- 5. 空交集保护 ----
const empty = await filterPlacesByAreas(
  hz.adcode,
  [{ dimension: 'district', key: '330199' }, { dimension: 'businessArea', key: '不存在的商圈' }],
  [],
);
console.log(`[边界] 不存在的区域组合 → ${empty.length} 条 ${empty.length === 0 ? '✅' : '❌'}`);
if (empty.length !== 0) problems.push('不存在的区域应返回空');

// ---- 6. 数据质量：高德真实数据的字段覆盖率 ----
const q = db
  .prepare(
    `SELECT COUNT(*) n,
       SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) r,
       SUM(CASE WHEN cost > 0 THEN 1 ELSE 0 END) c,
       SUM(CASE WHEN business_area <> '' THEN 1 ELSE 0 END) b,
       SUM(CASE WHEN amap_poi_id <> '' THEN 1 ELSE 0 END) i,
       SUM(CASE WHEN coord_precision = 'exact' THEN 1 ELSE 0 END) e
     FROM place WHERE source = 'amap' AND city_adcode = ?`,
  )
  .get(hz.adcode);
const pct = (x) => `${Math.round((x / q.n) * 100)}%`;
console.log(`\n[质量] 高德数据 ${q.n} 条：评分 ${pct(q.r)} · 人均 ${pct(q.c)} · 商圈 ${pct(q.b)} · poiid ${pct(q.i)} · 精确坐标 ${pct(q.e)}`);
if (q.n < 1000) problems.push(`杭州高德数据只有 ${q.n} 条，偏少`);
if (q.i / q.n < 0.95) problems.push('poiid 覆盖率不足 95%，高德详情页链接会缺失');

console.log('');
if (problems.length) {
  console.log(`❌ 区域维度校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log('✅ 区域维度校验通过：四维度聚合、地铁距离关联、单维/多维交集过滤、空交集边界、真实数据字段覆盖均正常');

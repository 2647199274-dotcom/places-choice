import { requireDb, countPlaces, getCitySummaries } from '../src/db/index.ts';

const db = await requireDb();
const counts = await countPlaces();
console.log(`总计 ${counts.total} 条`);
const cities = await getCitySummaries();
console.log('城市分布:', cities.map((c) => `${c.name}:${c.total}`).join(' '));

const bySource = db.prepare('SELECT source, COUNT(*) n FROM place GROUP BY source').all();
console.log('来源:', bySource.map((r) => `${r.source}:${r.n}`).join(' '));

// 高德字段覆盖率
const q = db.prepare(`SELECT COUNT(*) n,
    SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) rating,
    SUM(CASE WHEN cost > 0 THEN 1 ELSE 0 END) cost,
    SUM(CASE WHEN business_area <> '' THEN 1 ELSE 0 END) area,
    SUM(CASE WHEN amap_poi_id <> '' THEN 1 ELSE 0 END) poi,
    SUM(CASE WHEN coord_precision = 'exact' THEN 1 ELSE 0 END) exact
  FROM place WHERE source = 'amap'`).get();
const pct = (x) => `${Math.round((x / q.n) * 100)}%`;
console.log(`\n高德数据 ${q.n} 条覆盖率: 评分 ${pct(q.rating)} · 人均 ${pct(q.cost)} · 商圈 ${pct(q.area)} · poiid ${pct(q.poi)} · 精确坐标 ${pct(q.exact)}`);

// 种子 vs 高德 近似重复检测（同名或同名+同区县）
const seed = db.prepare("SELECT id, name, city, district FROM place WHERE source='seed'").all();
const amap = db.prepare("SELECT id, name, city, district FROM place WHERE source='amap'").all();
const key = (p) => `${p.city}|${String(p.name).replace(/\(.*?\)/g, '').trim()}`;
const amapKeys = new Set(amap.map(key));
const dupExact = seed.filter((p) => amapKeys.has(key(p)));
const amapNames = new Set(amap.map((p) => String(p.name).replace(/\(.*?\)/g, '').trim()));
const dupLoose = seed.filter((p) => amapNames.has(String(p.name).replace(/\(.*?\)/g, '').trim()));

console.log(`\n种子 ${seed.length} 条；与高德"同城同名"重复 ${dupExact.length} 条（跨城同名 ${dupLoose.length - dupExact.length} 条）`);
console.log('重复样例:', dupExact.slice(0, 8).map((p) => `${p.city}/${p.name}`).join(' | '));

// 每个城市各来源数量
const perCity = db.prepare(`SELECT city, source, COUNT(*) n FROM place GROUP BY city, source ORDER BY city`).all();
console.log('\n每城来源分布:');
let cur = '';
for (const r of perCity) {
  if (r.city !== cur) { cur = r.city; process.stdout.write(`  ${cur}: `); }
  process.stdout.write(`${r.source}=${r.n}  `);
  if (perCity.indexOf(r) === perCity.length - 1) process.stdout.write('\n');
}
console.log('');

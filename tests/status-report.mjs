import { requireDb, countPlaces, getCitySummaries } from '../src/db/index.ts';

const c = await countPlaces();
const db = await requireDb();
const src = db.prepare('SELECT source, COUNT(*) n FROM place GROUP BY source').all();
console.log('地点总数:', c.total, '|', src.map((r) => `${r.source}:${r.n}`).join(' '));

const cs = await getCitySummaries();
const provs = new Map();
for (const x of cs) provs.set(x.province, (provs.get(x.province) ?? 0) + 1);
console.log('可选城市:', cs.length, '| 省份:', provs.size);
console.log('省份分布:', [...provs.entries()].map(([k, v]) => `${k}(${v})`).join(' '));

const q = db
  .prepare(
    `SELECT COUNT(*) n,
       SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) r,
       SUM(CASE WHEN cost > 0 THEN 1 ELSE 0 END) c,
       SUM(CASE WHEN business_area <> '' THEN 1 ELSE 0 END) b,
       SUM(CASE WHEN amap_poi_id <> '' THEN 1 ELSE 0 END) p,
       SUM(CASE WHEN coord_precision = 'exact' THEN 1 ELSE 0 END) e
     FROM place WHERE source = 'amap'`,
  )
  .get();
const pct = (x) => `${Math.round((x / q.n) * 100)}%`;
console.log(`高德数据 ${q.n}: 评分 ${pct(q.r)} 人均 ${pct(q.c)} 商圈 ${pct(q.b)} poiid ${pct(q.p)} 精确坐标 ${pct(q.e)}`);

console.log('采集日志:', db.prepare('SELECT COUNT(*) n FROM collect_log').get().n, '条');
console.log('地铁关联:', db.prepare('SELECT COUNT(*) n FROM place_metro').get().n, '条');
console.log('抽签历史:', db.prepare('SELECT COUNT(*) n FROM draw_history').get().n, '条');
console.log('去重标记 seed-dup:', db.prepare("SELECT COUNT(*) n FROM place WHERE source='seed-dup'").get().n, '条');

// 前端静态快照
import fs from 'node:fs';
const meta = JSON.parse(fs.readFileSync('web/public/data/meta.json', 'utf8'));
console.log(`\n静态快照: ${meta.cityCount} 城 / ${meta.placeCount} 地点 / ${meta.categoryCount} 分类 / ${(fs.statSync('web/public/data/dataset.json').size / 1024 / 1024).toFixed(1)}MB`);
console.log('快照生成时间:', meta.generatedAt);

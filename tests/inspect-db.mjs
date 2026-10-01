import { requireDb, countPlaces, getCitySummaries } from '../src/db/index.ts';

const db = await requireDb();
const cols = db.prepare('PRAGMA table_info(place)').all().map((c) => c.name);
console.log('place 列:', cols.join(', '));
const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
console.log('索引:', idx.join(', '));

const counts = await countPlaces();
console.log('地点总数:', counts.total);
const cities = await getCitySummaries();
console.log('城市:', cities.map((c) => `${c.name}:${c.total}`).join(' '));

// 高德真实数据质量
const amapRows = db.prepare("SELECT COUNT(*) n FROM place WHERE source = 'amap'").get().n;
console.log(`\n真实高德数据: ${amapRows} 条`);
if (amapRows > 0) {
  const s = db.prepare(`SELECT COUNT(*) n,
      SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END) withRating,
      SUM(CASE WHEN cost > 0 THEN 1 ELSE 0 END) withCost,
      SUM(CASE WHEN business_area <> '' THEN 1 ELSE 0 END) withArea,
      SUM(CASE WHEN amap_poi_id IS NOT NULL AND amap_poi_id <> '' THEN 1 ELSE 0 END) withPoiId,
      SUM(CASE WHEN tel <> '' THEN 1 ELSE 0 END) withTel,
      SUM(CASE WHEN photo <> '' THEN 1 ELSE 0 END) withPhoto,
      SUM(CASE WHEN coord_precision = 'exact' THEN 1 ELSE 0 END) exactCoord
    FROM place WHERE source = 'amap'`).get();
  console.log('  字段覆盖:', JSON.stringify(s, null, 1));
  const samples = db.prepare(`SELECT name, district, business_area, rating, cost, typecode, amap_url FROM place WHERE source='amap' LIMIT 5`).all();
  console.log('  样例:');
  for (const r of samples) console.log(`   - ${r.name} | ${r.district} | 商圈=${r.business_area} | ⭐${r.rating} | ¥${r.cost} | ${r.typecode}`);
  const areas = db.prepare(`SELECT business_area, COUNT(*) n FROM place WHERE source='amap' AND business_area <> '' GROUP BY business_area ORDER BY n DESC LIMIT 10`).all();
  console.log('  商圈 Top10:', areas.map((a) => `${a.business_area}(${a.n})`).join(' '));
}

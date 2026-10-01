/**
 * 导出静态数据集（GitHub Pages 部署用）
 *
 * 为什么需要它：Pages 上只有静态文件，没有后端，前端启动时请求 /api/dataset 会 404。
 * 所以把数据导出成 web/public/data/dataset.json，前端失败时回退读它。
 *
 * 数据来源优先级：
 *   1) 本地 SQLite（含真实高德采集数据）—— 本地跑时用这个
 *   2) data/seed-hangzhou.json（种子数据，已提交进仓库）—— CI/别人 clone 后没有数据库时用这个
 *
 * 用法: node scripts/export-static-dataset.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'web', 'public', 'data');
const OUT_FILE = path.join(OUT_DIR, 'dataset.json');
const META_FILE = path.join(OUT_DIR, 'meta.json');
const SEED_FILE = path.join(ROOT, 'data', 'seed-hangzhou.json');
const CATEGORIES_FILE = path.join(ROOT, 'config', 'categories.json');

/** 与 /api/dataset 保持**完全相同**的结构，前端两条通路共用一份解析逻辑 */
async function fromDatabase() {
  const { ensureSeeded, getCitySummaries, getRegions, getPlacesMulti, loadCategories, openDb } = await import(
    '../src/db/index.ts'
  );
  const db = await openDb();
  if (!db) throw new Error('SQLite 不可用');
  await ensureSeeded();

  const categories = loadCategories();
  const [cities, regions] = await Promise.all([getCitySummaries(), getRegions()]);
  const places = await getPlacesMulti(cities.map((c) => c.adcode), categories.map((c) => c.id));

  const { listAreas } = await import('../src/core/areas.ts');
  const areaDims = ['district', 'businessArea', 'mall', 'metro'];
  const areas = {};
  for (const c of cities) {
    const per = {};
    for (const dim of areaDims) {
      const list = await listAreas(c.adcode, dim);
      if (list.length) per[dim] = list;
    }
    areas[c.adcode] = per;
  }

  const provinceMap = new Map();
  for (const c of cities) {
    const key = c.province || '其他';
    if (!provinceMap.has(key)) provinceMap.set(key, { adcode: `${c.adcode.slice(0, 2)}0000`, name: key, cities: 0, total: 0 });
    const p = provinceMap.get(key);
    p.cities += 1;
    p.total += c.total;
  }

  return {
    source: 'sqlite',
    generatedAt: new Date().toISOString(),
    categories,
    requiredIds: categories.filter((c) => c.required).map((c) => c.id),
    cities,
    provinces: [...provinceMap.values()],
    districts: regions.filter((r) => r.level === 3),
    areas,
    places,
  };
}

/** 没有数据库时（CI / 新 clone）用种子数据拼一份，结构保持一致 */
function fromSeed() {
  if (!fs.existsSync(SEED_FILE)) throw new Error(`既没有数据库也没有种子数据 ${SEED_FILE}`);
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const categories = JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf8')).categories;

  const cities = new Map();
  for (const p of seed.places) {
    const adcode = p.cityAdcode || p.regionAdcode;
    if (!cities.has(adcode)) {
      cities.set(adcode, {
        adcode, name: p.city, province: '浙江省', total: 0, categories: [],
      });
    }
    const c = cities.get(adcode);
    c.total += 1;
    if (!c.categories.includes(p.categoryId)) c.categories.push(p.categoryId);
  }

  return {
    source: 'seed',
    generatedAt: new Date().toISOString(),
    categories,
    requiredIds: categories.filter((c) => c.required).map((c) => c.id),
    cities: [...cities.values()].sort((a, b) => a.adcode.localeCompare(b.adcode)),
    provinces: [{ adcode: '330000', name: '浙江省', cities: cities.size, total: seed.places.length }],
    districts: seed.regions.filter((r) => r.level === 3),
    areas: {}, // 种子数据没有区域维度（地铁/商场），离线时区域筛选会自动跳过
    places: seed.places,
  };
}

let dataset;
try {
  dataset = await fromDatabase();
  console.log('📦 数据来源：本地 SQLite（含真实高德采集数据）');
} catch (e) {
  console.log(`⚠️  数据库不可用（${e.message}），回退种子数据`);
  dataset = fromSeed();
  console.log('📦 数据来源：data/seed-hangzhou.json');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(dataset), 'utf8');

const exact = dataset.places.filter((p) => p.coordPrecision === 'exact').length;
const withPoi = dataset.places.filter((p) => p.amapPoiId).length;
const meta = {
  generatedAt: dataset.generatedAt,
  source: dataset.source,
  placeCount: dataset.places.length,
  cityCount: dataset.cities.length,
  categoryCount: dataset.categories.length,
  exactCoordCount: exact,
  withPoiIdCount: withPoi,
  areaDims: Object.fromEntries(
    Object.entries(dataset.areas).map(([city, dims]) => [city, Object.keys(dims)]),
  ),
};
fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8');

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`✅ 已导出 ${path.relative(ROOT, OUT_FILE)}  ${kb(fs.statSync(OUT_FILE).size)}`);
console.log(`   ${meta.cityCount} 城 / ${meta.placeCount} 地点 / ${meta.categoryCount} 分类`);
console.log(`   精确坐标 ${exact} 条，带高德 poiid ${withPoi} 条`);
console.log(`   区域维度：${Object.entries(meta.areaDims).slice(0, 3).map(([c, d]) => `${c}[${d.join(',')}]`).join(' ')}`);
console.log(`✅ 已导出 ${path.relative(ROOT, META_FILE)}`);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Category, Place, Region } from '../core/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'trip.db');
const SEED_PATH = path.join(DATA_DIR, 'seed-hangzhou.json');
const CATEGORIES_PATH = path.join(ROOT, 'config', 'categories.json');

export interface SeedFile {
  generatedAt: string;
  note: string;
  regions: Region[];
  places: Place[];
}

export function loadCategories(): Category[] {
  const raw = JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf8'));
  return raw.categories as Category[];
}

export function loadSeed(): SeedFile {
  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`缺少种子数据 ${SEED_PATH}，请先运行: node seed/build-seed.mjs`);
  }
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as SeedFile;
}

let _db: any = null;

/** 惰性打开 SQLite；不可用时返回 null，调用方回退到 JSON 数据源 */
export async function openDb(): Promise<any | null> {
  if (_db) return _db;
  try {
    const mod: any = await import('better-sqlite3');
    const Database = mod.default ?? mod;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    migrate(db);
    _db = db;
    return db;
  } catch (e) {
    console.warn(`[db] SQLite 不可用（${(e as Error).message.slice(0, 80)}…），改用 JSON 数据源`);
    return null;
  }
}

function migrate(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS region (
      adcode TEXT PRIMARY KEY, name TEXT NOT NULL, level INTEGER, parent TEXT, parent_name TEXT
    );
    CREATE TABLE IF NOT EXISTS place (
      id TEXT PRIMARY KEY, source TEXT, name TEXT NOT NULL, category_id TEXT NOT NULL,
      city_adcode TEXT, region_adcode TEXT, city TEXT, district TEXT, district_adcode TEXT, address TEXT,
      lng REAL, lat REAL, rating REAL, cost REAL, why TEXT,
      amap_poi_id TEXT, amap_url TEXT, uri_search_url TEXT, marker_url TEXT, navi_url TEXT,
      coord_precision TEXT, fetched_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_place_city_cat ON place(city_adcode, category_id);
    CREATE TABLE IF NOT EXISTS visited (
      place_id TEXT PRIMARY KEY, visited_at TEXT, user_rating REAL, note TEXT
    );
    CREATE TABLE IF NOT EXISTS draw_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, place_id TEXT, category_id TEXT, city TEXT, drawn_at TEXT
    );
    CREATE TABLE IF NOT EXISTS collect_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, city TEXT, category_id TEXT,
      keyword TEXT, page INTEGER, got INTEGER, ran_at TEXT, ok INTEGER, msg TEXT
    );
  `);

  // 轻量迁移：老库补列（city_adcode 用于按城市查询；高德返回的是区县级 adcode）
  const cols = db.prepare('PRAGMA table_info(place)').all().map((c: any) => c.name);
  if (!cols.includes('city_adcode')) {
    db.exec('ALTER TABLE place ADD COLUMN city_adcode TEXT');
    // 老数据回填：区县 adcode 前 4 位 + '00' 即市级 adcode（如 330102 -> 330100）
    db.exec("UPDATE place SET city_adcode = substr(district_adcode, 1, 4) || '00' WHERE city_adcode IS NULL AND district_adcode IS NOT NULL");
  }
}

/**
 * 首次启动时把种子数据灌进库。
 * 注意：不能只判断"库里有数据就跳过" —— 种子数据集会随扩展阶段变大（杭州 → 浙江 11 市），
 * 老库只有杭州时会漏掉新城市。这里按"库中是否存在种子里的每一条"来决定要不要补灌（幂等 UPSERT），
 * 并清理"来源是 seed 但已不在当前种子文件中"的陈旧行（例如 id 生成规则升级后的旧数据），
 * 否则会出现同一家店入库两次（老 id + 新 id）导致转盘上重复出现。
 */
export async function ensureSeeded(): Promise<number> {
  const db = await openDb();
  const seed = loadSeed();
  if (!db) return seed.places.length;

  upsertRegions(seed.regions);
  const existing = new Set(db.prepare('SELECT id FROM place').all().map((r: any) => r.id as string));
  const seedIds = new Set(seed.places.map((p) => p.id));

  // 清理陈旧 seed 行（只删 seed 来源，绝不动 amap/manual 采集数据）
  const staleSeedRows = db
    .prepare("SELECT id FROM place WHERE source = 'seed'")
    .all()
    .map((r: any) => r.id as string)
    .filter((id: string) => !seedIds.has(id));
  if (staleSeedRows.length > 0) {
    const del = db.prepare('DELETE FROM place WHERE id = ?');
    const tx = db.transaction((ids: string[]) => { for (const id of ids) del.run(id); });
    tx(staleSeedRows);
  }

  const missing = seed.places.filter((p) => !existing.has(p.id));
  if (missing.length > 0 || staleSeedRows.length > 0) {
    upsertPlaces(seed.places);
    return missing.length;
  }
  return existing.size;
}

export function upsertRegions(regions: Region[]): number {
  if (!_db) return 0;
  const stmt = _db.prepare(
    `INSERT INTO region (adcode, name, level, parent, parent_name) VALUES (@adcode, @name, @level, @parent, @parentName)
     ON CONFLICT(adcode) DO UPDATE SET name=excluded.name, level=excluded.level, parent=excluded.parent, parent_name=excluded.parent_name`,
  );
  const tx = _db.transaction((rows: Region[]) => { for (const r of rows) stmt.run(r); });
  tx(regions);
  return regions.length;
}

export function upsertPlaces(places: Place[]): number {
  if (!_db) return 0;
  const stmt = _db.prepare(
    `INSERT INTO place (id, source, name, category_id, city_adcode, region_adcode, city, district, district_adcode, address,
                        lng, lat, rating, cost, why, amap_poi_id, amap_url, uri_search_url, marker_url, navi_url,
                        coord_precision, fetched_at)
     VALUES (@id, @source, @name, @categoryId, @cityAdcode, @regionAdcode, @city, @district, @districtAdcode, @address,
             @lng, @lat, @rating, @cost, @why, @amapPoiId, @amapUrl, @uriSearchUrl, @markerUrl, @naviUrl,
             @coordPrecision, @fetchedAt)
     ON CONFLICT(id) DO UPDATE SET
       source=excluded.source, name=excluded.name, category_id=excluded.category_id,
       city_adcode=excluded.city_adcode, region_adcode=excluded.region_adcode, city=excluded.city,
       district=excluded.district, district_adcode=excluded.district_adcode,
       address=excluded.address, lng=excluded.lng, lat=excluded.lat, rating=excluded.rating,
       cost=excluded.cost, why=excluded.why,
       amap_poi_id=COALESCE(excluded.amap_poi_id, place.amap_poi_id),
       amap_url=COALESCE(excluded.amap_url, place.amap_url),
       uri_search_url=excluded.uri_search_url, marker_url=excluded.marker_url, navi_url=excluded.navi_url,
       coord_precision=excluded.coord_precision, fetched_at=excluded.fetched_at`,
  );
  const tx = _db.transaction((rows: Place[]) => {
    for (const r of rows) {
      stmt.run({ ...r, cityAdcode: r.cityAdcode || (r.districtAdcode ? `${r.districtAdcode.slice(0, 4)}00` : '') });
    }
  });
  tx(places);
  return places.length;
}

const ROW_TO_PLACE = (r: any): Place => ({
  id: r.id, source: r.source, name: r.name, categoryId: r.category_id,
  cityAdcode: r.city_adcode ?? '', regionAdcode: r.region_adcode, city: r.city,
  district: r.district, districtAdcode: r.district_adcode,
  address: r.address, lng: r.lng, lat: r.lat, rating: r.rating, cost: r.cost, why: r.why,
  amapPoiId: r.amap_poi_id, amapUrl: r.amap_url, uriSearchUrl: r.uri_search_url,
  markerUrl: r.marker_url, naviUrl: r.navi_url,
  coordPrecision: r.coord_precision, fetchedAt: r.fetched_at,
});

/** 按城市取候选：city_adcode 优先，兼容 region_adcode（老数据/种子数据） */
export async function getPlaces(cityAdcode: string, categoryIds: string[]): Promise<Place[]> {
  if (!cityAdcode || categoryIds.length === 0) return [];
  const db = await openDb();
  if (db) {
    const ph = categoryIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT * FROM place WHERE (city_adcode = ? OR region_adcode = ?) AND category_id IN (${ph})`)
      .all(cityAdcode, cityAdcode, ...categoryIds);
    return rows.map(ROW_TO_PLACE);
  }
  const seed = loadSeed();
  return seed.places.filter(
    (p) => (p.cityAdcode === cityAdcode || p.regionAdcode === cityAdcode) && categoryIds.includes(p.categoryId),
  );
}

/** 跨城市批量取候选（随机城市 / 全省随机 用） */
export async function getPlacesMulti(cityAdcodes: string[], categoryIds: string[]): Promise<Place[]> {
  if (cityAdcodes.length === 0 || categoryIds.length === 0) return [];
  const db = await openDb();
  if (db) {
    // 占位符数量必须精确匹配：city_adcode IN (...) 与 region_adcode IN (...) 各用一份
    const phCity = cityAdcodes.map(() => '?').join(',');
    const phCity2 = cityAdcodes.map(() => '?').join(',');
    const phCat = categoryIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT * FROM place
         WHERE (city_adcode IN (${phCity}) OR region_adcode IN (${phCity2}))
           AND category_id IN (${phCat})`,
      )
      .all(...cityAdcodes, ...cityAdcodes, ...categoryIds);
    return rows.map(ROW_TO_PLACE);
  }
  const seed = loadSeed();
  const citySet = new Set(cityAdcodes);
  return seed.places.filter(
    (p) => (citySet.has(p.cityAdcode) || citySet.has(p.regionAdcode)) && categoryIds.includes(p.categoryId),
  );
}

export async function getRegions(level?: number): Promise<Region[]> {
  const db = await openDb();
  if (db) {
    const rows = level
      ? db.prepare('SELECT * FROM region WHERE level = ?').all(level)
      : db.prepare('SELECT * FROM region').all();
    return rows.map((r: any) => ({ adcode: r.adcode, name: r.name, level: r.level, parent: r.parent, parentName: r.parent_name }));
  }
  const seed = loadSeed();
  return level ? seed.regions.filter((r) => r.level === level) : seed.regions;
}

export async function countPlaces(): Promise<{ total: number; byCategory: Record<string, number>; byCity: Record<string, number> }> {
  const db = await openDb();
  if (db) {
    const byCategory: Record<string, number> = {};
    for (const r of db.prepare('SELECT category_id c, COUNT(*) n FROM place GROUP BY category_id').all()) byCategory[r.c] = r.n;
    const byCity: Record<string, number> = {};
    for (const r of db.prepare('SELECT city c, COUNT(*) n FROM place GROUP BY city').all()) byCity[r.c] = r.n;
    const total = db.prepare('SELECT COUNT(*) n FROM place').get().n as number;
    return { total, byCategory, byCity };
  }
  const seed = loadSeed();
  const byCategory: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  for (const p of seed.places) {
    byCategory[p.categoryId] = (byCategory[p.categoryId] ?? 0) + 1;
    byCity[p.city] = (byCity[p.city] ?? 0) + 1;
  }
  return { total: seed.places.length, byCategory, byCity };
}

export interface CitySummary {
  adcode: string;
  name: string;
  province: string;
  total: number;
  /** 该城市有数据的分类 id 列表（前端用来标注/灰显空项目） */
  categories: string[];
}

const CITY_PREFIX: Record<string, string> = {
  '3301': '浙江省', '3302': '浙江省', '3303': '浙江省', '3304': '浙江省', '3305': '浙江省',
  '3306': '浙江省', '3307': '浙江省', '3308': '浙江省', '3309': '浙江省', '3310': '浙江省', '3311': '浙江省',
};

/** 有数据的城市清单（含每个城市可抽的分类），用于前端地区选择器与"随机城市" */
export async function getCitySummaries(): Promise<CitySummary[]> {
  const db = await openDb();
  if (db) {
    const rows = db
      .prepare(
        `SELECT COALESCE(NULLIF(city_adcode, ''), region_adcode) adcode, city, category_id, COUNT(*) n
         FROM place GROUP BY adcode, category_id`,
      )
      .all();
    const map = new Map<string, CitySummary>();
    for (const r of rows) {
      if (!r.adcode) continue;
      const key = r.adcode;
      if (!map.has(key)) {
        map.set(key, {
          adcode: key, name: r.city, province: CITY_PREFIX[key.slice(0, 4)] ?? '', total: 0, categories: [],
        });
      }
      const c = map.get(key)!;
      c.total += r.n;
      c.categories.push(r.category_id);
    }
    return [...map.values()].sort((a, b) => a.adcode.localeCompare(b.adcode));
  }
  const seed = loadSeed();
  const map = new Map<string, CitySummary>();
  for (const p of seed.places) {
    const key = p.cityAdcode || p.regionAdcode;
    if (!map.has(key)) {
      map.set(key, { adcode: key, name: p.city, province: CITY_PREFIX[key.slice(0, 4)] ?? '', total: 0, categories: [] });
    }
    const c = map.get(key)!;
    c.total += 1;
    if (!c.categories.includes(p.categoryId)) c.categories.push(p.categoryId);
  }
  return [...map.values()].sort((a, b) => a.adcode.localeCompare(b.adcode));
}

/** 打印一行统计（CLI 用） */
export async function summaryLine(): Promise<string> {
  const cities = await getCitySummaries();
  const total = cities.reduce((s, c) => s + c.total, 0);
  return `${cities.length} 个城市 / ${total} 条地点`;
}

export async function getVisitedIds(): Promise<string[]> {
  const db = await openDb();
  if (!db) return [];
  return db.prepare('SELECT place_id FROM visited').all().map((r: any) => r.place_id);
}

export async function getRecentDrawIds(limit = 5): Promise<string[]> {
  const db = await openDb();
  if (!db) return [];
  return db
    .prepare('SELECT place_id FROM draw_history ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((r: any) => r.place_id);
}

export async function recordDraw(place: Place, categoryIds: string[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  db.prepare('INSERT INTO draw_history (place_id, category_id, city, drawn_at) VALUES (?, ?, ?, ?)')
    .run(place.id, categoryIds.join(','), place.city, new Date().toISOString());
}

export async function markVisited(placeId: string, note?: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  db.prepare(
    `INSERT INTO visited (place_id, visited_at, note) VALUES (?, ?, ?)
     ON CONFLICT(place_id) DO UPDATE SET visited_at=excluded.visited_at, note=excluded.note`,
  ).run(placeId, new Date().toISOString(), note ?? '');
}

export async function logCollect(row: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  db.prepare(
    `INSERT INTO collect_log (source, city, category_id, keyword, page, got, ran_at, ok, msg)
     VALUES (@source, @city, @categoryId, @keyword, @page, @got, @ranAt, @ok, @msg)`,
  ).run(row);
}

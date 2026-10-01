/**
 * 区域维度（模仿美团：按 地铁 / 地区 / 商场 / 商圈 选）
 *
 * 数据来源：
 *  - 地区（区县）：直接来自 place.district / district_adcode
 *  - 商圈（business_area）：高德 POI 自带的商圈名，如「杭州新天地」
 *  - 商场：高德 typecode 0601xx（购物服务;商场），采集时按该类型单独入库
 *  - 地铁站：高德 typecode 150500，采集后按 1.2 公里半径把地点归属到最近地铁站
 *
 * 关联关系存在两张表：metro_station（站点）与 place_metro（地点↔站点，一次计算后复用）。
 */
import { openDb, requireDb, ROW_TO_PLACE } from '../db/index.ts';
import type { AreaDimension, AreaOption, Place } from '../core/types.ts';

export const METRO_TYPECODE_PREFIX = '1505';
export const MALL_TYPECODE_PREFIX = '0601';
/** 地点归属到地铁站的最大距离（米）——超过就算"不在地铁附近" */
export const METRO_RADIUS_M = 1200;

const R = 6371000;

/** 归一化区域名：去掉"B区/C1区/2期/3号楼"这类后缀，让同一商场的多条 POI 合成一项 */
export function normalizeAreaName(raw: string): string {
  return String(raw)
    .replace(/\([^)]*\)/g, '')                       // 括号内容：「杭州湖滨in77(A区)」
    .replace(/[A-Za-z]?\d*\s*(区|期|座|馆|号楼|栋|幢|层|F)\s*$/i, '')
    .replace(/(购物中心|广场|商场|百货|店)$/u, (m) => m)  // 保留业态词，避免过度合并
    .trim() || String(raw);
}

export function distanceMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface MetroStation {
  id: string;
  name: string;
  lng: number;
  lat: number;
  district: string;
}

/** 从库里取某城市的全部地铁站 */
export async function getMetroStations(cityAdcode: string): Promise<MetroStation[]> {
  const db = await openDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT id, name, lng, lat, district FROM place
       WHERE city_adcode = ? AND substr(typecode, 1, 4) = ? AND lng <> 0`,
    )
    .all(cityAdcode, METRO_TYPECODE_PREFIX);
  return rows.map((r: any) => ({ id: r.id, name: r.name, lng: r.lng, lat: r.lat, district: r.district }));
}

/** 为某城市建立"地点 → 最近地铁站"的关联（幂等，可重复调用） */
export async function buildMetroLinks(cityAdcode: string): Promise<number> {
  const db = await requireDb();
  const stations = await getMetroStations(cityAdcode);
  if (stations.length === 0) return 0;

  const places = db
    .prepare(
      `SELECT id, lng, lat FROM place
       WHERE city_adcode = ? AND lng <> 0
         AND substr(COALESCE(typecode, ''), 1, 4) <> ?`,
    )
    .all(cityAdcode, METRO_TYPECODE_PREFIX) as { id: string; lng: number; lat: number }[];

  const stmt = db.prepare(
    `INSERT INTO place_metro (place_id, station_id, station_name, distance_m) VALUES (?, ?, ?, ?)
     ON CONFLICT(place_id) DO UPDATE SET station_id=excluded.station_id, station_name=excluded.station_name, distance_m=excluded.distance_m`,
  );
  let linked = 0;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM place_metro WHERE place_id IN (SELECT id FROM place WHERE city_adcode = ?)').run(cityAdcode);
    for (const p of places) {
      let best: { s: MetroStation; d: number } | null = null;
      for (const s of stations) {
        const d = distanceMeters(p.lng, p.lat, s.lng, s.lat);
        if (d <= METRO_RADIUS_M && (!best || d < best.d)) best = { s, d };
      }
      if (best) {
        stmt.run(p.id, best.s.id, best.s.name, Math.round(best.d));
        linked++;
      }
    }
  });
  tx();
  return linked;
}

/** 聚合某城市可选的区域（四个维度） */
export async function listAreas(
  cityAdcode: string,
  dimension?: AreaDimension,
  categoryIds?: string[],
): Promise<AreaOption[]> {
  const db = await openDb();
  if (!db) return [];

  const catFilter = categoryIds?.length ? ` AND category_id IN (${categoryIds.map(() => '?').join(',')})` : '';
  const catArgs = categoryIds?.length ? categoryIds : [];
  const out: AreaOption[] = [];

  if (!dimension || dimension === 'district') {
    const rows = db
      .prepare(
        `SELECT district AS name, district_adcode AS key, COUNT(*) n, AVG(lng) lng, AVG(lat) lat
         FROM place WHERE city_adcode = ? AND district <> ''${catFilter}
         GROUP BY district ORDER BY n DESC`,
      )
      .all(cityAdcode, ...catArgs);
    for (const r of rows as any[]) {
      out.push({ key: r.key || r.name, name: r.name, dimension: 'district', placeCount: r.n, lng: r.lng, lat: r.lat });
    }
  }

  if (!dimension || dimension === 'businessArea') {
    const rows = db
      .prepare(
        `SELECT business_area AS name, COUNT(*) n, AVG(lng) lng, AVG(lat) lat
         FROM place WHERE city_adcode = ? AND business_area <> '' AND business_area IS NOT NULL${catFilter}
         GROUP BY business_area ORDER BY n DESC`,
      )
      .all(cityAdcode, ...catArgs);
    for (const r of rows as any[]) {
      out.push({ key: r.name, name: r.name, dimension: 'businessArea', placeCount: r.n, lng: r.lng, lat: r.lat });
    }
  }

  if (!dimension || dimension === 'mall') {
    const rows = db
      .prepare(
        `SELECT id, name, lng, lat, district FROM place
         WHERE city_adcode = ? AND substr(COALESCE(typecode, ''), 1, 4) = ?`,
      )
      .all(cityAdcode, MALL_TYPECODE_PREFIX) as any[];
    // 同一个商场会被高德拆成「杭州湖滨in77 / in77B区 / in77C1区…」多条，
    // 按"归一化名称"合并，避免区域列表里出现一堆同名近义选项
    const merged = new Map<string, AreaOption & { count: number }>();
    for (const m of rows) {
      const display = normalizeAreaName(m.name);
      const cnt = db
        .prepare(
          `SELECT COUNT(*) n FROM place
           WHERE city_adcode = ? AND lng <> 0
             AND ABS(lng - ?) < 0.02 AND ABS(lat - ?) < 0.018${catFilter}`,
        )
        .get(cityAdcode, m.lng, m.lat, ...catArgs);
      const prev = merged.get(display);
      const n = cnt?.n ?? 0;
      if (!prev) {
        merged.set(display, {
          key: m.id, name: display, dimension: 'mall', placeCount: n, lng: m.lng, lat: m.lat, count: 1,
        });
      } else {
        prev.count += 1;
        // 合并时取周边候选最多的那个 poiid 作为代表（过滤时用它定位）
        if (n > prev.placeCount) {
          prev.key = m.id; prev.lng = m.lng; prev.lat = m.lat; prev.placeCount = n;
        }
      }
    }
    for (const v of merged.values()) out.push({ ...v, placeCount: v.placeCount });
    out.sort((a, b) => b.placeCount - a.placeCount);
  }

  if (!dimension || dimension === 'metro') {
    const rows = db
      .prepare(
        `SELECT station_id AS key, station_name AS name, COUNT(*) n, MIN(distance_m) d
         FROM place_metro WHERE station_id IN (SELECT id FROM place WHERE city_adcode = ?)
         GROUP BY station_id ORDER BY n DESC`,
      )
      .all(cityAdcode);
    const stLng = db.prepare('SELECT lng, lat, district FROM place WHERE id = ?');
    for (const r of rows as any[]) {
      const s = stLng.get(r.key) as any;
      out.push({
        key: r.key,
        name: String(r.name).replace(/\(地铁站\)$/, ''),
        dimension: 'metro',
        placeCount: r.n,
        lng: s?.lng,
        lat: s?.lat,
      });
    }
  }

  return out;
}

/** 把多个维度选择取交集，返回过滤后的地点（美团式：地区∩地铁∩商圈∩商场） */
export async function filterPlacesByAreas(
  cityAdcode: string,
  areas: { dimension: AreaDimension; key: string }[],
  categoryIds: string[],
): Promise<Place[]> {
  if (areas.length === 0) return [];
  let result: Place[] | null = null;
  for (const a of areas) {
    const part = await filterPlacesByArea(cityAdcode, a, categoryIds);
    if (result === null) {
      result = part;
    } else {
      const keep = new Set(part.map((p) => p.id));
      result = result.filter((p) => keep.has(p.id));
    }
    if (result.length === 0) break; // 交集已空，不必再算
  }
  return result ?? [];
}

/** 把区域过滤条件翻译成 SQL 条件（供候选池过滤） */
export async function filterPlacesByArea(
  cityAdcode: string,
  area: { dimension: AreaDimension; key: string },
  categoryIds: string[],
): Promise<Place[]> {
  const db = await openDb();
  if (!db) return [];
  const catFilter = categoryIds.length ? ` AND category_id IN (${categoryIds.map(() => '?').join(',')})` : '';
  const catArgs = categoryIds;

  const base = `SELECT * FROM place WHERE city_adcode = ?${catFilter}`;
  const rows = (() => {
    switch (area.dimension) {
      case 'district':
        return db.prepare(`${base} AND (district_adcode = ? OR district = ?)`).all(cityAdcode, ...catArgs, area.key, area.key);
      case 'businessArea':
        return db.prepare(`${base} AND business_area = ?`).all(cityAdcode, ...catArgs, area.key);
      case 'mall': {
        const m = db.prepare('SELECT lng, lat FROM place WHERE id = ?').get(area.key) as any;
        if (!m) return [];
        return db
          .prepare(`${base} AND lng <> 0 AND ABS(lng - ?) < 0.02 AND ABS(lat - ?) < 0.018`)
          .all(cityAdcode, ...catArgs, m.lng, m.lat);
      }
      case 'metro': {
        const ids = db.prepare('SELECT place_id FROM place_metro WHERE station_id = ?').all(area.key).map((r: any) => r.place_id);
        if (ids.length === 0) return [];
        return db
          .prepare(`${base} AND id IN (${ids.map(() => '?').join(',')})`)
          .all(cityAdcode, ...catArgs, ...ids);
      }
      default:
        return [];
    }
  })();
  return rows.map(ROW_TO_PLACE);
}

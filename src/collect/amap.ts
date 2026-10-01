/**
 * 高德开放平台 Web 服务 API 采集器
 * 依据：docs/01-爬取可行性报告.md（接口已实测通畅）+ 真实 Key 实测（见下）
 *
 * 【重要实测结论】用同一关键词「火锅」在杭州查询：
 *   v5/place/text → 只返回 25 条（被截断）
 *   v3/place/text → count=600，可用 offset 分页翻到 900 条上限
 * 所以正式采集走 **v3**，并且按「区县 / 商圈 / 关键词」细分查询来突破单查询上限。
 *
 * v3 返回的关键字段（均已在 biz_ext 里验证有值）：
 *   name / address / location / adname(区县) / adcode / business_area(商圈) / type / typecode
 *   biz_ext.rating（评分，如 "4.9"）/ biz_ext.cost（人均，如 "116.00"）/ tel / photos
 *
 * 合规要点：内置限速（默认 3 QPS）、失败重试、原始响应落盘、增量入库不重复请求。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Category, Place } from '../core/types.ts';
import { upsertPlaces, logCollect, requireDb } from '../db/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
export const RAW_DIR = path.join(ROOT, 'data', 'raw');

export const AMAP_BASE = process.env.AMAP_BASE ?? 'https://restapi.amap.com';

/** v3 实测：只递增 page（offset 固定 0）才能正确翻页，每页最多 10 条，且零重复。
 *  踩过的坑：offset=20 会返回 20 条且前 10 条与第一页重复（offset 被当成"追加条数"而不是起点）。
 *  详见 tests/probe-amap-paging.mjs 的实测输出。 */
export const V3_PAGE_SIZE = 10;
/** v3 分页上限 */
export const V3_MAX_PAGE = 45;

export function getAmapKey(): string | null {
  if (process.env.AMAP_KEY && process.env.AMAP_KEY.trim()) return process.env.AMAP_KEY.trim();
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').match(/^\s*AMAP_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

/** 高德 v3 POI 原始结构 */
export interface AmapPoiV3 {
  id: string;
  name: string;
  address: string | string[];
  location: string;
  type: string;
  typecode?: string;
  pname?: string;
  cityname?: string;
  adname?: string;
  citycode?: string;
  adcode?: string;
  tel?: string | string[];
  /** 商圈名，如「杭州新天地」——用于"按商圈选区域" */
  business_area?: string;
  biz_ext?: { rating?: string; cost?: string; opentime_today?: string; opentime_week?: string };
  photos?: { title?: string; url?: string }[];
  distance?: string;
}

export interface SearchOptions {
  key: string;
  keywords: string;
  region: string; // 城市名或 adcode
  types?: string;
  /** v3: offset = (page-1)*20，这里仍传页码，内部换算 */
  pageNum?: number;
  /** 只保留 adcode 在此列表中的 POI（按区县细分采集时用） */
  adcodeFilter?: string[];
  /** 只保留商圈名匹配的 POI（按商圈细分采集时用） */
  businessAreaFilter?: string[];
  cityLimit?: boolean;
  throttleMs?: number;
  retries?: number;
  base?: string;
  /** 不落盘原始响应（细分采集会产生很多小文件） */
  skipRaw?: boolean;
}

/** 调用高德 v3/place/text（关键字搜索，extensions=all 才有 biz_ext 评分/人均） */
export async function searchPlaces(opts: SearchOptions): Promise<{ pois: AmapPoiV3[]; count: number; raw: unknown }> {
  const {
    key, keywords, region, types, pageNum = 1, adcodeFilter, businessAreaFilter,
    cityLimit = true, throttleMs = 350, retries = 2, base = AMAP_BASE, skipRaw = false,
  } = opts;

  const page = Math.max(1, Math.min(pageNum, V3_MAX_PAGE));
  // v3 分页：page 递增、offset 固定为 0（实测唯一正确的组合）
  const params = new URLSearchParams({
    key, keywords: keywords ?? '', region,
    page: String(page), offset: '0', citylimit: String(cityLimit), extensions: 'all',
  });
  if (types) params.set('types', types);
  const url = `${base}/v3/place/text?${params.toString()}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(throttleMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'trip-roulette/0.1 (personal use)' } });
      const json = (await res.json()) as { status?: string; info?: string; infocode?: string; count?: string; pois?: AmapPoiV3[] };
      if (json.status !== '1') throw new Error(`高德返回错误: ${json.info} (infocode=${json.infocode})`);

      let pois = json.pois ?? [];
      if (adcodeFilter?.length) pois = pois.filter((p) => adcodeFilter.includes(p.adcode ?? ''));
      if (businessAreaFilter?.length) {
        const set = new Set(businessAreaFilter);
        pois = pois.filter((p) => p.business_area && set.has(p.business_area));
      }
      if (!skipRaw) saveRaw(`amap_v3_${region}_${keywords}`, json);
      return { pois, count: Number(json.count ?? 0), raw: json };
    } catch (e) {
      lastErr = e as Error;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error('unknown error');
}

/** 调用高德 v3/config/district 拿行政区划树（可传 subdistrict=1 拿下一级） */
export async function fetchDistrict(keyword: string, opts: { key: string; subdistrict?: number; base?: string }) {
  const params = new URLSearchParams({
    key: opts.key, keywords: keyword, subdistrict: String(opts.subdistrict ?? 1), extensions: 'base',
  });
  const url = `${opts.base ?? AMAP_BASE}/v3/config/district?${params.toString()}`;
  await throttle(350);
  const res = await fetch(url);
  const json = (await res.json()) as { status?: string; info?: string; districts?: unknown[] };
  if (json.status !== '1') throw new Error(`高德行政区划错误: ${json.info}`);
  saveRaw(`amap_district_${keyword}`, json);
  return json.districts ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let _lastCall = 0;
async function throttle(ms: number) {
  const wait = ms - (Date.now() - _lastCall);
  if (wait > 0) await sleep(wait);
  _lastCall = Date.now();
}

function saveRaw(tag: string, data: unknown) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const safe = tag.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const file = path.join(RAW_DIR, `${safe}_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

function asText(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.filter(Boolean).join(' ');
  return typeof v === 'string' ? v : '';
}

/** 高德 v3 POI -> 本项目 Place（补齐三种高德链接 + 商圈/区县/品类字段） */
export function toPlace(poi: AmapPoiV3, category: Category, fallbackCity: string, cityAdcode = ''): Place | null {
  if (!poi.id || !poi.name) return null;
  const [lngStr, latStr] = (poi.location ?? '').split(',');
  const lng = Number(lngStr);
  const lat = Number(latStr);

  const name = poi.name;
  const city = poi.cityname || fallbackCity;
  const districtAdcode = poi.adcode || '';
  const enc = encodeURIComponent;
  const hasCoord = Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);

  const rating = Number(poi.biz_ext?.rating ?? 0) || 0;
  const cost = Number(poi.biz_ext?.cost ?? 0) || 0;
  // 末级品类（"餐饮服务;中餐厅;火锅店" -> "火锅店"），商圈名用于区域筛选
  const typeTail = (poi.type ?? '').split(';').filter(Boolean).slice(-1)[0] ?? '';

  return {
    id: poi.id,
    source: 'amap',
    name,
    categoryId: category.id,
    cityAdcode: cityAdcode || (districtAdcode ? `${districtAdcode.slice(0, 4)}00` : ''),
    regionAdcode: districtAdcode,
    city,
    district: poi.adname || '',
    districtAdcode,
    address: asText(poi.address) || `${city}${poi.adname ?? ''}`,
    lng: hasCoord ? lng : 0,
    lat: hasCoord ? lat : 0,
    rating,
    cost,
    why: typeTail,
    amapPoiId: poi.id,
    amapUrl: `https://www.amap.com/place/${poi.id}`,
    uriSearchUrl: `https://uri.amap.com/search?keyword=${enc(name)}&city=${enc(city)}&view=map&callnative=0`,
    markerUrl: hasCoord
      ? `https://uri.amap.com/marker?position=${lng.toFixed(6)},${lat.toFixed(6)}&name=${enc(name)}&coordinate=gaode&callnative=1`
      : null,
    naviUrl: hasCoord
      ? `https://uri.amap.com/navigation?to=${lng.toFixed(6)},${lat.toFixed(6)},${enc(name)}&mode=car&policy=1&src=trip-roulette`
      : null,
    coordPrecision: hasCoord ? 'exact' : 'approx',
    fetchedAt: new Date().toISOString(),
    // 高德新增维度
    businessArea: poi.business_area || '',
    typecode: poi.typecode || '',
    tel: asText(poi.tel),
    opentime: poi.biz_ext?.opentime_today || poi.biz_ext?.opentime_week || '',
    photo: poi.photos?.[0]?.url ?? '',
  };
}

export interface CollectTask {
  category: Category;
  cityName: string;
  cityAdcode: string;
}

/** 伪分类：地铁站 / 商场 —— 它们不是"转盘项目"，而是"选区域"的维度，单独采集 */
export const AREA_CATEGORIES: Record<'metro' | 'mall', Category> = {
  metro: {
    id: 'area_metro', label: '地铁站', icon: '🚇', group: '区域', required: false, weight: 0,
    amapTypes: '150500', keywords: [''], desc: '用于按地铁站选区域',
  },
  mall: {
    id: 'area_mall', label: '商场', icon: '🛍️', group: '区域', required: false, weight: 0,
    amapTypes: '060100', keywords: [''], desc: '用于按商场选区域',
  },
};

/** 采集某一类区域维度（地铁站/商场），只入库不参与抽签项目 */
export async function collectAreaDimension(
  kind: 'metro' | 'mall',
  city: { cityName: string; cityAdcode: string },
  opts: { key: string; pages?: number; base?: string; throttleMs?: number },
): Promise<{ kind: string; got: number; saved: number }> {
  await requireDb();
  const category = AREA_CATEGORIES[kind];
  const pages = Math.max(1, Math.min(opts.pages ?? 8, V3_MAX_PAGE));
  const seen = new Set<string>();
  const buffer: Place[] = [];
  let got = 0;

  for (let page = 1; page <= pages; page++) {
    let pois: AmapPoiV3[] = [];
    try {
      const r = await searchPlaces({
        key: opts.key, keywords: '', region: city.cityAdcode, types: category.amapTypes,
        pageNum: page, base: opts.base, throttleMs: opts.throttleMs, skipRaw: true,
      });
      pois = r.pois;
    } catch {
      break;
    }
    if (pois.length === 0) break;
    got += pois.length;
    for (const poi of pois) {
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      const p = toPlace(poi, category, city.cityName, city.cityAdcode);
      if (p) buffer.push(p);
    }
    if (pois.length < V3_PAGE_SIZE) break; // 不足一页说明到底了
  }

  if (buffer.length) upsertPlaces(buffer);
  return { kind, got, saved: seen.size };
}

export interface CollectResult {
  category: string;
  keyword: string;
  page: number;
  got: number;
  saved: number;
  ok: boolean;
  remoteCount?: number;
  msg: string;
}

/** 采集一个分类 × 城市的多个关键词，去重后入库（v3 + 分页，遇到重复页提前停止） */
export async function collectCategory(
  task: CollectTask,
  opts: {
    key: string;
    pages?: number;
    base?: string;
    throttleMs?: number;
    keywordsPerCategory?: number;
    onProgress?: (r: CollectResult) => void;
  },
): Promise<CollectResult[]> {
  const pages = Math.max(1, Math.min(opts.pages ?? 2, V3_MAX_PAGE));
  const keyCount = opts.keywordsPerCategory ?? 3;
  // 采集前先确认数据库可用：否则一整轮请求白跑，数据还会被静默丢弃
  await requireDb();
  const results: CollectResult[] = [];
  const seen = new Set<string>();
  const buffer: Place[] = [];

  for (const keyword of task.category.keywords.slice(0, keyCount)) {
    let prevIds = '';
    for (let page = 1; page <= pages; page++) {
      let r: CollectResult;
      try {
        const { pois, count } = await searchPlaces({
          key: opts.key, keywords: keyword, region: task.cityAdcode || task.cityName,
          types: task.category.amapTypes, pageNum: page,
          base: opts.base, throttleMs: opts.throttleMs, skipRaw: page > 1,
        });
        // v3 在无更多结果时会重复返回同一页，检测到就停
        const idsKey = pois.map((p) => p.id).join(',');
        if (page > 1 && idsKey && idsKey === prevIds) {
          r = { category: task.category.id, keyword, page, got: pois.length, saved: 0, ok: true, remoteCount: count, msg: '本页与上页重复，已到数据末尾' };
          results.push(r);
          opts.onProgress?.(r);
          break;
        }
        prevIds = idsKey;

        let saved = 0;
        for (const poi of pois) {
          if (seen.has(poi.id)) continue;
          seen.add(poi.id);
          const p = toPlace(poi, task.category, task.cityName, task.cityAdcode);
          if (p) { buffer.push(p); saved++; }
        }
        r = { category: task.category.id, keyword, page, got: pois.length, saved, ok: true, remoteCount: count, msg: `远程共 ${count} 条` };
        if (pois.length === 0) {
          r.msg = `远程共 ${count} 条，本页无数据（已到末尾）`;
          results.push(r);
          opts.onProgress?.(r);
          break;
        }
      } catch (e) {
        r = { category: task.category.id, keyword, page, got: 0, saved: 0, ok: false, msg: (e as Error).message };
      }
      results.push(r);
      opts.onProgress?.(r);
      await logCollect({
        source: 'amap', city: task.cityName, categoryId: task.category.id, keyword, page,
        got: r.got, ranAt: new Date().toISOString(), ok: r.ok ? 1 : 0, msg: r.msg,
      });
    }
  }

  if (buffer.length) upsertPlaces(buffer);
  return results;
}

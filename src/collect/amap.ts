/**
 * 高德开放平台 Web 服务 API 采集器
 * 依据：docs/01-爬取可行性报告.md（接口已实测通畅，仅需 Key）
 *
 * 需要环境变量 AMAP_KEY（.env 或直接设置）。申请方式见报告第六节。
 * 接口：
 *   v5/place/text   关键字搜索（推荐，show_fields 可拿 rating/photos/business）
 *   v3/config/district 行政区划（省市区树）
 *
 * 合规要点：内置限速（默认 3 QPS）、失败重试、原始响应落盘、增量入库不重复请求。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Category, Place } from '../core/types.ts';
import { upsertPlaces, logCollect } from '../db/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
export const RAW_DIR = path.join(ROOT, 'data', 'raw');

export const AMAP_BASE = process.env.AMAP_BASE ?? 'https://restapi.amap.com';

export function getAmapKey(): string | null {
  if (process.env.AMAP_KEY && process.env.AMAP_KEY.trim()) return process.env.AMAP_KEY.trim();
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^\s*AMAP_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

export interface AmapPoi {
  id: string;
  name: string;
  address: string;
  location: string; // "lng,lat"
  type: string;
  typecode?: string;
  cityname?: string;
  adname?: string;
  citycode?: string;
  adcode?: string;
  pname?: string;
  tel?: string | string[];
  rating?: string;
  cost?: string;
  photos?: { title?: string; url?: string }[];
  business?: { opentime_today?: string; opentime_week?: string; rating?: string; cost?: string; tel?: string };
}

export interface SearchOptions {
  key: string;
  keywords: string;
  region: string; // 城市名或 adcode
  types?: string;
  pageSize?: number;
  pageNum?: number;
  cityLimit?: boolean;
  /** 请求间隔 ms（默认 350，约 3 QPS，礼貌限速） */
  throttleMs?: number;
  /** 单次请求失败重试次数 */
  retries?: number;
  base?: string;
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
  const file = path.join(RAW_DIR, `${tag}_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

/** 调用高德 v5/place/text（关键字搜索）；返回归一化候选与原始响应 */
export async function searchPlaces(opts: SearchOptions): Promise<{ pois: AmapPoi[]; count: number; raw: unknown }> {
  const {
    key, keywords, region, types, pageSize = 25, pageNum = 1,
    cityLimit = true, throttleMs = 350, retries = 2, base = AMAP_BASE,
  } = opts;

  const params = new URLSearchParams({
    key, keywords, region, page_size: String(pageSize), page_num: String(pageNum),
    city_limit: String(cityLimit), show_fields: 'business,photos,rating,cost,navi',
  });
  if (types) params.set('types', types);
  const url = `${base}/v5/place/text?${params.toString()}`;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(throttleMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'trip-roulette/0.1 (personal use)' } });
      const json = (await res.json()) as {
        status?: string; info?: string; infocode?: string; count?: string; pois?: AmapPoi[];
      };
      if (json.status !== '1') {
        throw new Error(`高德返回错误: ${json.info} (infocode=${json.infocode})`);
      }
      saveRaw(`amap_text_${region}_${keywords}`, json);
      return { pois: json.pois ?? [], count: Number(json.count ?? 0), raw: json };
    } catch (e) {
      lastErr = e as Error;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error('unknown error');
}

/** 调用高德 v3/config/district 拿行政区划树 */
export async function fetchDistrict(keyword: string, opts: { key: string; subdistrict?: number; base?: string } ) {
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

/** 高德 POI -> 本项目 Place（补齐三种高德链接）
 *  注意：高德返回的 adcode 通常是【区县级】（如 330106），而抽签按城市查询，
 *  所以 cityAdcode 必须由调用方用所在城市的 adcode 显式传入。
 */
export function toPlace(poi: AmapPoi, category: Category, fallbackCity: string, cityAdcode = ''): Place | null {
  if (!poi.id || !poi.name) return null;
  const [lngStr, latStr] = (poi.location ?? '').split(',');
  const lng = Number(lngStr);
  const lat = Number(latStr);

  const name = poi.name;
  const city = poi.cityname || fallbackCity;
  const districtAdcode = poi.adcode || '';
  const enc = encodeURIComponent;
  const hasCoord = Number.isFinite(lng) && Number.isFinite(lat);

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
    address: poi.address && typeof poi.address === 'string' ? poi.address : `${city}${poi.adname ?? ''}`,
    lng: hasCoord ? lng : 0,
    lat: hasCoord ? lat : 0,
    rating: Number(poi.business?.rating ?? poi.rating ?? 0) || 0,
    cost: Number(poi.business?.cost ?? poi.cost ?? 0) || 0,
    why: poi.type ? poi.type.split(';').slice(-1)[0] : '',
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
  };
}

export interface CollectTask {
  category: Category;
  cityName: string;
  cityAdcode: string;
}

export interface CollectResult {
  category: string;
  keyword: string;
  page: number;
  got: number;
  saved: number;
  ok: boolean;
  msg: string;
}

/** 采集一个分类 × 城市：多关键词 + 多页，去重后入库 */
export async function collectCategory(
  task: CollectTask,
  opts: { key: string; pages?: number; base?: string; throttleMs?: number; onProgress?: (r: CollectResult) => void },
): Promise<CollectResult[]> {
  const pages = opts.pages ?? 2;
  const results: CollectResult[] = [];
  const seen = new Set<string>();
  const buffer: Place[] = [];

  for (const keyword of task.category.keywords.slice(0, 3)) {
    for (let page = 1; page <= pages; page++) {
      let r: CollectResult;
      try {
        const { pois, count } = await searchPlaces({
          key: opts.key, keywords: keyword, region: task.cityAdcode || task.cityName,
          types: task.category.amapTypes, pageSize: 25, pageNum: page,
          base: opts.base, throttleMs: opts.throttleMs,
        });
        let saved = 0;
        for (const poi of pois) {
          if (seen.has(poi.id)) continue;
          seen.add(poi.id);
          const p = toPlace(poi, task.category, task.cityName, task.cityAdcode);
          if (p) { buffer.push(p); saved++; }
        }
        r = { category: task.category.id, keyword, page, got: pois.length, saved, ok: true, msg: `远程共 ${count} 条` };
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

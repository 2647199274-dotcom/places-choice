export interface ApiCategory {
  id: string;
  label: string;
  icon: string;
  group: string;
  /** 永远在列且不可取消 */
  required: boolean;
  /** 随机抽项目时必定包含（吃饭） */
  alwaysInRandom?: boolean;
  weight: number;
  desc: string;
}

export interface ApiCity {
  adcode: string;
  name: string;
  province: string;
  total: number;
  /** 该城市有数据的分类（前端用来灰显空项目） */
  categories: string[];
}

export interface ApiProvince {
  adcode: string;
  name: string;
  cities: number;
  total: number;
}

export interface ApiPlace {
  id: string;
  name: string;
  categoryId: string;
  categoryLabel?: string;
  categoryIcon?: string;
  /** 市级 adcode（抽签按城市过滤用这个） */
  cityAdcode?: string;
  /** 区县 adcode */
  regionAdcode?: string;
  city: string;
  district: string;
  address: string;
  lng: number;
  lat: number;
  rating: number;
  cost: number;
  why: string;
  amapPoiId: string | null;
  amapUrl?: string | null;
  uriSearchUrl?: string;
  markerUrl?: string | null;
  naviUrl?: string | null;
  coordPrecision: string;
  /** 高德商圈名（如「杭州新天地」） */
  businessArea?: string;
  typecode?: string;
  tel?: string;
  opentime?: string;
  photo?: string;
}

export interface ApiSegment {
  placeId: string;
  name: string;
  weight: number;
  share: number;
}

export interface ApiDrawResult {  city: string;
  regionAdcode: string;
  categoryIds: string[];
  segments: ApiSegment[];
  winnerIndex: number;
  candidateCount: number;
  poolCities?: string[];
  placeDetail: ApiPlace;
  link: {
    primary: string;
    primaryKind: 'place' | 'uriSearch';
    place: string | null;
    uriSearch: string;
    marker: string | null;
    navi: string | null;
  };
}

/** 抽签地区范围 */
export type DrawScope = 'city' | 'randomCity' | 'province';

/** 区域维度（美团式筛选） */
export type AreaDimension = 'district' | 'businessArea' | 'mall' | 'metro';

export interface ApiArea {
  key: string;
  name: string;
  dimension: AreaDimension;
  placeCount: number;
  lng?: number;
  lat?: number;
}

export interface AreaSelection {
  dimension: AreaDimension;
  key: string;
  name: string;
}

/**
 * API 基地址：
 *  - 浏览器 / Vite 开发：留空，走同源（Vite 代理或 Fastify 托管）
 *  - 打包成 APK 时：必须显式指向后端地址，例如
 *      VITE_API_BASE=http://192.168.1.20:5178 npm run build:web
 *    （打包进 App 的页面来自本地文件，没有同源后端可代理）
 */
const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');

/**
 * 静态部署（GitHub Pages）时没有后端，回退读构建时导出的 /data/dataset.json。
 * 同源路径要用 import.meta.env.BASE_URL 拼，才能在子路径（/places-choice/）下正确。
 */
const STATIC_DATASET_URL = `${import.meta.env?.BASE_URL ?? '/'}data/dataset.json`.replace(/([^:]\/)\/+/g, '$1');

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    // 超时保护：APK/弱网下不要一直转圈，超时后由调用方回退到本地数据集
    signal: AbortSignal.timeout(8000),
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { message?: string } | null)?.message ?? `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

/** 静态快照是"精简格式"（字段名压缩过，体积约为完整格式的 1/4），这里还原成前端通用结构 */
export interface CompactPlace {
  id: string; n: string; c: string; ca: string; ra: string; cy: string; d: string;
  lng: number; lat: number; r: number; p: number; w: string; ba: string; poi: string; cp: 0 | 1;
}

export function hydrateCompactPlace(cp: CompactPlace): ApiPlace {
  const hasCoord = cp.lng !== 0 || cp.lat !== 0;
  return {
    id: cp.id,
    name: cp.n,
    categoryId: cp.c,
    cityAdcode: cp.ca,
    regionAdcode: cp.ra,
    city: cp.cy,
    district: cp.d,
    address: `${cp.cy}${cp.d}`,
    lng: cp.lng,
    lat: cp.lat,
    rating: cp.r,
    cost: cp.p,
    why: cp.w,
    businessArea: cp.ba,
    amapPoiId: cp.poi || null,
    coordPrecision: cp.cp ? 'exact' : 'approx',
    uriSearchUrl: `https://uri.amap.com/search?keyword=${encodeURIComponent(cp.n)}&city=${encodeURIComponent(cp.cy)}&view=map&callnative=0`,
    markerUrl: hasCoord
      ? `https://uri.amap.com/marker?position=${cp.lng.toFixed(6)},${cp.lat.toFixed(6)}&name=${encodeURIComponent(cp.n)}&coordinate=gaode&callnative=1`
      : null,
    naviUrl: hasCoord
      ? `https://uri.amap.com/navigation?to=${cp.lng.toFixed(6)},${cp.lat.toFixed(6)},${encodeURIComponent(cp.n)}&mode=car&policy=1&src=trip-roulette`
      : null,
  } as ApiPlace;
}

export interface DatasetPayload {
  generatedAt: string;
  source?: string;
  /** 精简格式标记（静态快照为 true，后端 /api/dataset 为完整格式） */
  compact?: boolean;
  categories: ApiCategory[];
  requiredIds: string[];
  cities: ApiCity[];
  provinces: ApiProvince[];
  districts: { adcode: string; name: string; parent: string }[];
  areas: Record<string, Record<string, ApiArea[]>>;
  places: (ApiPlace | CompactPlace)[];
}

/** 统一把后端（完整格式）与静态快照（精简格式）都还原成 ApiPlace[] */
export function normalizePlaces(places: (ApiPlace | CompactPlace)[]): ApiPlace[] {
  if (places.length === 0) return [];
  const first = places[0] as Partial<CompactPlace> & Partial<ApiPlace>;
  // 精简格式用单字母键：n=name、c=categoryId
  return 'n' in first && 'c' in first ? (places as CompactPlace[]).map(hydrateCompactPlace) : (places as ApiPlace[]);
}

export const api = {
  categories: () => j<{ categories: ApiCategory[]; requiredIds: string[] }>('/api/categories'),
  regions: () =>
    j<{ cities: ApiCity[]; provinces: ApiProvince[]; districts: { adcode: string; name: string; parent: string }[] }>(
      '/api/regions',
    ),
  health: () => j<{ ok: boolean; total: number; byCity: Record<string, number> }>('/api/health'),
  randomProjects: (count = 3) =>
    j<{ categoryIds: string[]; categories: ApiCategory[] }>(`/api/random-projects?count=${count}`),
  draw: (payload: {
    region: { adcode: string; name: string };
    scope?: DrawScope;
    /** 限定省份（如 330000）：全国化后"全省随机/随机城市"都按它限定范围 */
    provinceAdcode?: string;
    categoryIds: string[];
    randomize?: boolean;
    randomCount?: number;
    segmentCount?: number;
    areas?: { dimension: AreaDimension; key: string }[];
    filters?: { excludeVisited?: boolean; minRating?: number; maxCost?: number };
  }) => j<ApiDrawResult>('/api/draw', { method: 'POST', body: JSON.stringify(payload) }),
  /** 区域维度列表：地区 / 商圈 / 商场 / 地铁 */
  areas: (cityAdcode: string, categories: string[] = []) =>
    j<{ city: string; district?: ApiArea[]; businessArea?: ApiArea[]; mall?: ApiArea[]; metro?: ApiArea[] }>(
      `/api/areas?city=${encodeURIComponent(cityAdcode)}${categories.length ? `&categories=${categories.join(',')}` : ''}`,
    ),
  /** 一次性拉全量数据集：优先后端，静态部署时回退到构建导出的 /data/dataset.json */
  dataset: async (): Promise<DatasetPayload> => {
    try {
      return await j<DatasetPayload>('/api/dataset');
    } catch (e) {
      const res = await fetch(STATIC_DATASET_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw e;
      const body = (await res.json().catch(() => null)) as DatasetPayload | null;
      // 走到这里说明后端不可用，数据来自静态快照 —— 必须显式标记，
      // 否则前端会以为"在线"（踩过：依赖 json 里的 source 字段，而旧快照没有该字段）
      if (!body?.places?.length) throw e;
      return { ...body, source: 'static' };
    }
  },
  markVisited: (placeId: string, note?: string) =>
    j<{ ok: boolean }>('/api/visited', { method: 'POST', body: JSON.stringify({ placeId, note }) }),
};

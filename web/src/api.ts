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
  /** 一次性拉全量数据集（前端缓存到 localStorage，供离线抽签） */
  dataset: () =>
    j<{
      generatedAt: string;
      categories: ApiCategory[];
      requiredIds: string[];
      cities: ApiCity[];
      provinces: ApiProvince[];
      districts: { adcode: string; name: string; parent: string }[];
      areas: Record<string, Record<string, ApiArea[]>>;
      places: ApiPlace[];
    }>('/api/dataset'),
  markVisited: (placeId: string, note?: string) =>
    j<{ ok: boolean }>('/api/visited', { method: 'POST', body: JSON.stringify({ placeId, note }) }),
};

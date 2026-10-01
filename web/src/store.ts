/**
 * 本地数据集 + 足迹缓存（离线/APK 用）
 * 首次联网时把 /api/dataset 的完整数据写入 localStorage，
 * 之后断网也能转盘，并能记住"就去这家/已去过"。
 */
import type { ApiCategory, ApiCity, ApiPlace, ApiProvince } from './api.ts';

const DATASET_KEY = 'trip-roulette:dataset:v1';
const VISITED_KEY = 'trip-roulette:visited:v1';
const RECENT_KEY = 'trip-roulette:recent:v1';

export interface CachedDataset {
  generatedAt: string;
  categories: ApiCategory[];
  requiredIds: string[];
  cities: ApiCity[];
  provinces: ApiProvince[];
  districts: { adcode: string; name: string; parent: string }[];
  places: ApiPlace[];
}

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 隐私模式 / 配额满：静默失败，不影响在线使用
    return false;
  }
}

export function loadDataset(): CachedDataset | null {
  const d = safeGet<CachedDataset>(DATASET_KEY);
  return d?.places?.length ? d : null;
}

export function saveDataset(d: CachedDataset): boolean {
  return safeSet(DATASET_KEY, d);
}

export function clearDataset() {
  try { localStorage.removeItem(DATASET_KEY); } catch { /* ignore */ }
}

export function localVisitedIds(): string[] {
  return safeGet<string[]>(VISITED_KEY) ?? [];
}

export function addLocalVisited(id: string): string[] {
  const cur = new Set(localVisitedIds());
  cur.add(id);
  const arr = [...cur];
  safeSet(VISITED_KEY, arr);
  return arr;
}

export function localRecentIds(): string[] {
  return safeGet<string[]>(RECENT_KEY) ?? [];
}

export function addLocalRecent(id: string): string[] {
  const arr = [id, ...localRecentIds().filter((x) => x !== id)].slice(0, 20);
  safeSet(RECENT_KEY, arr);
  return arr;
}

export function datasetAgeLabel(d: CachedDataset | null): string {
  if (!d) return '无本地缓存';
  const ms = Date.now() - new Date(d.generatedAt).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return '刚刚更新';
  if (min < 60) return `${min} 分钟前更新`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前更新`;
  return `${Math.round(h / 24)} 天前更新`;
}

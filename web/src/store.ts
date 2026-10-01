/**
 * 本地数据集缓存
 *
 * 为什么用 IndexedDB 而不是 localStorage：
 *   完整数据集约 2.8MB，localStorage 通常只有 5MB 上限（且按 UTF-16 计更吃紧），
 *   实测写不进去 → 数据只留在内存里 → 用户关掉页面再离线打开就没数据了。
 *   IndexedDB 没有这个限制，所以数据集走 IndexedDB；足迹/历史这类小数据仍用 localStorage。
 */
import type { ApiArea, ApiCategory, ApiCity, ApiPlace, ApiProvince } from './api.ts';

const DATASET_KEY = 'trip-roulette:dataset:v1';
const VISITED_KEY = 'trip-roulette:visited:v1';
const RECENT_KEY = 'trip-roulette:recent:v1';
const DB_NAME = 'trip-roulette';
const STORE = 'kv';

export interface CachedDataset {
  generatedAt: string;
  categories: ApiCategory[];
  requiredIds: string[];
  cities: ApiCity[];
  provinces: ApiProvince[];
  districts: { adcode: string; name: string; parent: string }[];
  /** 各城市的区域维度（地铁/地区/商场/商圈） */
  areas?: Record<string, Record<string, ApiArea[]>>;
  places: ApiPlace[];
}

/* ---------------- 小数据：localStorage ---------------- */

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
    return false;
  }
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

/* ---------------- 大数据集：IndexedDB ---------------- */

let _dbPromise: Promise<IDBDatabase | null> | null = null;

function openIdb(): Promise<IDBDatabase | null> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return _dbPromise;
}

async function idbSet(key: string, value: unknown): Promise<boolean> {
  const db = await openIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** 落盘数据集：IndexedDB 为主，localStorage 作兜底（小数据集时也能用） */
export async function saveDataset(d: CachedDataset): Promise<{ idb: boolean; ls: boolean }> {
  const idb = await idbSet(DATASET_KEY, d);
  const ls = safeSet(DATASET_KEY, d); // 数据太大时会返回 false，属预期
  return { idb, ls };
}

/** 读数据集：IndexedDB → localStorage 依次尝试 */
export async function loadDataset(): Promise<CachedDataset | null> {
  const fromIdb = await idbGet<CachedDataset>(DATASET_KEY);
  if (fromIdb?.places?.length) return fromIdb;
  const fromLs = safeGet<CachedDataset>(DATASET_KEY);
  return fromLs?.places?.length ? fromLs : null;
}

export async function clearDataset(): Promise<void> {
  const db = await openIdb();
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(DATASET_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  try { localStorage.removeItem(DATASET_KEY); } catch { /* ignore */ }
}

/** 数据集大小与存储位置（用于界面提示与排错） */
export async function datasetStorageInfo(): Promise<{ idb: number; ls: number }> {
  const idbData = await idbGet<CachedDataset>(DATASET_KEY);
  const lsRaw = (() => { try { return localStorage.getItem(DATASET_KEY); } catch { return null; } })();
  const kb = (x: string | null) => (x ? Math.round(x.length / 1024) : 0);
  return {
    idb: idbData?.places?.length ? kb(JSON.stringify(idbData)) : 0,
    ls: kb(lsRaw),
  };
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

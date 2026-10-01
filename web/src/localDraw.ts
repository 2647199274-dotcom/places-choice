/**
 * 本地抽签引擎（与后端 src/core/draw.ts 规则一致）
 *
 * 为什么要搬到前端：APK / 断网时后端可能不可达，这时用 localStorage 缓存的数据集
 * 在本地完成"同规则"的抽签，保证转盘永远能转。
 * 联网时仍优先用后端结果（足迹与冷却历史在后端共享）。
 *
 * 规则一致性由 tests/verify-local.mjs 校验（同样本对比落点分布）。
 */
import type { ApiCategory, ApiPlace, AreaDimension } from './api.ts';

export interface LocalSegment {
  placeId: string;
  name: string;
  share: number;
}

export interface LocalDrawResult {
  segments: LocalSegment[];
  winnerIndex: number;
  place: ApiPlace;
  candidateCount: number;
  poolCities: string[];
  local: true;
}

/** 加密安全随机（与后端 crypto.randomInt 同性质），并做取模偏差修正 */
export function cryptoRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let v = 0;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % maxExclusive;
}

export function resolveCategories(categories: ApiCategory[], selectedIds: string[]): ApiCategory[] {
  const chosen = new Map<string, ApiCategory>();
  // 只有真正 required 的才强制在列（吃饭已改为可取消，人工选择时由用户勾选决定）
  for (const c of categories.filter((c) => c.required)) chosen.set(c.id, c);
  for (const id of selectedIds) {
    const c = categories.find((x) => x.id === id);
    if (c) chosen.set(c.id, c);
  }
  return [...chosen.values()];
}

export function randomCategoryIds(
  categories: ApiCategory[],
  count: number,
  rand: (n: number) => number = cryptoRandomInt,
): string[] {
  // 吃饭这类 alwaysInRandom 必定包含（保住"选项里一定有吃饭"）
  const pinned = categories.filter((c) => c.required || c.alwaysInRandom).map((c) => c.id);
  const pinnedSet = new Set(pinned);
  const remaining = categories.filter((c) => !pinnedSet.has(c.id));
  const picked: string[] = [];
  const n = Math.max(0, Math.min(count, remaining.length));
  for (let i = 0; i < n; i++) {
    const total = remaining.reduce((s, c) => s + c.weight, 0);
    let r = (rand(10000) / 10000) * total;
    let idx = 0;
    for (let j = 0; j < remaining.length; j++) {
      r -= remaining[j].weight;
      if (r <= 0) { idx = j; break; }
      idx = j;
    }
    picked.push(remaining[idx].id);
    remaining.splice(idx, 1);
  }
  return [...pinned, ...picked];
}

function weightOf(p: ApiPlace, cats: Map<string, ApiCategory>): number {
  const base = cats.get(p.categoryId)?.weight ?? 1;
  const ratingFactor = 0.5 + Math.max(0, Math.min(5, p.rating || 4)) / 5;
  const hasWhy = p.why ? 1.05 : 1;
  return base * ratingFactor * hasWhy;
}

export interface LocalDrawInput {
  places: ApiPlace[];
  categories: ApiCategory[];
  /** 候选城市池：城市 adcode 列表 */
  cityPool: string[];
  categoryIds: string[];
  recentPlaceIds?: string[];
  visitedPlaceIds?: string[];
  filters?: { excludeVisited?: boolean; minRating?: number; maxCost?: number; cooldown?: number };
  /** 区域筛选（与后端同规则：多维度取交集） */
  areas?: { dimension: AreaDimension; key: string; name?: string }[];
  segmentCount?: number;
  rand?: (n: number) => number;
}

/** 判断一个地点是否落在所选区域内（离线可用：区县/商圈按名称，商场/地铁按缓存里的名称匹配） */
function inAreas(p: ApiPlace, areas: NonNullable<LocalDrawInput['areas']>): boolean {
  return areas.every((a) => {
    switch (a.dimension) {
      case 'district':
        return p.district === a.name || p.district === a.key;
      case 'businessArea':
        return (p.businessArea ?? '') === a.name || (p.businessArea ?? '') === a.key;
      // 商场/地铁的关联关系只在后端算（离线时不参与过滤，避免误杀）
      default:
        return true;
    }
  });
}

export function localDraw(input: LocalDrawInput): LocalDrawResult | null {
  const rand = input.rand ?? cryptoRandomInt;
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const chosen = resolveCategories(input.categories, input.categoryIds);
  const catIds = new Set(chosen.map((c) => c.id));
  const pool = new Set(input.cityPool);
  const recent = new Set((input.recentPlaceIds ?? []).slice(0, input.filters?.cooldown ?? 5));
  const visited = new Set(input.visitedPlaceIds ?? []);
  const f = input.filters ?? {};

  const filtered = input.places.filter((p) => {
    const inScope = pool.has(p.cityAdcode ?? '') || pool.has(p.regionAdcode ?? '');
    if (!inScope) return false;
    if (!catIds.has(p.categoryId)) return false;
    if (input.areas?.length && !inAreas(p, input.areas)) return false;
    if (f.excludeVisited && visited.has(p.id)) return false;
    if (f.minRating != null && p.rating < f.minRating) return false;
    if (f.maxCost != null && p.cost > 0 && p.cost > f.maxCost) return false;
    if (recent.has(p.id)) return false;
    return true;
  });

  if (filtered.length === 0) return null;

  const segCount = Math.max(2, Math.min(input.segmentCount ?? 10, 12));
  const sorted = [...filtered].sort((a, b) => weightOf(b, cats) - weightOf(a, cats));
  let picked = sorted.slice(0, segCount);
  const rest = sorted.slice(segCount);
  if (rest.length > 0) {
    const swaps = Math.min(rest.length, Math.max(1, Math.round(segCount * 0.2)));
    for (let i = 0; i < swaps; i++) {
      const rp = rest[rand(rest.length)];
      const slot = rand(picked.length);
      if (rp && !picked.includes(rp)) picked[slot] = rp;
    }
  }
  if (picked.length < 2) picked = [...filtered];

  const raw = picked.map((p) => weightOf(p, cats));
  const total = raw.reduce((s, w) => s + w, 0) || 1;
  const minShare = 0.04;
  const maxShare = 0.32;
  let shares = raw.map((w) => w / total);
  for (let iter = 0; iter < 20; iter++) {
    shares = shares.map((s) => Math.max(minShare, Math.min(maxShare, s)));
    const sum = shares.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) < 1e-9) break;
    shares = shares.map((s) => s / sum);
    if (shares.every((s) => s >= minShare - 1e-9 && s <= maxShare + 1e-9)) break;
  }

  const segments: LocalSegment[] = picked.map((p, i) => ({
    placeId: p.id,
    name: p.name,
    share: +shares[i].toFixed(6),
  }));

  const r = rand(1_000_000) / 1_000_000;
  let acc = 0;
  let winnerIndex = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i].share;
    if (r < acc) { winnerIndex = i; break; }
  }

  return {
    segments,
    winnerIndex,
    place: picked[winnerIndex],
    candidateCount: filtered.length,
    poolCities: input.cityPool,
    local: true,
  };
}

/** 本地生成高德链接（与后端同一套规则，保证结果卡在离线时也能跳高德） */
export function amapLinks(p: ApiPlace) {
  const enc = encodeURIComponent;
  const place = p.amapPoiId ? `https://www.amap.com/place/${p.amapPoiId}` : null;
  const uriSearch = `https://uri.amap.com/search?keyword=${enc(p.name)}&city=${enc(p.city)}&view=map&callnative=0`;
  const hasCoord = Number.isFinite(p.lng) && Number.isFinite(p.lat) && p.lng !== 0;
  const marker = hasCoord
    ? `https://uri.amap.com/marker?position=${p.lng.toFixed(6)},${p.lat.toFixed(6)}&name=${enc(p.name)}&coordinate=gaode&callnative=1`
    : null;
  const navi = hasCoord
    ? `https://uri.amap.com/navigation?to=${p.lng.toFixed(6)},${p.lat.toFixed(6)},${enc(p.name)}&mode=car&policy=1&src=trip-roulette`
    : null;
  return { place, uriSearch, marker, navi, primary: place ?? uriSearch, primaryKind: place ? ('place' as const) : ('uriSearch' as const) };
}

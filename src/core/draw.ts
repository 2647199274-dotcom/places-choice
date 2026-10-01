import { randomInt } from 'node:crypto';
import type { Category, DrawFilters, DrawResult, Place, WheelSegment } from './types.ts';
import { buildAmapLinks } from '../links/amap-link.ts';

export interface DrawInput {
  region: { adcode: string; name: string };
  /** 候选城市池：默认 [region.adcode]；全省随机/多城市混抽时传入多个 adcode */
  cityPool?: string[];
  /** 用户选中的项目；吃饭类会被强制加入 */
  categoryIds: string[];
  categories: Category[];
  places: Place[];
  /** 最近抽中过的 placeId（用于冷却，避免连续抽到同一家） */
  recentPlaceIds?: string[];
  /** 已去过的 placeId */
  visitedPlaceIds?: string[];
  filters?: DrawFilters;
  /** 扇区数量，默认 10（候选多时只取权重最高的前 N 个） */
  segmentCount?: number;
  /** 随机抽签使用的可注入随机源（便于测试） */
  rand?: (maxExclusive: number) => number;
}

export function resolveCategories(categories: Category[], selectedIds: string[]): Category[] {
  const required = categories.filter((c) => c.required);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const chosen = new Map<string, Category>();
  // 吃饭类永远在列（人工选择与随机模式都强制包含）
  for (const c of required) chosen.set(c.id, c);
  for (const id of selectedIds) {
    const c = byId.get(id);
    if (c) chosen.set(c.id, c);
  }
  return [...chosen.values()];
}

export function randomCategoryIds(categories: Category[], count: number, rand: (n: number) => number = (n) => randomInt(n)): string[] {
  const required = categories.filter((c) => c.required).map((c) => c.id);
  const pool = categories.filter((c) => !c.required);
  const picked: string[] = [];
  const remaining = [...pool];
  const n = Math.max(0, Math.min(count, remaining.length));
  for (let i = 0; i < n; i++) {
    // 按 weight 做加权抽取
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
  return [...required, ...picked];
}

/** 过滤出可抽的候选池 */
export function buildPool(input: DrawInput): Place[] {
  const { places, region, filters = {} } = input;
  const cats = resolveCategories(input.categories, input.categoryIds);
  const catIds = new Set(cats.map((c) => c.id));
  const recent = new Set((input.recentPlaceIds ?? []).slice(0, filters.cooldown ?? 5));
  const visited = new Set(input.visitedPlaceIds ?? []);
  const cityPool = new Set(input.cityPool ?? [region.adcode]);

  return places.filter((p) => {
    const inScope =
      cityPool.has(p.cityAdcode) ||
      cityPool.has(p.regionAdcode) ||
      p.city === region.name;
    if (!inScope) return false;
    if (!catIds.has(p.categoryId)) return false;
    if (filters.excludeVisited && visited.has(p.id)) return false;
    if (filters.minRating != null && p.rating < filters.minRating) return false;
    if (filters.maxCost != null && p.cost > 0 && p.cost > filters.maxCost) return false;
    if (recent.has(p.id)) return false;
    return true;
  });
}

function weightOf(p: Place, cats: Map<string, Category>): number {
  const base = cats.get(p.categoryId)?.weight ?? 1;
  const ratingFactor = 0.5 + Math.max(0, Math.min(5, p.rating || 4)) / 5; // 4.5 -> 1.4
  const hasWhy = p.why ? 1.05 : 1;
  return base * ratingFactor * hasWhy;
}

/**
 * 生成转盘扇区并抽出赢家。
 * 设计要点：扇区大小反映权重（视觉上"机会更大"），但落点本身是加密均匀随机 ——
 * 保证公平不内定。扇区占比下限/上限收敛，避免出现针尖扇区看不清。
 */
export function draw(input: DrawInput): DrawResult | null {
  const rand = input.rand ?? ((n: number) => randomInt(n));
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const catsChosen = resolveCategories(input.categories, input.categoryIds);
  const pool = buildPool(input);
  if (pool.length === 0) return null;

  // 按权重降序取前 segmentCount 个；不足则全取（但至少 2 个才能成盘）
  const segCount = Math.max(2, Math.min(input.segmentCount ?? 10, 12));
  const sorted = [...pool].sort((a, b) => weightOf(b, cats) - weightOf(a, cats));
  let picked = sorted.slice(0, segCount);
  // 若候选超出，加一点随机性：从剩余里随机替换 1~2 个，避免每次都是同几家
  const rest = sorted.slice(segCount);
  if (rest.length > 0) {
    const swaps = Math.min(rest.length, Math.max(1, Math.round(segCount * 0.2)));
    for (let i = 0; i < swaps; i++) {
      const rp = rest[rand(rest.length)];
      const slot = rand(picked.length);
      if (rp && !picked.includes(rp)) picked[slot] = rp;
    }
  }
  if (picked.length < 2) {
    // 候选池只有 1 家：复制一份不同名的兄弟项让转盘仍可转（视觉需要）
    picked = [...pool];
  }

  const rawWeights = picked.map((p) => weightOf(p, cats));
  const total = rawWeights.reduce((s, w) => s + w, 0) || 1;
  const minShare = 0.04;
  const maxShare = 0.32;
  let shares = rawWeights.map((w) => w / total);
  for (let iter = 0; iter < 20; iter++) {
    shares = shares.map((s) => Math.max(minShare, Math.min(maxShare, s)));
    const sum = shares.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) < 1e-9) break;
    shares = shares.map((s) => s / sum);
    if (shares.every((s) => s >= minShare - 1e-9 && s <= maxShare + 1e-9)) break;
  }

  const segments: WheelSegment[] = picked.map((p, i) => ({
    placeId: p.id,
    name: p.name,
    weight: +rawWeights[i].toFixed(4),
    share: +shares[i].toFixed(6),
  }));

  // 落点：均匀随机（公平）—— 指针位置在 [0,1) 累加扇区占比定位
  const r = rand(1_000_000) / 1_000_000;
  let acc = 0;
  let winnerIndex = segments.length - 1;
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i].share;
    if (r < acc) { winnerIndex = i; break; }
  }
  const winner = picked[winnerIndex];

  return {
    city: input.region.name,
    regionAdcode: input.region.adcode,
    categoryIds: catsChosen.map((c) => c.id),
    segments,
    winnerIndex,
    place: winner,
    candidateCount: pool.length,
    poolCities: input.cityPool ?? [input.region.adcode],
    link: buildAmapLinks({
      name: winner.name,
      city: winner.city || input.region.name,
      lng: winner.lng,
      lat: winner.lat,
      amapPoiId: winner.amapPoiId,
    }),
  };
}

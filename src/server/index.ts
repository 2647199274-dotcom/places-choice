import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { loadCategories, ensureSeeded, getPlaces, getPlacesMulti, getRegions, getVisitedIds, getRecentDrawIds, recordDraw, markVisited, countPlaces, getCitySummaries } from '../db/index.ts';
import { draw, randomCategoryIds, resolveCategories } from '../core/draw.ts';
import { listAreas, buildMetroLinks, filterPlacesByAreas } from '../core/areas.ts';
import type { AreaDimension, DrawResult, Place } from '../core/types.ts';

const PORT = Number(process.env.PORT ?? 5178);
const HOST = '127.0.0.1';

const app = Fastify({ logger: { level: 'info' } });

function toClientPlace(p: Place, categories: ReturnType<typeof loadCategories>) {
  const cat = categories.find((c) => c.id === p.categoryId);
  return {
    ...p,
    categoryLabel: cat?.label ?? p.categoryId,
    categoryIcon: cat?.icon ?? '📍',
  };
}

await ensureSeeded();
const categories = loadCategories();
const counts = await countPlaces();
app.log.info(`数据就绪: ${counts.total} 个地点 / ${Object.keys(counts.byCity).join(',')}`);

app.get('/api/health', async () => ({ ok: true, ...counts }));

app.get('/api/categories', async () => ({
  categories,
  // 供前端做"随机项目"的权重池
  requiredIds: categories.filter((c) => c.required).map((c) => c.id),
}));

app.get('/api/regions', async () => {
  const regions = await getRegions();
  const cities = await getCitySummaries();
  const districts = regions.filter((r) => r.level === 3);
  // 省份聚合：按"库里真的有数据的城市"聚合（全国化后不能再写死浙江）
  const provinceMap = new Map<string, { adcode: string; name: string; cities: number; total: number }>();
  for (const c of cities) {
    const key = c.province || '其他';
    const adcode = `${c.adcode.slice(0, 2)}0000`;
    if (!provinceMap.has(key)) provinceMap.set(key, { adcode, name: key, cities: 0, total: 0 });
    const p = provinceMap.get(key)!;
    p.cities += 1;
    p.total += c.total;
  }
  // 有数据的省排在前面，便于前端默认选择
  const provinces = [...provinceMap.values()].sort((a, b) => b.total - a.total);
  return { cities, provinces, districts };
});

app.get('/api/cities', async () => ({ cities: await getCitySummaries() }));

/** 区域维度列表（模仿美团：地铁 / 地区 / 商场 / 商圈） */
app.get('/api/areas', async (req) => {
  const q = req.query as { city?: string; dimension?: string; categories?: string };
  const cityAdcode = q.city ?? '330100';
  const catIds = resolveCategories(categories, (q.categories ?? '').split(',').filter(Boolean)).map((c) => c.id);
  const dimensions: AreaDimension[] = ['district', 'businessArea', 'mall', 'metro'];
  const wanted = q.dimension ? (q.dimension as AreaDimension) : undefined;
  const out: Record<string, unknown> = { city: cityAdcode };
  for (const dim of wanted ? [wanted] : dimensions) {
    out[dim] = await listAreas(cityAdcode, dim, catIds.length ? catIds : undefined);
  }
  return out;
});

/** 重建 地点↔地铁站 关联（采集完地铁站后调用，或数据变化时刷新） */
app.post('/api/areas/rebuild-metro', async (req) => {
  const body = (req.body ?? {}) as { city?: string };
  const linked = await buildMetroLinks(body.city ?? '330100');
  return { ok: true, linked };
});

/**
 * 一次性导出完整数据集：前端首次加载后缓存到 localStorage，
 * 断网/后端不可达时用同一套抽签规则在本地转盘（APK 离线体验的基础）。
 */
app.get('/api/dataset', async () => {
  const [cities, regions] = await Promise.all([getCitySummaries(), getRegions()]);
  const allPlaces = await getPlacesMulti(cities.map((c) => c.adcode), categories.map((c) => c.id));
  // 省份聚合：按库里城市实际所属省份聚合（全国化后必须如此，不能写死浙江）
  const provinceMap = new Map<string, { adcode: string; name: string; cities: number; total: number }>();
  for (const c of cities) {
    const key = c.province || '其他';
    if (!provinceMap.has(key)) provinceMap.set(key, { adcode: `${c.adcode.slice(0, 2)}0000`, name: key, cities: 0, total: 0 });
    const p = provinceMap.get(key)!;
    p.cities += 1;
    p.total += c.total;
  }
  const provinces = [...provinceMap.values()].sort((a, b) => b.total - a.total);
  // 区域维度（地铁/地区/商场/商圈）也一并导出，离线时同样能按区域筛
  const areaDims: AreaDimension[] = ['district', 'businessArea', 'mall', 'metro'];
  const areas: Record<string, Record<string, unknown>> = {};
  for (const c of cities) {
    const per: Record<string, unknown> = {};
    for (const dim of areaDims) {
      const list = await listAreas(c.adcode, dim);
      if (list.length) per[dim] = list;
    }
    areas[c.adcode] = per;
  }
  return {
    generatedAt: new Date().toISOString(),
    categories,
    requiredIds: categories.filter((c) => c.required).map((c) => c.id),
    cities,
    provinces,
    districts: regions.filter((r) => r.level === 3),
    areas,
    places: allPlaces,
  };
});

app.get('/api/places', async (req) => {
  const q = req.query as { city?: string; categories?: string; minRating?: string; maxCost?: string };
  const regionAdcode = q.city ?? '330100';
  const catIds = resolveCategories(categories, (q.categories ?? '').split(',').filter(Boolean)).map((c) => c.id);
  const places = await getPlaces(regionAdcode, catIds);
  const minRating = q.minRating ? Number(q.minRating) : undefined;
  const maxCost = q.maxCost ? Number(q.maxCost) : undefined;
  return {
    city: regionAdcode,
    categoryIds: catIds,
    total: places.length,
    places: places
      .filter((p) => (minRating == null || p.rating >= minRating) && (maxCost == null || p.cost === 0 || p.cost <= maxCost))
      .map((p) => toClientPlace(p, categories)),
  };
});

/** 随机项目（含必选的吃饭类） */
app.get('/api/random-projects', async (req) => {
  const q = req.query as { count?: string };
  const count = Math.max(1, Math.min(5, Number(q.count ?? 3)));
  const ids = randomCategoryIds(categories, count, (n) => randomInt(n));
  return { categoryIds: ids, categories: categories.filter((c) => ids.includes(c.id)) };
});

app.post('/api/draw', async (req, reply) => {
  const body = (req.body ?? {}) as {
    region?: { adcode: string; name: string };
    /** scope: city=指定城市（默认）；randomCity=全省/全国随机一个城市；province=全省混抽 */
    scope?: 'city' | 'randomCity' | 'province';
    /** 限定省份（adcode 前两位，如 330000）；全国化后必须能指定，不能写死浙江 */
    provinceAdcode?: string;
    categoryIds?: string[];
    randomize?: boolean;
    randomCount?: number;
    segmentCount?: number;
    /** 区域维度选择（取交集）：地区/商圈/商场/地铁 */
    areas?: { dimension: AreaDimension; key: string }[];
    filters?: { excludeVisited?: boolean; minRating?: number; maxCost?: number };
  };

  const summaries = await getCitySummaries();
  const cityByAdcode = new Map(summaries.map((c) => [c.adcode, c]));

  let region = body.region ?? { adcode: '330100', name: '杭州市' };
  let cityPool: string[] = [region.adcode];
  let scope: string = body.scope ?? 'city';

  if (scope === 'randomCity' || scope === 'province') {
    // 只在"有数据的城市"里选，避免抽到空城
    // provinceAdcode：省份范围（全省随机/限定省份随机城市）；缺省时按传入城市所属省份推断
    const wantedProvince = body.provinceAdcode
      ?? (body.region?.adcode ? `${body.region.adcode.slice(0, 2)}0000` : undefined);
    const candidates = wantedProvince
      ? summaries.filter((c) => c.adcode.startsWith(wantedProvince.slice(0, 2)))
      : summaries;
    if (candidates.length === 0) {
      return reply.code(404).send({ error: 'NO_CITY', message: '所选范围内暂无任何城市数据' });
    }
    if (scope === 'province') {
      cityPool = candidates.map((c) => c.adcode);
      // 省份名不能写死：现在库里是全国数据，要用所选城市实际所属的省/自治区名
      const provinceName =
        candidates[0].province ||
        summaries.find((c) => c.adcode === (body.region?.adcode ?? ''))?.province ||
        '全省';
      region = { adcode: candidates[0].adcode.slice(0, 2) + '0000', name: `${provinceName}（全省随机）` };
    } else {
      const picked = candidates[randomInt(candidates.length)];
      region = { adcode: picked.adcode, name: picked.name };
      cityPool = [picked.adcode];
    }
  } else if (!cityByAdcode.has(region.adcode)) {
    return reply.code(404).send({ error: 'NO_CITY', message: `${region.name} 暂无数据，先跑采集器补齐` });
  }

  let categoryIds = body.categoryIds ?? [];
  if (body.randomize) {
    categoryIds = randomCategoryIds(categories, body.randomCount ?? 3, (n) => randomInt(n));
  }
  const chosen = resolveCategories(categories, categoryIds).map((c) => c.id);
  let places = await getPlacesMulti(cityPool, chosen);

  // 区域维度筛选（美团式）：地区 / 商圈 / 商场 / 地铁 多选取交集
  const areas = body.areas ?? [];
  if (areas.length > 0) {
    const areaFiltered = await filterPlacesByAreas(cityPool[0], areas, chosen);
    const keep = new Set(areaFiltered.map((p) => p.id));
    places = places.filter((p) => keep.has(p.id));
  }

  const [visited, recent] = await Promise.all([getVisitedIds(), getRecentDrawIds(5)]);

  const result = draw({
    region,
    cityPool,
    categoryIds: chosen,
    categories,
    places,
    visitedPlaceIds: visited,
    recentPlaceIds: recent,
    filters: body.filters ?? { excludeVisited: false },
    segmentCount: body.segmentCount ?? 10,
  });

  if (!result) {
    return reply.code(404).send({
      error: 'NO_CANDIDATE',
      message: `${region.name} 在所选项目下暂无数据。先跑采集器补齐，或换一个城市/项目。`,
      categoryIds: chosen,
    });
  }

  await recordDraw(result.place, chosen);
  const client: DrawResult & { placeDetail: unknown } = {
    ...result,
    placeDetail: toClientPlace(result.place, categories),
  };
  return client;
});

app.post('/api/visited', async (req) => {
  const body = (req.body ?? {}) as { placeId?: string; note?: string };
  if (!body.placeId) return { ok: false, error: 'placeId required' };
  await markVisited(body.placeId, body.note);
  return { ok: true };
});

// ---------- 静态前端（单端口访问：构建产物 web/dist） ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');

if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  await app.register(fastifyStatic, { root: WEB_DIST, index: ['index.html'] });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `未知接口 ${req.url}` });
    }
    return reply.sendFile('index.html');
  });
  app.log.info(`前端已挂载: ${WEB_DIST}  → 打开 http://${HOST}:${PORT}/`);
} else {
  app.get('/', async () => ({
    ok: true,
    hint: '前端尚未构建。运行 npm run build:web 生成 web/dist，或用 npm run web 启动 Vite 开发服务器 (5179)。',
    api: ['/api/health', '/api/categories', '/api/regions', '/api/places', '/api/random-projects', '/api/draw'],
  }));
}

app.listen({ port: PORT, host: HOST }).then(() => {
  app.log.info(`API 就绪: http://${HOST}:${PORT}/api/health`);
});

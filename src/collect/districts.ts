/**
 * 全国行政区划获取（P6）
 * 用高德官方 v3/config/district 拉"省 → 市"两级，结果缓存到 data/regions-cache.json，
 * 避免每次采集都重复请求（省配额、也更礼貌）。
 *
 * 注意：district 接口返回的区划里，直辖市（北京/上海/天津/重庆）level 是 province，
 * 其下直接是 district；本项目把直辖市本身当作"城市"处理（adcode 即城市码）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDistrict } from './amap.ts';
import type { CollectTarget } from './targets.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
export const REGION_CACHE = path.join(ROOT, 'data', 'regions-cache.json');

interface AmapDistrictNode {
  name: string;
  adcode: string;
  level: 'country' | 'province' | 'city' | 'district' | string;
  districts?: AmapDistrictNode[];
}

export interface ProvinceNode {
  name: string;
  adcode: string;
  cities: { name: string; adcode: string }[];
}

/** 直辖市：省级节点本身就是城市 */
const MUNICIPALITIES = new Set(['北京市', '上海市', '天津市', '重庆市']);

interface RegionCache {
  fetchedAt: string;
  source: 'amap';
  provinces: ProvinceNode[];
}

export function readRegionCache(): RegionCache | null {
  if (!fs.existsSync(REGION_CACHE)) return null;
  try {
    // 去掉可能的 UTF-8 BOM（PowerShell 的 Set-Content -Encoding UTF8 会写入 BOM，
    // 带 BOM 时 JSON.parse 会直接抛错，缓存就被静默忽略 → 白跑一次接口请求）
    const raw = fs.readFileSync(REGION_CACHE, 'utf8').replace(/^\uFEFF/, '');
    const c = JSON.parse(raw) as RegionCache;
    return c.provinces?.length ? c : null;
  } catch {
    return null;
  }
}

export function writeRegionCache(provinces: ProvinceNode[]) {
  fs.mkdirSync(path.dirname(REGION_CACHE), { recursive: true });
  const payload: RegionCache = { fetchedAt: new Date().toISOString(), source: 'amap', provinces };
  fs.writeFileSync(REGION_CACHE, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/** 把高德 district 响应归一化成"省 → 市"两级 */
export function normalizeDistricts(districts: AmapDistrictNode[]): ProvinceNode[] {
  const out: ProvinceNode[] = [];
  for (const d of districts) {
    if (d.level === 'country') {
      // 传 keywords=中国 时返回国家级，其 districts 才是省
      out.push(...normalizeDistricts(d.districts ?? []));
      continue;
    }
    if (d.level !== 'province') continue;
    const isMunicipality = MUNICIPALITIES.has(d.name);
    const cities = (d.districts ?? [])
      .filter((c) => c.level === 'city' || (isMunicipality && c.level === 'district'))
      .map((c) => ({ name: c.name, adcode: c.adcode }));
    out.push({
      name: d.name,
      adcode: d.adcode,
      // 直辖市自身作为城市；若其下没有 city 级节点，就用自己
      cities: cities.length ? cities : [{ name: d.name, adcode: d.adcode }],
    });
  }
  return out;
}

/**
 * 取全国省市两级。优先用缓存；无缓存且给了 key 时请求高德并写缓存。
 * @param opts.fresh 强制刷新缓存
 */
export async function getChinaProvinces(opts: {
  key?: string | null;
  fresh?: boolean;
  base?: string;
}): Promise<{ provinces: ProvinceNode[]; fromCache: boolean }> {
  if (!opts.fresh) {
    const cached = readRegionCache();
    if (cached) return { provinces: cached.provinces, fromCache: true };
  }
  if (!opts.key) {
    throw new Error(
      '需要 AMAP_KEY 才能从高德拉取全国行政区划（也可先提供 data/regions-cache.json 缓存文件）',
    );
  }
  const raw = (await fetchDistrict('中国', { key: opts.key, subdistrict: 2, base: opts.base })) as AmapDistrictNode[];
  const provinces = normalizeDistricts(raw);
  if (provinces.length === 0) throw new Error('高德行政区划返回为空，请检查 key 权限');
  writeRegionCache(provinces);
  return { provinces, fromCache: false };
}

/** 把省 → 市 两级展开成采集目标列表；可按省名过滤 */
export function provincesToTargets(
  provinces: ProvinceNode[],
  opts: { provinceFilter?: string; cityLimit?: number } = {},
): CollectTarget[] {
  const picked = opts.provinceFilter
    ? provinces.filter((p) => p.name === opts.provinceFilter || p.name.startsWith(opts.provinceFilter!.replace(/省|市|自治区/g, '')))
    : provinces;
  const targets: CollectTarget[] = [];
  for (const p of picked) {
    const cities = opts.cityLimit ? p.cities.slice(0, opts.cityLimit) : p.cities;
    for (const c of cities) targets.push({ cityName: c.name, cityAdcode: c.adcode, provinceName: p.name });
  }
  return targets;
}

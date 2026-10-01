/** 采集目标解析（独立模块，便于测试；不要放进 CLI 里，否则 import 会触发 Key 校验） */

export interface CollectTarget {
  cityName: string;
  cityAdcode: string;
  /** 所在省（全国采集时用于 --province 过滤与进度展示） */
  provinceName?: string;
}

export interface ResolveOptions {
  /** 当前库中已有数据的城市（--scope zhejiang 用） */
  cities: { name: string; adcode: string }[];
  /** 全国省市两级（--scope china 用，由 districts.ts 提供，可省略为不采集） */
  chinaTargets?: CollectTarget[];
}

/**
 * 解析要采集哪些城市：
 *  - 默认：单个城市（--city/--adcode）
 *  - --scope zhejiang：当前库中所有有数据的城市（浙江 11 市）
 *  - --scope china：全国所有城市（来自高德行政区划）
 */
export function resolveTargets(
  opts: ResolveOptions,
  args: Record<string, string | boolean>,
): CollectTarget[] {
  const scope = String(args.scope ?? 'city');

  if (scope === 'china') {
    const all = opts.chinaTargets ?? [];
    if (all.length === 0) {
      throw new Error('无法获取全国省市列表：需要 AMAP_KEY（或已有 data/regions-cache.json 缓存）');
    }
    // 支持 --province 限定某个省
    const pf = args.province ? String(args.province) : '';
    const filtered = pf
      ? all.filter((t) => t.cityName.startsWith(pf.replace(/省|市|自治区|壮族|回族|维吾尔/g, '')) || t.provinceName === pf)
      : all;
    const limit = args['city-limit'] ? Number(args['city-limit']) : 0;
    return limit > 0 ? filtered.slice(0, limit) : filtered;
  }

  if (scope === 'zhejiang' || scope === 'all-cities') {
    if (opts.cities.length === 0) return [{ cityName: '杭州市', cityAdcode: '330100' }];
    return opts.cities.map((c) => ({ cityName: c.name, cityAdcode: c.adcode }));
  }

  return [{ cityName: String(args.city ?? '杭州市'), cityAdcode: String(args.adcode ?? '330100') }];
}

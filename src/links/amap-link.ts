/**
 * 高德链接生成器（链接形态均已实测验证，见 docs/01-爬取可行性报告.md）
 * 三种形态：
 *  1. place  —— 有 poiid 时最优：https://www.amap.com/place/{poiid}
 *  2. uriSearch —— 兜底：任何条目都能生成，点开就是高德搜索该店
 *  3. marker / navi —— 坐标类：一键定位 / 一键导航（手机可唤起高德 App）
 */

export interface LinkInput {
  name: string;
  city: string;
  lng?: number | null;
  lat?: number | null;
  amapPoiId?: string | null;
}

export interface AmapLinks {
  /** 最优：高德 POI 详情页（需 poiid） */
  place: string | null;
  /** 兜底：高德 URI 搜索（无需任何 id） */
  uriSearch: string;
  /** 坐标标记点（可唤起 App） */
  marker: string | null;
  /** 导航链接 */
  navi: string | null;
  /** 页面主按钮应使用的链接，自动选最优 */
  primary: string;
  /** primary 的类型，前端可据此显示「打开高德详情页」/「在高德中搜索」 */
  primaryKind: 'place' | 'uriSearch';
}

const enc = encodeURIComponent;

export function buildAmapLinks(input: LinkInput): AmapLinks {
  const { name, city, lng, lat, amapPoiId } = input;
  const hasCoord = typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat);

  const place = amapPoiId ? `https://www.amap.com/place/${amapPoiId}` : null;
  const uriSearch = `https://uri.amap.com/search?keyword=${enc(name)}&city=${enc(city)}&view=map&callnative=0`;
  const marker = hasCoord
    ? `https://uri.amap.com/marker?position=${(lng as number).toFixed(6)},${(lat as number).toFixed(6)}&name=${enc(name)}&coordinate=gaode&callnative=1`
    : null;
  const navi = hasCoord
    ? `https://uri.amap.com/navigation?to=${(lng as number).toFixed(6)},${(lat as number).toFixed(6)},${enc(name)}&mode=car&policy=1&src=trip-roulette`
    : null;

  return {
    place,
    uriSearch,
    marker,
    navi,
    primary: place ?? uriSearch,
    primaryKind: place ? 'place' : 'uriSearch',
  };
}

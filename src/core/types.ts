export type PlaceSource = 'seed' | 'amap' | 'osm' | 'manual';

export interface Place {
  id: string;
  source: PlaceSource;
  name: string;
  categoryId: string;
  /** 市级 adcode（查询键：抽签按城市过滤用这个） */
  cityAdcode: string;
  /** 区县 adcode（高德返回的是区县级，用于展示与就近筛选） */
  regionAdcode: string;
  city: string;
  district: string;
  districtAdcode: string;
  address: string;
  lng: number;
  lat: number;
  rating: number;
  cost: number;
  why: string;
  amapPoiId: string | null;
  amapUrl: string | null;
  uriSearchUrl: string;
  markerUrl: string | null;
  naviUrl: string | null;
  coordPrecision: 'approx' | 'exact';
  fetchedAt: string;
}

export interface Category {
  id: string;
  label: string;
  icon: string;
  group: string;
  /** 吃饭类：人工选择与随机模式都必须包含 */
  required: boolean;
  weight: number;
  amapTypes: string;
  keywords: string[];
  desc: string;
}

export interface Region {
  adcode: string;
  name: string;
  level: number;
  parent: string;
  parentName: string;
}

export interface WheelSegment {
  placeId: string;
  name: string;
  weight: number;
  /** 该扇区占据的圆周比例（用于 Canvas 绘制） */
  share: number;
}

export interface DrawFilters {
  excludeVisited?: boolean;
  minRating?: number;
  maxCost?: number;
  /** 最近 N 次抽中过的不再出现，默认 5 */
  cooldown?: number;
}

export interface DrawResult {
  city: string;
  regionAdcode: string;
  categoryIds: string[];
  segments: WheelSegment[];
  /** 指针最终落在 segments 中的下标 */
  winnerIndex: number;
  place: Place;
  candidateCount: number;
  /** 本次候选来自哪些城市 adcode（全省随机时会有多个） */
  poolCities?: string[];
  link: {
    primary: string;
    primaryKind: 'place' | 'uriSearch';
    place: string | null;
    uriSearch: string;
    marker: string | null;
    navi: string | null;
  };
}

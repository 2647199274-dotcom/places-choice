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
  /** 高德商圈名，如「杭州新天地」（用于按商圈筛选区域） */
  businessArea?: string;
  /** 高德末级品类码，如 050117 */
  typecode?: string;
  tel?: string;
  opentime?: string;
  photo?: string;
}

/** 区域维度（"按地铁/地区/商场/商圈选"用的聚合结果） */
export type AreaDimension = 'district' | 'businessArea' | 'mall' | 'metro';

export interface AreaOption {
  /** 维度内唯一键（区县 adcode / 商圈名 / 商场 poiid / 地铁站名） */
  key: string;
  name: string;
  dimension: AreaDimension;
  /** 该区域在我们库里关联的地点数量 */
  placeCount: number;
  /** 中心坐标（商场/地铁有，区县/商圈为聚合中心） */
  lng?: number;
  lat?: number;
  /** 地铁：所属线路 */
  lines?: string[];
}

export interface Category {
  id: string;
  label: string;
  icon: string;
  group: string;
  /** true = 永远在列且不可取消（当前项目没有这种分类） */
  required: boolean;
  /** true = 随机抽项目时也必定包含（吃饭：保住"选项里一定有吃饭"，但人工选择时可取消） */
  alwaysInRandom?: boolean;
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

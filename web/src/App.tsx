import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, normalizePlaces, type ApiArea, type ApiCategory, type ApiCity, type ApiDrawResult, type ApiPlace,
  type ApiProvince, type AreaDimension, type AreaSelection, type DrawScope,
} from './api.ts';
import {
  addLocalRecent, addLocalVisited, datasetAgeLabel, loadDataset, localRecentIds, localVisitedIds, saveDataset,
  type CachedDataset,
} from './store.ts';
import { amapLinks, localDraw, randomCategoryIds } from './localDraw.ts';
import { Wheel } from './Wheel.tsx';

type Mode = 'manual' | 'random';

interface AppResult {
  segments: { placeId: string; name: string; share: number }[];
  winnerIndex: number;
  candidateCount: number;
  cityLabel: string;
  place: ApiPlace;
  link: { primary: string; primaryKind: 'place' | 'uriSearch'; place: string | null; uriSearch: string; marker: string | null; navi: string | null };
  poolCityCount: number;
  fromLocal: boolean;
}

/** 静态部署（含 GitHub Pages）的判断：页面路径不是根目录下的本地服务，或 URL 提示了 gh.io */
function staticHostLike(): boolean {
  if (typeof location === 'undefined') return false;
  return /\.github\.io$/.test(location.hostname);
}

const DIMENSIONS: { id: AreaDimension; label: string; icon: string }[] = [
  { id: 'metro', label: '地铁', icon: '🚇' },
  { id: 'district', label: '地区', icon: '🗺️' },
  { id: 'businessArea', label: '商圈', icon: '🏙️' },
  { id: 'mall', label: '商场', icon: '🛍️' },
];

export default function App() {
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [cities, setCities] = useState<ApiCity[]>([]);
  const [provinces, setProvinces] = useState<ApiProvince[]>([]);

  const [offline, setOffline] = useState(false);
  const [staticMode, setStaticMode] = useState(false);
  const [cacheLabel, setCacheLabel] = useState('');
  const [cachedAreas, setCachedAreas] = useState<Record<string, Record<string, ApiArea[]>>>({});
  const [stock, setStock] = useState(0);

  const [city, setCity] = useState<ApiCity | null>(null);
  const [activeProvince, setActiveProvince] = useState('');
  const [scope, setScope] = useState<DrawScope>('city');
  const [areas, setAreas] = useState<AreaSelection[]>([]);
  const [areaData, setAreaData] = useState<Record<string, ApiArea[]>>({});
  const [areaLoading, setAreaLoading] = useState(false);

  const [mode, setMode] = useState<Mode>('manual');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [randomCount, setRandomCount] = useState(3);
  const [excludeVisited, setExcludeVisited] = useState(false);
  const [maxCost, setMaxCost] = useState(0);
  const [minRating, setMinRating] = useState(0);

  const [result, setResult] = useState<AppResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visitedMsg, setVisitedMsg] = useState('');

  // 初始化：优先后端；失败则用本地缓存（离线/APK）
  useEffect(() => {
    (async () => {
      const apply = (d: CachedDataset, fromCache: boolean, isStatic = false) => {
        setCategories(d.categories);
        setCities(d.cities);
        setProvinces(d.provinces);
        setStock(d.places.length);
        // 项目默认全选
        setSelected(new Set(d.categories.map((c) => c.id)));
        setCity([...d.cities].sort((a, b) => b.total - a.total)[0] ?? null);
        setOffline(fromCache);
        setStaticMode(isStatic);
        setCacheLabel(datasetAgeLabel(d));
        if (d.areas) setCachedAreas(d.areas as Record<string, Record<string, ApiArea[]>>);
      };
      try {
        const d = await api.dataset();
        const cached: CachedDataset = {
          generatedAt: d.generatedAt, categories: d.categories, requiredIds: d.requiredIds,
          cities: d.cities, provinces: d.provinces, districts: d.districts,
          areas: d.areas as CachedDataset['areas'],
          places: normalizePlaces(d.places),   // 静态快照是精简格式，这里统一还原
        };
        // 落盘到 IndexedDB（2.8MB 的完整数据集 localStorage 装不下，会静默失败）
        await saveDataset(cached);
        // source=static 表示数据来自构建时导出的静态快照（GitHub Pages 部署），没有后端
        apply(cached, false, d.source === 'static' || d.source === 'seed');
      } catch {
        const local = await loadDataset();
        if (local) {
          // 两条路都不通（静态部署的后端 404 / 真离线）→ 用本地缓存数据
          apply(local, true, staticHostLike());
        } else {
          setError('连不上后端，且本地没有缓存数据。请先运行 npm run api，或联网打开一次以生成本地缓存。');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 拉取该城市的区域维度（按当前选中项目统计数量）
  useEffect(() => {
    if (!city) return;
    const catIds = [...selected];
    let cancelled = false;
    setAreaLoading(true);
    (async () => {
      try {
        const r = await api.areas(city.adcode, catIds);
        if (cancelled) return;
        setAreaData({
          district: r.district ?? [], businessArea: r.businessArea ?? [], mall: r.mall ?? [], metro: r.metro ?? [],
        });
      } catch {
        if (cancelled) return;
        const cached = cachedAreas[city.adcode];
        setAreaData(cached ? (cached as Record<string, ApiArea[]>) : {});
      } finally {
        if (!cancelled) setAreaLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // 项目变化会影响每个区域的候选数量，所以跟着刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.adcode, [...selected].sort().join(','), cachedAreas]);

  // 地区/区域/项目/过滤变化后作废上一盘
  useEffect(() => {
    if (!spinning) {
      setResult(null);
      setRevealed(false);
      setVisitedMsg('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.adcode, scope, mode, randomCount, maxCost, minRating, excludeVisited, areas, [...selected].sort().join(',')]);

  const requiredIds = useMemo(() => categories.filter((c) => c.required).map((c) => c.id), [categories]);

  /** 当前省份（默认取数据最多的省，通常就是用户所在区域） */
  const currentProvince = activeProvince || provinces[0]?.adcode || '';
  const visibleCities = useMemo(
    () => (currentProvince
      ? cities.filter((c) => c.adcode.startsWith(currentProvince.slice(0, 2)))
      : cities),
    [cities, currentProvince],
  );
  const grouped = useMemo(() => {
    const g = new Map<string, ApiCategory[]>();
    for (const c of categories) {
      if (!g.has(c.group)) g.set(c.group, []);
      g.get(c.group)!.push(c);
    }
    return [...g.entries()];
  }, [categories]);

  const allSelected = categories.length > 0 && categories.every((c) => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(categories.map((c) => c.id)));

  const toggleCategory = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleArea = (dimension: AreaDimension, key: string, name: string) => {
    setAreas((prev) => {
      const hit = prev.find((a) => a.dimension === dimension && a.key === key);
      if (hit) return prev.filter((a) => !(a.dimension === dimension && a.key === key));
      return [...prev, { dimension, key, name }];
    });
  };

  const currentAreas = (dim: AreaDimension): AreaSelection[] => areas.filter((a) => a.dimension === dim);

  const pickRandomCity = () => {
    if (cities.length <= 1) return;
    const others = cities.filter((c) => c.adcode !== city?.adcode);
    setCity(others[Math.floor(Math.random() * others.length)]);
    setScope('city');
    setAreas([]);
  };

  const pickRandomProjects = async () => {
    try {
      const r = await api.randomProjects(randomCount);
      setSelected(new Set(r.categoryIds));
    } catch {
      setSelected(new Set(randomCategoryIds(categories, randomCount)));
    }
    setMode('random');
  };

  const spin = useCallback(async () => {
    if (spinning) return;
    if (scope === 'city' && !city) return;
    setError('');
    setVisitedMsg('');
    setSpinning(true);
    setRevealed(false);

    const filters = { excludeVisited, maxCost: maxCost || undefined, minRating: minRating || undefined };
    const prov = provinces.find((p) => p.adcode === currentProvince) ?? provinces[0];
    const region = scope === 'province'
      ? { adcode: prov?.adcode ?? '330000', name: prov?.name ?? '全省' }
      : { adcode: city?.adcode ?? prov?.adcode ?? '330100', name: city?.name ?? '杭州市' };
    const areaPayload = areas.map((a) => ({ dimension: a.dimension, key: a.key }));
    const catIds = mode === 'manual' ? [...selected] : [];

    try {
      const res: ApiDrawResult = await api.draw({
        region, scope, provinceAdcode: prov?.adcode, categoryIds: catIds,
        randomize: mode === 'random' || scope !== 'city',
        randomCount, filters, segmentCount: 10, areas: areaPayload,
      });
      setResult({
        segments: res.segments, winnerIndex: res.winnerIndex, candidateCount: res.candidateCount,
        cityLabel: res.city, place: res.placeDetail, link: res.link,
        poolCityCount: res.poolCities?.length ?? 1, fromLocal: false,
      });
      return;
    } catch (e) {
      const cached = await loadDataset();
      if (!cached) {
        setSpinning(false);
        setError((e as Error).message);
        return;
      }
      // 离线：本地引擎（区域过滤按 商圈/区县 名称匹配，地铁/商场用取交集后的粗略范围）
      const chosenCat = mode === 'random' || scope !== 'city'
        ? randomCategoryIds(cached.categories, randomCount)
        : [...selected];
      let pool: string[] = scope === 'city' ? [region.adcode] : cached.cities.map((c) => c.adcode);
      if (scope === 'randomCity') {
        const pick = cached.cities[Math.floor(Math.random() * cached.cities.length)];
        pool = [pick.adcode];
        region.adcode = pick.adcode;
        region.name = pick.name;
      }
      const local = localDraw({
        places: cached.places, categories: cached.categories, cityPool: pool, categoryIds: chosenCat,
        recentPlaceIds: localRecentIds(), visitedPlaceIds: localVisitedIds(), filters, segmentCount: 10,
        areas: areas.length ? areas : undefined,
      });
      if (!local) {
        setSpinning(false);
        setError('本地缓存里没有符合条件的候选，换城市/项目/区域，或联网同步最新数据。');
        return;
      }
      addLocalRecent(local.place.id);
      setOffline(true);
      setResult({
        segments: local.segments, winnerIndex: local.winnerIndex, candidateCount: local.candidateCount,
        cityLabel: scope === 'province' ? `${region.name}（全省随机）` : local.place.city,
        place: local.place, link: amapLinks(local.place), poolCityCount: local.poolCities.length, fromLocal: true,
      });
    }
  }, [city, scope, mode, selected, randomCount, excludeVisited, maxCost, minRating, spinning, provinces, areas]);

  const onSpinEnd = useCallback(() => {
    setSpinning(false);
    setRevealed(true);
  }, []);

  const markVisited = async () => {
    if (!result) return;
    addLocalVisited(result.place.id);
    try { await api.markVisited(result.place.id, '转盘抽中去过'); } catch { /* 离线只存本地 */ }
    setVisitedMsg('已记入「去过」🌱');
  };

  const chosenCats = categories.filter((c) => selected.has(c.id));
  const scopeLabel =
    scope === 'city' ? city?.name ?? '—'
      : scope === 'randomCity' ? '随机城市 🎲'
        : `${provinces.find((p) => p.adcode === currentProvince)?.name ?? '全省'}全省随机 🎲`;

  const withCatLabel = (p: ApiPlace): ApiPlace => {
    if (p.categoryLabel && p.categoryIcon) return p;
    const c = categories.find((x) => x.id === p.categoryId);
    return { ...p, categoryLabel: c?.label ?? p.categoryId, categoryIcon: c?.icon ?? '📍' };
  };
  const shownPlace = result ? withCatLabel(result.place) : null;

  if (loading) {
    return <div className="app"><div className="loading">🎡 正在加载地点数据…</div></div>;
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-title">
          <span className="logo">🎡</span>
          <div>
            <h1>出去玩 · 地点选择转盘</h1>
            <p className="sub">
              选地区 + 选项目 → 转一下，落到哪家就去哪家
              <span className="badge">{cities.length} 市 · {stock} 个地点</span>
              <span className={`badge ${offline || staticMode ? 'warn' : 'ok'}`}>
                {offline
                  ? `📴 离线（缓存 ${cacheLabel}）`
                  : staticMode
                    ? `📦 静态数据（${cacheLabel}）`
                    : '🌐 在线'}
              </span>
            </p>
          </div>
        </div>
      </header>

      {error && <div className="alert">⚠️ {error}</div>}

      <main className="layout">
        <section className="panel">
          {/* ① 地区 */}
          <div className="block">
            <div className="block-head">
              <h2>① 地区</h2>
              <div className="seg">
                <button className={scope === 'city' ? 'on' : ''} onClick={() => setScope('city')}>选城市</button>
                <button className={scope === 'randomCity' ? 'on' : ''} onClick={() => { setScope('randomCity'); setAreas([]); }}>随机城市</button>
                <button className={scope === 'province' ? 'on' : ''} onClick={() => { setScope('province'); setAreas([]); }}>全省随机</button>
              </div>
            </div>

            {scope === 'city' ? (
              <>
                {/* 有多个省时先选省，再选市（全国数据不能只列城市） */}
                {provinces.length > 1 && (
                  <div className="chips province-row">
                    {provinces.map((p) => (
                      <button
                        key={p.adcode}
                        className={`chip small ${activeProvince === p.adcode ? 'on' : ''}`}
                        onClick={() => {
                          setActiveProvince(p.adcode);
                          const first = cities.find((c) => c.adcode.startsWith(p.adcode.slice(0, 2)));
                          if (first) { setCity(first); setAreas([]); }
                        }}
                      >
                        {p.name}
                        <em className="chip-count">{p.total}</em>
                      </button>
                    ))}
                  </div>
                )}
                <div className="chips">
                  {visibleCities.map((c) => (
                    <button
                      key={c.adcode}
                      className={`chip ${city?.adcode === c.adcode ? 'on' : ''}`}
                      onClick={() => { setCity(c); setAreas([]); }}
                      data-places={c.total}
                    >
                      {c.name}
                      <em className="chip-count">{c.total}</em>
                    </button>
                  ))}
                  <button className="chip ghost-chip" onClick={pickRandomCity}>🎲 随机换一个</button>
                </div>

                {/* 美团式区域筛选：地铁 / 地区 / 商圈 / 商场，可折叠 */}
                <div className="area-dims">
                  {DIMENSIONS.map((dim) => {
                    const list = areaData[dim.id] ?? [];
                    const picked = currentAreas(dim.id);
                    return (
                      <details key={dim.id} className="area-dim" open={dim.id === 'metro'}>
                        <summary>
                          <span className="area-label">{dim.icon} {dim.label}</span>
                          <span className="area-state">
                            {picked.length > 0 ? `已选 ${picked.length}` : '不限'}
                            {list.length > 0 && <em className="chip-count">{list.length}</em>}
                          </span>
                        </summary>
                        <div className="area-body">
                          {areaLoading && list.length === 0 && <span className="hint">加载中…</span>}
                          {!areaLoading && list.length === 0 && <span className="hint">暂无数据</span>}
                          {list.slice(0, 40).map((a) => {
                            const on = picked.some((p) => p.key === a.key);
                            return (
                              <button
                                key={`${dim.id}:${a.key}`}
                                className={`chip small ${on ? 'on' : ''}`}
                                onClick={() => toggleArea(dim.id, a.key, a.name)}
                                title={`${a.name}：${a.placeCount} 个候选`}
                              >
                                {a.name}
                                <em className="chip-count">{a.placeCount}</em>
                              </button>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>

                {areas.length > 0 && (
                  <div className="area-picked">
                    {areas.map((a) => (
                      <button key={`${a.dimension}:${a.key}`} className="tag" onClick={() => toggleArea(a.dimension, a.key, a.name)}>
                        {a.name} ✕
                      </button>
                    ))}
                    <button className="tag clear" onClick={() => setAreas([])}>清空区域</button>
                  </div>
                )}
              </>
            ) : (
              <p className="hint">
                {scope === 'randomCity'
                  ? `从 ${cities.length} 个城市里随机抽一个再转`
                  : `在 ${provinces.find((p) => p.adcode === currentProvince)?.name ?? '全省'} ${visibleCities.length} 个城市里混抽`}
              </p>
            )}
          </div>

          {/* ② 项目 */}
          <div className="block">
            <div className="block-head">
              <h2>② 项目</h2>
              <div className="seg">
                <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>人工选</button>
                <button className={mode === 'random' ? 'on' : ''} onClick={() => setMode('random')}>随机抽</button>
              </div>
            </div>

            {mode === 'manual' ? (
              <>
                <div className="select-all">
                  <label className="switch">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    <span>全选</span>
                  </label>
                  <span className="count">已选 {chosenCats.length}/{categories.length}</span>
                </div>
                <div className="cat-groups">
                  {grouped.map(([group, cats]) => (
                    <details key={group} className="cat-group" open>
                      <summary>
                        <span className="area-label">{group}</span>
                        <span className="area-state">{cats.filter((c) => selected.has(c.id)).length}/{cats.length}</span>
                      </summary>
                      <div className="chips">
                        {cats.map((c) => (
                          <button
                            key={c.id}
                            className={`chip small ${selected.has(c.id) ? 'on' : ''}`}
                            onClick={() => toggleCategory(c.id)}
                          >
                            {c.icon} {c.label}
                          </button>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </>
            ) : (
              <div className="random-box">
                <label>
                  随机项目个数：<b>{randomCount}</b>
                  <input type="range" min={1} max={5} value={randomCount} onChange={(e) => setRandomCount(Number(e.target.value))} />
                </label>
                <button className="primary small" onClick={pickRandomProjects}>🎲 抽一组看看</button>
              </div>
            )}
          </div>

          {/* ③ 过滤 */}
          <div className="block">
            <div className="block-head"><h2>③ 过滤</h2></div>
            <div className="filters">
              <label className="switch">
                <input type="checkbox" checked={excludeVisited} onChange={(e) => setExcludeVisited(e.target.checked)} />
                <span>排除已去过</span>
              </label>
              <label>
                人均 ≤ <b>{maxCost === 0 ? '不限' : `¥${maxCost}`}</b>
                <input type="range" min={0} max={600} step={20} value={maxCost} onChange={(e) => setMaxCost(Number(e.target.value))} />
              </label>
              <label>
                评分 ≥ <b>{minRating === 0 ? '不限' : minRating.toFixed(1)}</b>
                <input type="range" min={0} max={4.8} step={0.1} value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} />
              </label>
            </div>
          </div>

          <div className="cta">
            <div className="picked">
              {scopeLabel}
              {areas.length > 0 && ` · ${areas.map((a) => a.name).join(' ∩ ')}`}
              {mode === 'manual' ? ` · ${chosenCats.length} 个项目（默认全选）` : ` · 随机 ${randomCount} 个项目`}
            </div>
            <button className="primary" onClick={spin} disabled={(scope === 'city' && !city) || spinning}>
              {spinning ? '转动中…' : '🎡 开始转动'}
            </button>
          </div>
        </section>

        <section className="stage">
          <Wheel
            segments={result?.segments ?? []}
            winnerIndex={result?.winnerIndex ?? null}
            spinning={spinning}
            onSpinEnd={onSpinEnd}
          />

          <div className="stage-meta">
            {result ? (
              <>
                候选 <b>{result.candidateCount}</b> 家 · {result.segments.length} 扇区 · {result.cityLabel}
                {result.poolCityCount > 1 && <> · {result.poolCityCount} 城</>}
                {result.fromLocal && <> · 本地计算</>}
              </>
            ) : (
              <>选好地区和项目，点击转动</>
            )}
          </div>

          {result && revealed && shownPlace && (
            <div className="result">
              <div className="result-head">
                <span className="result-icon">{shownPlace.categoryIcon}</span>
                <div>
                  <h3>{shownPlace.name}</h3>
                  <p className="result-meta">
                    {shownPlace.categoryLabel} · {shownPlace.city}
                    {shownPlace.district ? `·${shownPlace.district}` : ''}
                    {shownPlace.businessArea ? ` · ${shownPlace.businessArea}` : ''}
                    {shownPlace.rating > 0 && <> · ⭐ {shownPlace.rating}</>}
                    {shownPlace.cost > 0 && <> · 人均 ¥{shownPlace.cost}</>}
                  </p>
                </div>
              </div>
              {shownPlace.why && <p className="result-why">💡 {shownPlace.why}{shownPlace.opentime ? ` · ${shownPlace.opentime}` : ''}</p>}
              <div className="result-actions">
                <a className="primary" href={result.link.primary} target="_blank" rel="noreferrer">
                  {result.link.primaryKind === 'place' ? '📍 高德详情页' : '📍 在高德中搜索'}
                </a>
                {result.link.navi && <a className="ghost" href={result.link.navi} target="_blank" rel="noreferrer">🧭 导航</a>}
                <button className="ghost" onClick={markVisited}>✅ 就去这家</button>
                <button className="ghost" onClick={spin}>🔄 再转一次</button>
              </div>
              {visitedMsg && <p className="ok">{visitedMsg}</p>}
            </div>
          )}
        </section>
      </main>

      <footer className="foot">
        地点数据来自高德开放平台 · 点击结果卡可直接跳转高德查看与导航
        {staticMode && <> · 当前为静态数据快照（无后端），转盘在本地计算</>}
        {offline && !staticMode && <> · 当前离线，使用本地缓存数据（{cacheLabel}）</>}
      </footer>
    </div>
  );
}

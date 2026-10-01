import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ApiCategory, type ApiCity, type ApiDrawResult, type ApiPlace, type ApiProvince, type DrawScope } from './api.ts';
import {
  addLocalRecent, addLocalVisited, datasetAgeLabel, loadDataset, localRecentIds, localVisitedIds, saveDataset,
  type CachedDataset,
} from './store.ts';
import { amapLinks, localDraw } from './localDraw.ts';
import { Wheel } from './Wheel.tsx';

type Mode = 'manual' | 'random';

/** 结果卡统一结构：后端抽签与本地抽签都能填满 */
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

export default function App() {
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [cities, setCities] = useState<ApiCity[]>([]);
  const [provinces, setProvinces] = useState<ApiProvince[]>([]);
  const [districts, setDistricts] = useState<{ adcode: string; name: string; parent: string }[]>([]);
  const [stock, setStock] = useState(0);
  const [offline, setOffline] = useState(false);
  const [cacheLabel, setCacheLabel] = useState('');
  const cachedRef = useRef<CachedDataset | null>(null);

  const [city, setCity] = useState<ApiCity | null>(null);
  const [scope, setScope] = useState<DrawScope>('city');
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

  // 初始化：优先后端；失败则回退本地缓存（离线/APK 场景）
  useEffect(() => {
    (async () => {
      const applyData = (d: CachedDataset, fromCache: boolean) => {
        setCategories(d.categories);
        setCities(d.cities);
        setProvinces(d.provinces);
        setDistricts(d.districts);
        setStock(d.places.length);
        setSelected((prev) => (prev.size ? prev : new Set(d.requiredIds)));
        setCity((prev) => prev ?? [...d.cities].sort((a, b) => b.total - a.total)[0] ?? null);
        setOffline(fromCache);
        setCacheLabel(datasetAgeLabel(d));
      };

      try {
        // 一次请求拿全量数据集（顺手写缓存，供离线用）
        const d = await api.dataset();
        const cached: CachedDataset = {
          generatedAt: d.generatedAt, categories: d.categories, requiredIds: d.requiredIds,
          cities: d.cities, provinces: d.provinces, districts: d.districts, places: d.places,
        };
        saveDataset(cached);
        cachedRef.current = cached;
        applyData(cached, false);
      } catch {
        const local = loadDataset();
        if (local) {
          cachedRef.current = local;
          applyData(local, true);
        } else {
          setError('无法连接后端，且本地没有缓存数据。请先运行 npm run api，或联网打开一次以生成本地缓存。');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const requiredIds = useMemo(() => categories.filter((c) => c.required).map((c) => c.id), [categories]);

  // 换了地区/项目/过滤条件后，上一盘的转盘和结果就作废
  useEffect(() => {
    if (!spinning) {
      setResult(null);
      setRevealed(false);
      setVisitedMsg('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.adcode, scope, mode, randomCount, maxCost, minRating, excludeVisited, [...selected].sort().join(',')]);

  const visibleDistricts = useMemo(
    () => (city ? districts.filter((d) => d.parent === city.adcode) : []),
    [city, districts],
  );

  const grouped = useMemo(() => {
    const g = new Map<string, ApiCategory[]>();
    for (const c of categories) {
      if (!g.has(c.group)) g.set(c.group, []);
      g.get(c.group)!.push(c);
    }
    return [...g.entries()];
  }, [categories]);

  const availableCats = useMemo(() => {
    if (scope !== 'city' || !city) return null;
    return new Set(city.categories);
  }, [scope, city]);

  const toggle = (id: string) => {
    if (requiredIds.includes(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickRandomCity = () => {
    if (cities.length <= 1) return;
    const others = cities.filter((c) => c.adcode !== city?.adcode);
    setCity(others[Math.floor(Math.random() * others.length)]);
    setScope('city');
  };

  const pickRandomProjects = async () => {
    try {
      const r = await api.randomProjects(randomCount);
      setSelected(new Set(r.categoryIds));
    } catch {
      // 离线：用本地规则随机（与后端同一套权重逻辑）
      const { randomCategoryIds } = await import('./localDraw.ts');
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
    const region = scope === 'province'
      ? { adcode: provinces[0]?.adcode ?? '330000', name: provinces[0]?.name ?? '全省' }
      : { adcode: city?.adcode ?? '330100', name: city?.name ?? '杭州市' };

    // 1) 优先后端（共享足迹/冷却历史）
    try {
      const res: ApiDrawResult = await api.draw({
        region, scope,
        categoryIds: mode === 'random' ? [] : [...selected],
        randomize: mode === 'random' || scope !== 'city',
        randomCount,
        filters,
        segmentCount: 10,
      });
      setResult({
        segments: res.segments,
        winnerIndex: res.winnerIndex,
        candidateCount: res.candidateCount,
        cityLabel: res.city,
        place: res.placeDetail,
        link: res.link,
        poolCityCount: res.poolCities?.length ?? 1,
        fromLocal: false,
      });
      return;
    } catch (e) {
      // 2) 后端不可用（离线/APK）：用本地缓存数据集 + 同规则本地抽签
      const cached = cachedRef.current ?? loadDataset();
      if (!cached) {
        setSpinning(false);
        setError((e as Error).message);
        return;
      }
      const { randomCategoryIds } = await import('./localDraw.ts');
      const categoryIds = mode === 'random' || scope !== 'city'
        ? randomCategoryIds(cached.categories, randomCount)
        : [...selected];

      let pool: string[];
      if (scope === 'city') {
        pool = [region.adcode];
      } else if (scope === 'randomCity') {
        const pick = cached.cities[Math.floor(Math.random() * cached.cities.length)];
        pool = [pick.adcode];
        region.adcode = pick.adcode;
        region.name = pick.name;
      } else {
        pool = cached.cities.map((c) => c.adcode);
      }

      const local = localDraw({
        places: cached.places,
        categories: cached.categories,
        cityPool: pool,
        categoryIds,
        recentPlaceIds: localRecentIds(),
        visitedPlaceIds: localVisitedIds(),
        filters,
        segmentCount: 10,
      });
      if (!local) {
        setSpinning(false);
        setError('本地缓存里没有符合条件的候选，请换城市/项目，或联网同步最新数据。');
        return;
      }
      addLocalRecent(local.place.id);
      setOffline(true);
      setCacheLabel(datasetAgeLabel(cached));
      setResult({
        segments: local.segments,
        winnerIndex: local.winnerIndex,
        candidateCount: local.candidateCount,
        cityLabel: scope === 'province' ? `${region.name}（全省随机）` : local.place.city,
        place: local.place,
        link: amapLinks(local.place),
        poolCityCount: local.poolCities.length,
        fromLocal: true,
      });
    }
  }, [city, scope, mode, selected, randomCount, excludeVisited, maxCost, minRating, spinning, provinces]);

  const onSpinEnd = useCallback(() => {
    setSpinning(false);
    setRevealed(true);
  }, []);

  const markVisited = async () => {
    if (!result) return;
    addLocalVisited(result.place.id);
    try {
      await api.markVisited(result.place.id, '转盘抽中去过');
    } catch {
      // 离线也要记上（只存本地）
    }
    setVisitedMsg('已标记为去过，下次选「排除已去过」就不会再抽到它 🌱');
  };

  const chosenCats = categories.filter((c) => selected.has(c.id));
  // 离线时数据集里的地点没有 categoryLabel/Icon（那是后端为单条结果补的），这里本地补齐
  const withCatLabel = (p: ApiPlace): ApiPlace => {
    if (p.categoryLabel && p.categoryIcon) return p;
    const c = categories.find((x) => x.id === p.categoryId);
    return { ...p, categoryLabel: c?.label ?? p.categoryId, categoryIcon: c?.icon ?? '📍' };
  };
  const shownPlace = result ? withCatLabel(result.place) : null;
  const scopeLabel =
    scope === 'city' ? city?.name ?? '—'
      : scope === 'randomCity' ? '随机城市 🎲'
        : `${provinces[0]?.name ?? '全省'}全省随机 🎲`;

  if (loading) {
    return (
      <div className="app">
        <div className="loading">🎡 正在加载地点数据…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-title">
          <span className="logo">🎡</span>
          <div>
            <h1>出去玩 · 地点选择转盘</h1>
            <p className="sub">
              选地区 + 选项目 → 转一下，落到哪家就去哪家 · 数据源：高德开放平台
              <span className="badge">{cities.length} 市 · {stock} 个地点</span>
              <span className={`badge ${offline ? 'warn' : 'ok'}`}>
                {offline ? `📴 离线模式（本地缓存 · ${cacheLabel}）` : '🌐 已连接后端'}
              </span>
            </p>
          </div>
        </div>
      </header>

      {error && <div className="alert">⚠️ {error}</div>}

      <main className="layout">
        <section className="panel">
          <div className="block">
            <div className="block-head">
              <h2>① 选地区</h2>
              <div className="seg">
                <button className={scope === 'city' ? 'on' : ''} onClick={() => setScope('city')}>选城市</button>
                <button className={scope === 'randomCity' ? 'on' : ''} onClick={() => setScope('randomCity')}>随机城市</button>
                <button className={scope === 'province' ? 'on' : ''} onClick={() => setScope('province')}>全省随机</button>
              </div>
            </div>

            {scope === 'city' ? (
              <>
                <div className="chips">
                  {cities.map((c) => (
                    <button
                      key={c.adcode}
                      className={`chip ${city?.adcode === c.adcode ? 'on' : ''}`}
                      onClick={() => setCity(c)}
                      data-places={c.total}
                    >
                      {c.name}
                      <em className="chip-count">{c.total}</em>
                    </button>
                  ))}
                </div>
                <div className="block-head" style={{ marginTop: 10 }}>
                  <span className="hint" style={{ margin: 0 }}>
                    共 {cities.reduce((s, c) => s + c.total, 0)} 个地点
                    {provinces.length > 1 && <> · 覆盖 {provinces.map((p) => p.name).join('、')}</>}
                  </span>
                  <button className="ghost" onClick={pickRandomCity}>🎲 随机换一个</button>
                </div>
                {visibleDistricts.length > 0 && (
                  <p className="hint">覆盖区县：{visibleDistricts.map((d) => d.name).join(' · ')}</p>
                )}
              </>
            ) : (
              <p className="hint">
                {scope === 'randomCity'
                  ? `🎲 从 ${cities.length} 个有数据的城市里随机抽一个，再用该城市的数据转盘（不会抽到没数据的城市）`
                  : `🎲 在 ${provinces[0]?.name ?? '全省'}全部 ${cities.length} 个城市的候选里混抽，抽中哪座城市就去哪`}
              </p>
            )}
          </div>

          <div className="block">
            <div className="block-head">
              <h2>② 选项目</h2>
              <div className="seg">
                <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>人工选</button>
                <button className={mode === 'random' ? 'on' : ''} onClick={() => setMode('random')}>随机抽</button>
              </div>
            </div>

            {mode === 'random' ? (
              <div className="random-box">
                <label>
                  随机项目个数：<b>{randomCount}</b>
                  <input
                    type="range" min={1} max={5} value={randomCount}
                    onChange={(e) => setRandomCount(Number(e.target.value))}
                  />
                </label>
                <p className="hint">🍜 吃饭为必选项，任何模式下都会包含</p>
                <button className="primary small" onClick={pickRandomProjects}>🎲 抽一组项目看看</button>
              </div>
            ) : (
              <>
                <p className="hint">
                  🍜 吃饭为必选项，不可取消；其余可多选
                  {availableCats && <>（灰显=该城市暂无数据）</>}
                </p>
                {grouped.map(([group, cats]) => (
                  <div key={group} className="group">
                    <span className="group-name">{group}</span>
                    <div className="chips">
                      {cats.map((c) => {
                        const on = selected.has(c.id);
                        const locked = requiredIds.includes(c.id);
                        const empty = !!availableCats && !availableCats.has(c.id) && !locked;
                        return (
                          <button
                            key={c.id}
                            className={`chip ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${empty ? 'empty' : ''}`}
                            onClick={() => toggle(c.id)}
                            title={locked ? '吃饭为必选项' : empty ? '该城市暂无此类数据（可先跑采集器）' : c.desc}
                          >
                            {c.icon} {c.label}{locked && ' 🔒'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="block">
            <div className="block-head"><h2>③ 过滤（可选）</h2></div>
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
              当前：<b>{scopeLabel}</b> ·{' '}
              {mode === 'random'
                ? `随机 ${randomCount} 个项目（含吃饭）`
                : `${chosenCats.length} 个项目：${chosenCats.map((c) => c.icon + c.label).join(' ')}`}
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
                候选池 <b>{result.candidateCount}</b> 家 · 上盘 {result.segments.length} 个扇区 · {result.cityLabel}
                {result.poolCityCount > 1 && <> · 横跨 {result.poolCityCount} 个城市</>}
                {result.fromLocal && <> · 本地计算</>}
              </>
            ) : (
              <>选好地区和项目，点「开始转动」</>
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
                    {shownPlace.rating > 0 && <> · ⭐ {shownPlace.rating}</>}
                    {shownPlace.cost > 0 && <> · 人均 ¥{shownPlace.cost}</>}
                  </p>
                </div>
              </div>
              {shownPlace.why && <p className="result-why">💡 {shownPlace.why}</p>}
              <div className="result-actions">
                <a className="primary" href={result.link.primary} target="_blank" rel="noreferrer">
                  {result.link.primaryKind === 'place' ? '📍 在高德打开详情页' : '📍 在高德中搜索这家'}
                </a>
                {result.link.navi && (
                  <a className="ghost" href={result.link.navi} target="_blank" rel="noreferrer">🧭 一键导航</a>
                )}
                <button className="ghost" onClick={markVisited}>✅ 就去这家</button>
                <button className="ghost" onClick={spin}>🔄 再转一次</button>
              </div>
              {result.place.coordPrecision === 'approx' && (                <p className="hint tiny">
                  注：当前为种子数据的近似坐标；配置高德 Key 并采集后会自动升级为精确 poiid 与坐标。
                </p>
              )}
              {visitedMsg && <p className="ok">{visitedMsg}</p>}
            </div>
          )}
        </section>
      </main>

      <footer className="foot">
        数据来源：高德开放平台 Web 服务 API（地点）· 小红书/大众点评等平台反爬严格，改为「打开原站搜索」外链
        {offline && <> · 当前离线，使用本地缓存数据（{cacheLabel}）</>}
      </footer>
    </div>
  );
}

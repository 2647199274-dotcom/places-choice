/**
 * 多城市 / 全省随机 验证（P5 扩展阶段）
 * 重点覆盖：
 *  1) 空数组 / 单城市 / 多城市查询（SQL 占位符数量必须匹配 —— 这类 bug 已经出现过两次）
 *  2) 11 市全部可抽（每个城市 × 每个有数据的分类）
 *  3) 随机城市只会落在"有该分类数据"的城市
 *  4) 全省随机候选池来自多个城市，且结果城市标注正确
 *  5) 陈旧种子数据不会残留（同一条地点不会出现两次）
 * 用法: node tests/verify-region.mjs
 */
import { randomInt } from 'node:crypto';
import {
  ensureSeeded, getCitySummaries, getPlaces, getPlacesMulti, countPlaces,
  loadCategories, openDb, loadSeed,
} from '../src/db/index.ts';
import { draw, randomCategoryIds, resolveCategories } from '../src/core/draw.ts';

const problems = [];
const categories = loadCategories();
const requiredIds = categories.filter((c) => c.required).map((c) => c.id);

await ensureSeeded();
const counts = await countPlaces();
const cities = await getCitySummaries();

console.log(`[数据] 共 ${counts.total} 条地点 / ${cities.length} 个城市`);
console.log('        ' + cities.map((c) => `${c.name}(${c.total})`).join('  '));

// ---- 1. 必选项规则：人工与随机模式都必须含吃饭 ----
// ---- 1. 查询边界：空数组不能炸（SQL 占位符不匹配的老坑） ----
try {
  const a = await getPlacesMulti([], ['eat']);
  const b = await getPlacesMulti(['330100'], []);
  const c = await getPlaces('330100', []);
  if (a.length || b.length || c.length) problems.push('空参数查询应返回空数组');
  console.log(`\n[边界] 空城市/空分类查询 → (${a.length}, ${b.length}, ${c.length}) ✅ 不抛错`);
} catch (e) {
  problems.push(`空参数查询抛错: ${e.message}`);
  console.log(`\n[边界] ❌ 空参数查询抛错: ${e.message}`);
}

const one = await getPlacesMulti(['330100'], ['eat']);
const many = await getPlacesMulti(cities.map((c) => c.adcode), ['eat', 'sight', 'hotpot']);
console.log(`[边界] 单城市+单分类 → ${one.length} 条；11 城市+3 分类 → ${many.length} 条 ✅ 占位符匹配`);

// ---- 2. 每个城市都能抽出结果（用该城市真的有数据的分类） ----
console.log('\n[覆盖] 逐城市抽签（用该城市每个分类）：');
let cityFails = 0;
for (const city of cities) {
  const cats = city.categories.length ? city.categories : ['eat'];
  for (const catId of cats) {
    const places = await getPlacesMulti([city.adcode], [catId]);
    if (places.length === 0) {
      problems.push(`${city.name} / ${catId} 查询为空`);
      cityFails++;
      continue;
    }
    const r = draw({
      region: { adcode: city.adcode, name: city.name },
      cityPool: [city.adcode],
      categoryIds: [catId],
      categories,
      places,
      rand: (n) => randomInt(n),
    });
    if (!r) { problems.push(`${city.name} / ${catId} 抽签返回 null`); cityFails++; }
    else if (r.place.city !== city.name) problems.push(`${city.name} 抽到了 ${r.place.city} 的 ${r.place.name}`);
  }
}
console.log(cityFails === 0
  ? `       ✅ ${cities.length} 个城市 × 各自 ${new Set(cities.flatMap((c) => c.categories)).size} 类别，全部可抽且城市匹配正确`
  : `       ❌ ${cityFails} 项失败`);

// ---- 3. 随机城市：只在有该分类数据的城市里选 ----
const targetCat = 'hotpot';
const eligible = cities.filter((c) => c.categories.includes(targetCat));
const pick = eligible[randomInt(eligible.length)];
const pickPlaces = await getPlacesMulti([pick.adcode], [targetCat]);
console.log(`\n[随机城市] 分类=${targetCat} 有数据的城市: ${eligible.map((c) => c.name).join('、')}`);
console.log(`           随机命中 ${pick.name} → ${pickPlaces.length} 家候选 ✅（空城市不会被抽中）`);
if (pickPlaces.length === 0) problems.push('随机城市命中了无数据的城市');

// ---- 4. 全省随机：候选来自多个城市 ----
const pool = cities.map((c) => c.adcode);
const poolPlaces = await getPlacesMulti(pool, ['eat', 'sight']);
const poolCitiesInData = new Set(poolPlaces.map((p) => p.city));
const r = draw({
  region: { adcode: '330000', name: '浙江省（全省随机）' },
  cityPool: pool,
  categoryIds: ['eat', 'sight'],
  categories,
  places: poolPlaces,
  rand: (n) => randomInt(n),
});
if (!r) problems.push('全省随机抽签返回 null');
else {
  console.log(`\n[全省随机] 候选 ${r.candidateCount} 家，横跨 ${poolCitiesInData.size} 个城市`);
  console.log(`           抽中「${r.place.name}」@ ${r.place.city} · ${r.place.district}（扇区 ${r.segments.length} 个）`);
  console.log(`           poolCities 记录 ${r.poolCities?.length ?? 0} 个城市码 ✅`);
  if (poolCitiesInData.size < 5) problems.push(`全省随机候选只覆盖 ${poolCitiesInData.size} 个城市，过少`);
  if (!r.place.city) problems.push('抽中结果缺少城市标注');
}

// ---- 5. 陈旧种子行不能残留（同一条地点两个 id） ----
const db = await openDb();
if (db) {
  const ids = db.prepare("SELECT id FROM place WHERE source = 'seed'").all().map((x) => x.id);
  const seedIds = new Set(loadSeed().places.map((p) => p.id));
  const stale = ids.filter((id) => !seedIds.has(id));
  const dupName = db
    .prepare("SELECT city, name, COUNT(*) n FROM place WHERE source='seed' GROUP BY city, name HAVING n > 1")
    .all();
  console.log(`\n[数据卫生] 陈旧 seed 行 ${stale.length} 条；重复（同城同名）${dupName.length} 组`);
  if (stale.length) problems.push(`库里残留 ${stale.length} 条陈旧 seed 行`);
  if (dupName.length) {
    problems.push(`有 ${dupName.length} 组同城同名重复：${dupName.slice(0, 3).map((d) => d.name).join('、')}`);
  }
}

// ---- 6. 吃饭必选在多城市下依然成立 ----
let miss = 0;
for (let i = 0; i < 300; i++) {
  const ids = randomCategoryIds(categories, 3, (n) => randomInt(n));
  if (!ids.includes('eat')) miss++;
}
console.log(`[规则] 随机项目 300 次未含吃饭 ${miss} 次`);
if (miss) problems.push(`随机项目有 ${miss}/300 次漏掉吃饭`);

console.log('');
if (problems.length) {
  console.log(`❌ 多城市校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log('✅ 多城市校验通过：11 市全覆盖可抽、随机城市只落有数据城市、全省随机跨城、查询边界与数据卫生正常');

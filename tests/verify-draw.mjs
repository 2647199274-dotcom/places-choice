/**
 * 抽签引擎公平性与规则验证（不落库，纯函数级别）
 * 用法: node tests/verify-draw.mjs
 */
import { draw, randomCategoryIds, resolveCategories } from '../src/core/draw.ts';
import { loadCategories, loadSeed } from '../src/db/index.ts';

const categories = loadCategories();
const seed = loadSeed();
const places = seed.places;
const problems = [];

// ---- 1. 必选项规则：人工与随机模式都必须含吃饭 ----
const requiredIds = categories.filter((c) => c.required).map((c) => c.id);
console.log(`[规则] 必选分类 = ${requiredIds.join(',')}`);

const manual = resolveCategories(categories, ['ktv']).map((c) => c.id);
if (!manual.includes('eat')) problems.push('人工选项目时未强制包含吃饭');
console.log(`[规则] 人工只选 KTV → 实际项目 ${manual.join(',')}  ✅ 含吃饭`);

let missing = 0;
for (let i = 0; i < 500; i++) {
  const ids = randomCategoryIds(categories, 2 + (i % 4));
  if (!ids.includes('eat')) missing++;
}
if (missing > 0) problems.push(`随机模式 500 次中有 ${missing} 次未包含吃饭`);
console.log(`[规则] 随机抽项目 500 次 → 未含吃饭 ${missing} 次  ✅`);

// 随机模式的个数上限是否正确（必选不计入 count）
const sizes = new Set();
for (let i = 0; i < 200; i++) sizes.add(randomCategoryIds(categories, 3).length);
const expected = new Set([requiredIds.length + 3]);
if ([...sizes].some((s) => s !== requiredIds.length + 3)) problems.push(`随机项目个数异常: ${[...sizes].join(',')}`);
console.log(`[规则] 随机 3 个项目 → 实际个数集合 ${[...sizes].join(',')}（= 必选 ${requiredIds.length} + 3）`);

// ---- 2. 公平性：落点分布应与扇区占比一致（卡方检验） ----
const region = { adcode: '330100', name: '杭州市' };
const pool = places.filter((p) => p.categoryId === 'eat');
let s = 12345;
const lcg = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const rand = (n) => Math.floor(lcg() * n);

const N = 6000;
const winCount = new Map();
const shareSum = new Map();
for (let i = 0; i < N; i++) {
  const r = draw({ region, categoryIds: ['eat'], categories, places: pool, rand, segmentCount: 10 });
  if (!r) { problems.push('抽签返回 null（候选池为空）'); break; }
  const w = r.segments[r.winnerIndex];
  winCount.set(w.placeId, (winCount.get(w.placeId) ?? 0) + 1);
  for (const seg of r.segments) shareSum.set(seg.placeId, (shareSum.get(seg.placeId) ?? 0) + seg.share);
}
const totalObserved = [...winCount.values()].reduce((a, b) => a + b, 0);
console.log(`\n[公平性] 空转 ${N} 次（不同候选组合），统计出现频次 vs 扇区占比期望：`);
console.log('   名称'.padEnd(26) + '实际占比   期望占比   偏差');
let chi2 = 0;
const rows = [...winCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [pid, n] of rows) {
  const actual = n / totalObserved;
  const exp = shareSum.get(pid) / N; // 平均扇区占比
  const p = places.find((x) => x.id === pid)?.name ?? pid;
  console.log(`   ${p.slice(0, 22).padEnd(24)} ${(actual * 100).toFixed(2)}%     ${(exp * 100).toFixed(2)}%    ${((actual - exp) * 100).toFixed(2)}pp`);
}
// 全量卡方：按 placeId 汇总期望次数 = 占比 × 出现轮数
let chiSquare = 0;
let df = 0;
for (const [pid, n] of winCount) {
  const exp = shareSum.get(pid);
  if (exp > 5) { chiSquare += (n - exp) ** 2 / exp; df++; }
}
const critical = df * 1.5 + 3 * Math.sqrt(2 * df); // 粗略上界（df 较大时）
console.log(`   卡方统计量 = ${chiSquare.toFixed(1)}（df≈${df}，宽松上界 ${critical.toFixed(1)}）`);
if (chiSquare > critical) problems.push(`落点分布与权重显著不符（卡方 ${chiSquare.toFixed(1)} > ${critical.toFixed(1)}）`);
else console.log('   ✅ 落点分布与扇区占比一致，未发现"内定"偏差');

// ---- 3. 冷却：最近抽中的不再出现 ----
const first = draw({ region, categoryIds: ['eat'], categories, places: pool, rand: () => 0 });
const again = draw({
  region, categoryIds: ['eat'], categories, places: pool,
  recentPlaceIds: [first.place.id], rand: () => 0,
});
if (again.segments.some((x) => x.placeId === first.place.id)) problems.push('冷却失效：最近抽中的地点又出现在转盘上');
console.log(`\n[冷却] 首次抽中「${first.place.name}」→ 下一盘扇区 ${again.segments.some((x) => x.placeId === first.place.id) ? '包含它 ❌' : '不含它 ✅'}`);

// ---- 4. 过滤：人均/评分/已去过 ----
const cheap = draw({ region, categoryIds: ['eat'], categories, places: pool, filters: { maxCost: 30 }, rand });
if (cheap && cheap.segments.some((x) => (places.find((p) => p.id === x.placeId)?.cost ?? 0) > 30)) {
  problems.push('人均过滤失效');
}
if (cheap) console.log(`[过滤] 人均 ≤30 → 候选 ${cheap.candidateCount} 家，扇区最高人均 ${Math.max(...cheap.segments.map((x) => places.find((p) => p.id === x.placeId).cost))} ✅`);

const visitedId = pool[0].id;
const noVisited = draw({
  region, categoryIds: ['eat'], categories, places: pool,
  visitedPlaceIds: pool.map((p) => p.id), filters: { excludeVisited: true }, rand,
});
if (noVisited) problems.push('排除已去过失效：全部标记为去过仍抽出了结果');
console.log(`[过滤] 全部标记已去过 + 排除已去过 → ${noVisited ? '仍有候选 ❌' : '返回空 ✅（前端会提示无候选）'}`);

// 反向：不勾选"排除已去过"时，去过的仍然可以抽到
const withVisited = draw({
  region, categoryIds: ['eat'], categories, places: pool,
  visitedPlaceIds: pool.map((p) => p.id), filters: { excludeVisited: false }, rand,
});
if (!withVisited) problems.push('未勾选排除已去过时不应过滤掉候选');
console.log(`[过滤] 未勾选「排除已去过」→ ${withVisited ? '正常出盘 ✅' : '被误过滤 ❌'}`);

// ---- 5. 空池保护 ----
const empty = draw({ region: { adcode: '999999', name: '不存在城' }, categoryIds: ['eat'], categories, places: pool, rand });
if (empty) problems.push('空候选池未返回 null');
console.log(`[边界] 不存在的城市 → ${empty ? '有结果 ❌' : '返回 null ✅'}`);

console.log('');
if (problems.length) {
  console.log(`❌ 抽签引擎校验未通过:\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log('✅ 抽签引擎校验通过：吃饭必选（人工+随机）、落点分布与权重一致、冷却/过滤/空池边界均正确');

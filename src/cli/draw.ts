/**
 * CLI 抽签（P1 验收入口）
 * 用法:
 *   npm run draw -- --city 杭州市 --categories eat,hotpot,ktv
 *   npm run draw -- --city 杭州市 --random --count 3
 *   npm run draw -- --list-categories
 */
import { randomInt } from 'node:crypto';
import { loadCategories, ensureSeeded, getPlaces, getPlacesMulti, getRegions, getRecentDrawIds, recordDraw, countPlaces, getCitySummaries } from '../db/index.ts';
import { draw, randomCategoryIds, resolveCategories } from '../core/draw.ts';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const categories = loadCategories();

if (args['list-categories']) {
  console.log('可用项目（required=必选，人工/随机模式都会包含）:\n');
  for (const c of categories) {
    console.log(`  ${c.icon} ${c.id.padEnd(12)} ${c.label.padEnd(10)} 权重${String(c.weight).padEnd(5)} ${c.required ? '★必选' : ''} ${c.desc}`);
  }
  process.exit(0);
}

await ensureSeeded();
const counts = await countPlaces();
const cities = await getCitySummaries();
const cityByAdcode = new Map(cities.map((c) => [c.adcode, c]));

// 地区解析：支持 指定城市 / 随机城市 / 全省随机
let cityPool: string[];
let region: { adcode: string; name: string };
const scope = String(args.scope ?? 'city');

if (scope === 'random-city') {
  const picked = cities[randomInt(cities.length)];
  region = { adcode: picked.adcode, name: picked.name };
  cityPool = [picked.adcode];
  console.log(`🎲 随机城市 → ${picked.name}`);
} else if (scope === 'province') {
  const province = String(args.province ?? '浙江省');
  const inProvince = cities.filter((c) => (c.province || '浙江省') === province);
  if (inProvince.length === 0) {
    console.error(`未知省份: ${province}。当前可用: ${[...new Set(cities.map((c) => c.province))].join(', ')}`);
    process.exit(1);
  }
  region = { adcode: `${inProvince[0].adcode.slice(0, 2)}0000`, name: `${province}（全省随机）` };
  cityPool = inProvince.map((c) => c.adcode);
  console.log(`🎲 全省随机 → ${province} ${inProvince.length} 个城市混抽`);
} else {
  const cityName = String(args.city ?? '杭州市');
  const found = cities.find((c) => c.name === cityName || c.name.startsWith(cityName.replace('市', '')));
  if (!found) {
    console.error(`未知城市: ${cityName}\n当前可用（${cities.length} 个）: ${cities.map((c) => `${c.name}(${c.total})`).join(', ')}`);
    process.exit(1);
  }
  region = { adcode: found.adcode, name: found.name };
  cityPool = [found.adcode];
}

const randomize = Boolean(args.random) || scope !== 'city';
const count = Number(args.count ?? 3);
const selectedIds = randomize
  ? randomCategoryIds(categories, count, (n) => randomInt(n))
  : String(args.categories ?? 'eat').split(',').map((s) => s.trim()).filter(Boolean);

const chosen = resolveCategories(categories, selectedIds).map((c) => c.id);
// 只在"该城市真的有数据的分类"上抽（避免随机项目抽到空分类）
const available = new Set(cityPool.flatMap((a) => cityByAdcode.get(a)?.categories ?? []));
const chosenAvailable = chosen.filter((id) => available.has(id) || categories.find((c) => c.id === id)?.required);
const places = await getPlacesMulti(cityPool, chosenAvailable);
const recent = await getRecentDrawIds(5);

const result = draw({
  region,
  cityPool,
  categoryIds: chosenAvailable,
  categories,
  places,
  recentPlaceIds: recent,
  filters: { excludeVisited: Boolean(args['exclude-visited']), minRating: args['min-rating'] ? Number(args['min-rating']) : undefined, maxCost: args['max-cost'] ? Number(args['max-cost']) : undefined },
  segmentCount: Number(args.segments ?? 10),
});

console.log(`\n🎯 地区：${region.name}   模式：${randomize ? '随机项目' : '人工选项目'}`);
console.log(`   项目：${chosenAvailable.map((id) => `${categories.find((c) => c.id === id)?.icon}${categories.find((c) => c.id === id)?.label}`).join(' ')}`);
console.log(`   库存：${counts.total} 条地点 / ${cities.length} 个城市 / 本次候选 ${places.length} 家`);

if (!result) {
  console.log('\n❌ 没有候选。请换城市或项目，或运行采集器补齐数据。');
  process.exit(2);
}

console.log('\n🎡 转盘扇区：');
result.segments.forEach((s, i) => {
  const bar = '█'.repeat(Math.max(1, Math.round(s.share * 60)));
  const mark = i === result.winnerIndex ? ' ⟵ 指针落点' : '';
  console.log(`   ${String(i + 1).padStart(2)}. ${s.name.padEnd(22)} ${(s.share * 100).toFixed(1).padStart(5)}% ${bar}${mark}`);
});

const p = result.place;
const cat = categories.find((c) => c.id === p.categoryId);
console.log(`\n🎉 抽中：${cat?.icon ?? ''} ${p.name}`);
console.log(`   城市：${p.city}   分类：${cat?.label ?? p.categoryId}   区县：${p.district}`);
console.log(`   评分：${p.rating}   人均：${p.cost > 0 ? `¥${p.cost}` : '未知'}`);
console.log(`   推荐：${p.why}`);
console.log(`\n🔗 高德链接（浏览器打开即跳转高德）：`);
console.log(`   [${result.link.primaryKind === 'place' ? '详情页' : '搜索'}] ${result.link.primary}`);
if (result.link.marker) console.log(`   [标记点] ${result.link.marker}`);
if (result.link.navi) console.log(`   [一键导航] ${result.link.navi}`);

await recordDraw(p, chosen);
console.log(`\n（已记入抽签历史，最近 5 次抽中的不会重复出现）`);

/**
 * 采集 CLI
 * 用法:
 *   node src/cli/collect.ts --check                                        # 检查 Key 是否可用
 *   node src/cli/collect.ts --city 杭州市 --adcode 330100 --categories eat,hotpot --pages 2
 *   node src/cli/collect.ts --city 杭州市 --adcode 330100 --all --pages 3
 *   node src/cli/collect.ts --scope zhejiang --all --pages 2                # 浙江 11 市
 *   node src/cli/collect.ts --scope china --province 广东省 --all --pages 2  # 全国（可按省/限量）
 *   node src/cli/collect.ts --scope china --plan                            # 只列出将要采集的城市，不发请求
 */
import { loadCategories, ensureSeeded, countPlaces, getCitySummaries } from '../db/index.ts';
import { collectCategory, getAmapKey, fetchDistrict, searchPlaces } from '../collect/amap.ts';
import { resolveTargets, type CollectTarget } from '../collect/targets.ts';
import { getChinaProvinces, provincesToTargets } from '../collect/districts.ts';

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const n = argv[i + 1];
    if (n && !n.startsWith('--')) { out[k] = n; i++; } else out[k] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const key = getAmapKey();

if (!key) {
  console.error(`
❌ 未找到 AMAP_KEY。

请按以下步骤获取（约 3 分钟）：
  1. 打开 https://console.amap.com/dev/id/phone 注册并完成个人开发者实名认证
  2. 「应用管理 → 创建新应用 → 添加 Key」，服务平台选【Web 服务】（不要选 Web 端 JS API）
  3. 把 Key 写入项目根目录 .env：  AMAP_KEY=你的key

没有 Key 时也可以先用种子数据体验转盘：npm run draw -- --city 杭州市 --categories eat,hotpot
`);
  process.exit(1);
}

if (args.check) {
  console.log(`🔑 Key: ${key.slice(0, 6)}…${key.slice(-4)}`);
  try {
    const { pois, count } = await searchPlaces({ key, keywords: '火锅', region: '330100', pageSize: 5 });
    console.log(`✅ Key 可用：杭州「火锅」远程共 ${count} 条，本页返回 ${pois.length} 条`);
    if (pois[0]) {
      console.log(`   示例：${pois[0].name} | ${pois[0].address} | ${pois[0].location} | id=${pois[0].id}`);
    }
  } catch (e) {
    console.error(`❌ Key 不可用：${(e as Error).message}`);
    process.exit(2);
  }
  try {
    const districts = await fetchDistrict('杭州', { key, subdistrict: 1 });
    console.log(`✅ 行政区划可用：返回 ${districts.length} 个下级区划`);
  } catch (e) {
    console.error(`⚠️ 行政区划接口失败：${(e as Error).message}`);
  }
  process.exit(0);
}

await ensureSeeded();
const categories = loadCategories();
const pages = Number(args.pages ?? 2);

const selected = args.all
  ? categories
  : categories.filter((c) => String(args.categories ?? 'eat,hotpot').split(',').map((s) => s.trim()).includes(c.id));

if (selected.length === 0) {
  console.error('未选中任何分类。');
  process.exit(1);
}

// --scope zhejiang 采全省；--scope china 采全国（省→市由高德行政区划提供，带缓存）
const citySummariesEarly = await getCitySummaries();
const scopeName = String(args.scope ?? 'city');
let targets: CollectTarget[];
if (scopeName === 'china') {
  const { provinces, fromCache } = await getChinaProvinces({ key, fresh: Boolean(args['refresh-regions']) });
  const all = provincesToTargets(provinces, {
    provinceFilter: args.province ? String(args.province) : undefined,
    cityLimit: args['per-province-limit'] ? Number(args['per-province-limit']) : undefined,
  });
  targets = resolveTargets({ cities: citySummariesEarly, chinaTargets: all }, args);
  console.log(
    `🗺️  全国行政区划：${provinces.length} 个省 / ${provinces.reduce((s, p) => s + p.cities.length, 0)} 个市` +
      `（${fromCache ? '来自本地缓存 data/regions-cache.json' : '刚从高德拉取并已写缓存'}）`,
  );
} else {
  targets = resolveTargets({ cities: citySummariesEarly }, args);
}

if (args.plan) {
  console.log(`\n📋 采集计划（${targets.length} 个城市，仅预览，不发请求）：`);
  for (const t of targets) console.log(`   ${t.cityAdcode}  ${t.cityName}${t.provinceName ? `  [${t.provinceName}]` : ''}`);
  const perCity = selected.length * pages * 3;
  console.log(`\n   预计请求数：${targets.length} 城 × ${selected.length} 分类 × ${pages} 页 × 最多 3 关键词 ≈ ${targets.length * perCity} 次`);
  console.log('   （高德个人开发者免费额度按日重置；量太大就分省/分批跑，或用 --province 限定）');
  process.exit(0);
}

console.log(`🚀 开始采集：${targets.length} 个城市 × ${selected.length} 个分类 × 每关键词 ${pages} 页`);
console.log(`   限速 350ms/请求，原始响应落盘 data/raw/，入库自动去重（幂等 UPSERT）\n`);

let totalSaved = 0;
let totalGot = 0;
const failedCities: string[] = [];
for (const [idx, t] of targets.entries()) {
  if (targets.length > 1) {
    console.log(`\n── [${idx + 1}/${targets.length}] ${t.cityName} (${t.cityAdcode})${t.provinceName ? ` · ${t.provinceName}` : ''} ──`);
  }
  let cityOk = false;
  for (const category of selected) {
    process.stdout.write(`  ${category.icon} ${category.label} … `);
    const results = await collectCategory(
      { category, cityName: t.cityName, cityAdcode: t.cityAdcode },
      { key, pages, throttleMs: Number(args.throttle ?? 350) },
    );
    const got = results.reduce((s, r) => s + r.got, 0);
    const saved = results.reduce((s, r) => s + r.saved, 0);
    const failed = results.filter((r) => !r.ok);
    totalSaved += saved;
    totalGot += got;
    if (got > 0) cityOk = true;
    console.log(`返回 ${got} 条 / 新增 ${saved} 条${failed.length ? ` ⚠️ 失败 ${failed.length} 次：${failed[0].msg}` : ''}`);
  }
  if (!cityOk) failedCities.push(t.cityName);
}

const counts = await countPlaces();
console.log(`\n✅ 采集完成：本轮返回 ${totalGot} 条，入库新增/更新 ${totalSaved} 条`);
console.log(`   当前库内共 ${counts.total} 条；城市分布：${Object.entries(counts.byCity).map(([c, n]) => `${c} ${n}`).join('、')}`);
if (failedCities.length) console.log(`   ⚠️ 完全没有数据的城市（检查 adcode 或配额）：${failedCities.join('、')}`);
console.log(`\n下一步：npm run draw -- --scope province --count 3`);

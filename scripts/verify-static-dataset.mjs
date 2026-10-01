/**
 * 校验「提交进仓库的静态数据集快照」—— GitHub Pages 线上用的就是这一份
 *
 * 为什么必须有这个校验（真实事故）：
 *   data/*.db 是 gitignore 的，CI 上 `openDb()` 会 **新建一个空数据库**（不是返回 null！），
 *   然后 `ensureSeeded()` 灌进 647 条种子数据。于是导出脚本把"空库 + 种子"当成
 *   `source: 'sqlite'` 的真实数据写出去，**覆盖掉仓库里 25820 条的快照**，
 *   而 `fromSeed()` 那个兜底分支根本不会触发（因为 db 不是 null）。
 *   实测线上事故：dataset.json 只剩 671 条 / 11 城（浙江种子），但 source 写着 sqlite，
 *   界面上看不出任何异常 —— 典型的静默数据丢失。
 *
 * 所以：导出脚本的兜底不可信，必须**独立断言**这份快照的规模。
 *
 * 用法: node scripts/verify-static-dataset.mjs
 *      node scripts/verify-static-dataset.mjs --dataset <path> --meta <path>   # 供测试注入
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** 取命令行覆盖（测试用），否则用仓库里的默认路径 */
function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DATASET_FILE = argValue('dataset', path.join(ROOT, 'web', 'public', 'data', 'dataset.json'));
const META_FILE = argValue('meta', path.join(ROOT, 'web', 'public', 'data', 'meta.json'));

/**
 * 地点数下限：种子数据只有 671 条，真实快照 25820 条。
 * 这条断言专门拦"空库 + 种子被当成真实数据导出/提交"这一种事故。
 * 如果哪天真要缩减采集范围导致低于此值，改这里并说明原因。
 */
const MIN_PLACES = 20000;

const problems = [];
const fail = (msg) => problems.push(msg);

function readJson(file, label) {
  if (!fs.existsSync(file)) {
    fail(`${label} 不存在：${file}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${label} 不是合法 JSON：${e.message}`);
    return null;
  }
}

const dataset = readJson(DATASET_FILE, '静态快照 dataset.json');
const meta = readJson(META_FILE, '静态快照 meta.json');

if (dataset && meta) {
  const places = dataset.places?.length ?? 0;
  const cities = dataset.cities?.length ?? 0;
  const categories = dataset.categories?.length ?? 0;

  console.log('静态快照校验：');
  console.log(`  文件      ${path.relative(ROOT, DATASET_FILE)}  ${Math.round(fs.statSync(DATASET_FILE).size / 1024)} KB`);
  console.log(`  数据来源  ${dataset.source}  生成于 ${dataset.generatedAt}`);
  console.log(`  规模      ${cities} 城 / ${places} 地点 / ${categories} 分类`);

  // 1) 快照与 meta 必须一致（两者是导出脚本一起写的，不一致说明有人手改或只更新了一半）
  if (places !== meta.placeCount) fail(`地点数与 meta.json 不符：dataset=${places} meta=${meta.placeCount}`);
  if (cities !== meta.cityCount) fail(`城市数与 meta.json 不符：dataset=${cities} meta=${meta.cityCount}`);
  if (categories !== meta.categoryCount) fail(`分类数与 meta.json 不符：dataset=${categories} meta=${meta.categoryCount}`);
  if (dataset.generatedAt !== meta.generatedAt) fail('generatedAt 与 meta.json 不一致（dataset 与 meta 不是同一次导出）');

  // 2) 绝对下限 —— 真正拦住"空库 + 种子"事故的那一条
  if (places < MIN_PLACES) {
    fail(
      `地点数 ${places} 低于下限 ${MIN_PLACES} —— 这份快照很可能是"空数据库 + 种子数据"导出的。\n` +
        '     （CI 上 data/*.db 不存在时会新建空库，导出脚本会把它当成真实数据；\n' +
        '      正确做法是在有真实数据库的机器上跑 npm run export:static，然后提交快照。）',
    );
  }

  // 3) 结构必须完整，否则前端离线兜底拿不到数据
  for (const key of ['categories', 'requiredIds', 'cities', 'provinces', 'districts', 'areas', 'places']) {
    if (!(key in dataset)) fail(`快照缺少字段 ${key}（前端离线兜底要用）`);
  }
  if (dataset.compact !== true) fail('快照缺少 compact: true 标记（前端按精简结构解析）');

  // 4) 抽样：必须带高德 poiid 与精确坐标，否则"跳高德"和"导航"会退化
  const withPoi = (dataset.places ?? []).filter((p) => p.poi).length;
  if (withPoi === 0) fail('没有任何地点带高德 poiid，结果卡跳转高德会全部退化为关键词搜索');
  else console.log(`  质量      带 poiid ${withPoi} 条 / ${places}`);

  const areaCities = Object.keys(dataset.areas ?? {}).length;
  console.log(`  区域维度  ${areaCities} 个城市有区域数据`);
}

if (problems.length) {
  console.error(`\n❌ 静态快照校验失败（${problems.length} 项）：`);
  for (const p of problems) console.error(`   - ${p}`);
  console.error('\n线上部署会被拦下：这份快照就是 GitHub Pages 的数据源，不能带着问题上线。');
  process.exit(1);
}

console.log('\n✅ 静态快照校验通过：规模、结构、与 meta.json 一致性均正常');

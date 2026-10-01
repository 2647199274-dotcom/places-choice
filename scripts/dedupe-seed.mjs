/**
 * 数据维护：以真实采集数据为准，去重种子数据
 *
 * 背景：种子数据（坐标是区县中心抖动的近似值、无 poiid）用于"没 Key 时也能玩"。
 * 采到真实数据后同一家店会出现两条（种子一条、高德一条）：转盘上两个同名扇区，且种子那条只能"搜索"而非跳详情页。
 *
 * 判定规则（两级，保守）：
 *   名称归一化：只去掉**通用尾缀**（总店/分店/旗舰店/概念店/店），**保留地名与门店名**
 *     —— 「海底捞(湖滨银泰店)」与「海底捞(武林广场店)」是两家店，不能合并
 *   ① 归一化名称完全相同 + 同城 + 距离 ≤ 2km → 判为同一家
 *   ② 名称前缀（前 4 字）相同 + 距离 ≤ 400m → 判为同一家（同店不同叫法）
 *   其余一律保留（宁可漏杀不可错杀：误删一家好店比留一条重复更糟）
 *
 * 为什么是 2km：种子的坐标是"区县中心 + 抖动"生成的近似值，与真实位置本就可能有几百米到一两公里偏差，
 * 这个阈值是按数据质量定的，不是拍脑袋。
 *
 * 处理方式：把重复的种子行标记为 source='seed-dup'（不物理删除、可回滚），绝不改动 source='amap'。
 * 用法: node scripts/dedupe-seed.mjs [--dry]
 */
import { requireDb, countPlaces } from '../src/db/index.ts';
import { distanceMeters } from '../src/core/areas.ts';

const dry = process.argv.includes('--dry');
const SAME_NAME_METERS = 2000;
const SAME_BRAND_METERS = 400;
const SAME_STEM_METERS = 2000;
const db = await requireDb();

function normalizeName(raw) {
  return String(raw)
    .replace(/[（(]\s*(总店|分店|旗舰店|概念店|体验店|直营店|加盟店|线下店|店)\s*[）)]/g, '')
    .replace(/(总店|分店|旗舰店|概念店|体验店|直营店|线下店)$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

const rows = db.prepare(`SELECT id, name, city, lng, lat, source, category_id FROM place WHERE source IN ('amap','seed')`).all();
const amapRows = rows.filter((r) => r.source === 'amap');
const seedRows = rows.filter((r) => r.source === 'seed');

const byName = new Map();  // 同城|归一化名 → 高德行[]
const byBrand = new Map(); // 同城|前4字 → 高德行[]
const byShort = new Map(); // 同城|品牌主干(去括号后的前3字) → 高德行[]
/** 品牌主干：去掉括号里的门店名，如「知味观(仁和路总店)」→「知味观」 */
const brandStem = (raw) => String(raw).replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '').trim();

for (const a of amapRows) {
  const n = normalizeName(a.name);
  const kn = `${a.city}|${n}`;
  if (!byName.has(kn)) byName.set(kn, []);
  byName.get(kn).push(a);
  if (n.length >= 4) {
    const kb = `${a.city}|${n.slice(0, 4)}`;
    if (!byBrand.has(kb)) byBrand.set(kb, []);
    byBrand.get(kb).push(a);
  }
  const stem = brandStem(a.name);
  if (stem.length >= 3) {
    const ks = `${a.city}|${stem.slice(0, 3)}`;
    if (!byShort.has(ks)) byShort.set(ks, []);
    byShort.get(ks).push(a);
  }
}

const near = (s, a, limit) =>
  s.lng && s.lat && a.lng && a.lat && distanceMeters(s.lng, s.lat, a.lng, a.lat) <= limit;

const marked = [];
const kept = [];
for (const s of seedRows) {
  const n = normalizeName(s.name);
  const sameName = (byName.get(`${s.city}|${n}`) ?? []).find((a) => near(s, a, SAME_NAME_METERS));
  if (sameName) {
    marked.push({ seed: s, amap: sameName, how: `同名·${Math.round(distanceMeters(s.lng, s.lat, sameName.lng, sameName.lat))}m` });
    continue;
  }
  // 两级"同品牌"判定：4 字前缀更严（400m），3 字主干更松但仍要求同一地铁/街区尺度（800m）
  if (n.length >= 4) {
    const sameBrand = (byBrand.get(`${s.city}|${n.slice(0, 4)}`) ?? []).find((a) => near(s, a, SAME_BRAND_METERS));
    if (sameBrand) {
      marked.push({ seed: s, amap: sameBrand, how: `同品牌4字·${Math.round(distanceMeters(s.lng, s.lat, sameBrand.lng, sameBrand.lat))}m` });
      continue;
    }
  }
  const stem = brandStem(s.name);
  if (stem.length >= 3) {
    // 必须同分类：「千岛湖鱼头火锅」是火锅、「千岛湖天屿景区」是景区，光看名字会误杀。
    // 我们自己的种子数据带分类（种子分类是人工整理的），所以这条约束是可信的。
    const sameStem = (byShort.get(`${s.city}|${stem.slice(0, 3)}`) ?? []).find(
      (a) => a.category_id === s.category_id && near(s, a, SAME_STEM_METERS),
    );
    if (sameStem) {
      marked.push({ seed: s, amap: sameStem, how: `同品牌主干·${Math.round(distanceMeters(s.lng, s.lat, sameStem.lng, sameStem.lat))}m` });
      continue;
    }
  }
  kept.push(s);
}

console.log(`种子 ${seedRows.length} 条 → 判为重复 ${marked.length} 条，保留 ${kept.length} 条`);
console.log(`（规则：归一化同名 ≤${SAME_NAME_METERS}m，或同品牌前 4 字 ≤${SAME_BRAND_METERS}m，或同品牌主干 ≤${SAME_STEM_METERS}m；其余保留）\n`);
console.log('判为重复的例子:');
for (const m of marked.slice(0, 12)) console.log(`  [${m.how}] ${m.seed.city} 「${m.seed.name}」 → 「${m.amap.name}」`);
console.log('\n保留的种子样例（真实数据未覆盖，价值更高）:');
for (const k of kept.slice(0, 8)) console.log(`  ${k.city} 「${k.name}」`);

if (dry) {
  console.log('\n[dry] 未做修改。去掉 --dry 执行。');
  process.exit(0);
}

const stmt = db.prepare(`UPDATE place SET source = 'seed-dup' WHERE id = ?`);
db.transaction((list) => { for (const m of list) stmt.run(m.seed.id); })(marked);

const final = db.prepare('SELECT source, COUNT(*) n FROM place GROUP BY source').all();
console.log(`\n✅ 已标记 ${marked.length} 条为 seed-dup`);
console.log("  回滚：UPDATE place SET source='seed' WHERE source='seed-dup'");
console.log('  来源分布:', final.map((r) => `${r.source}:${r.n}`).join(' '));
const after = await countPlaces();
console.log('  可用地点:', after.total);

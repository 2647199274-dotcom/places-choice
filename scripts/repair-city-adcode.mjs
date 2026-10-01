/**
 * 数据修复：按 district adcode 重新归属城市（修正"邻近城市 POI 混进来"的脏数据）
 *
 * 背景：高德 v3 在 citylimit=true 时仍会漏出邻近城市的 POI。历史采集没做前缀过滤，导致
 * 库里出现一堆"只有 1 条"的城市（万宁市/三亚市/台北市…），它们其实是别的城市查询带出来的。
 *
 * 做法（有据可依，不猜）：
 *   每条高德数据的 district_adcode（adcode）本来就是它真实所在的区县，可以直接推出正确的城市码：
 *     330106（西湖区）→ 城市码 330100
 *   所以：city_adcode = district_adcode 前 4 位 + '00'，city 名称按城市码统一。
 *   然后删掉"城市码与前缀过滤规则不符"的残留（如港澳台地区数据，来源本就不该采）。
 *
 * 用法: node scripts/repair-city-adcode.mjs [--dry]
 */
import { requireDb, countPlaces } from '../src/db/index.ts';

const dry = process.argv.includes('--dry');
const db = await requireDb();

/** 城市码前缀 → 城市名（从我们已有的干净数据 + 直辖市/特别行政区常量表建映射） */
const CITY_NAMES = new Map([
  ['110100', '北京市'], ['120100', '天津市'], ['310100', '上海市'], ['500100', '重庆市'],
  ['810100', '香港特别行政区'], ['820100', '澳门特别行政区'],
]);

const rows = db
  .prepare(
    `SELECT id, name, city, city_adcode, district_adcode, source FROM place
     WHERE source = 'amap' AND district_adcode IS NOT NULL AND district_adcode <> ''`,
  )
  .all();

// 先把"数据量足够大到可信"的城市码→城市名建立起来（≥20 条的城市码认为其城市名可信）
const byCode = new Map();
for (const r of rows) {
  const code = `${String(r.district_adcode).slice(0, 4)}00`;
  if (!byCode.has(code)) byCode.set(code, { names: new Map(), rows: [] });
  const b = byCode.get(code);
  b.rows.push(r);
  b.names.set(r.city, (b.names.get(r.city) ?? 0) + 1);
}
for (const [code, b] of byCode) {
  if (b.rows.length < 20) continue;
  const best = [...b.names.entries()].sort((a, c) => c[1] - a[1])[0][0];
  if (!CITY_NAMES.has(code)) CITY_NAMES.set(code, best);
}
console.log(`建立城市码→城市名映射 ${CITY_NAMES.size} 条（含数据量 ≥20 的城市）`);

// 港澳台：本项目不采集（高德在大陆以外数据不适用），直接移除
const DROP_PREFIXES = ['8101', '8201', '7100']; // 香港 / 澳门 / 台湾省
const toDrop = [];
const toFix = [];
let unchanged = 0;
for (const r of rows) {
  const code = `${String(r.district_adcode).slice(0, 4)}00`;
  if (DROP_PREFIXES.some((p) => code.startsWith(p.slice(0, 4)))) {
    toDrop.push(r);
    continue;
  }
  const name = CITY_NAMES.get(code);
  if (r.city_adcode !== code || (name && r.city !== name)) toFix.push({ ...r, newCode: code, newName: name ?? r.city });
  else unchanged++;
}

console.log(`\n高德数据 ${rows.length} 条：待修正 ${toFix.length} 条 / 待移除(港澳台) ${toDrop.length} 条 / 已正确 ${unchanged} 条`);
const wrongCity = toFix.filter((r) => r.city_adcode !== r.newCode);
console.log(`其中"城市码写错"的 ${wrongCity.length} 条，样例:`);
for (const r of wrongCity.slice(0, 10)) console.log(`  「${r.name}」 原记 ${r.city}(${r.city_adcode}) → 应为 ${r.newName}(${r.newCode})  [区县 ${r.district_adcode}]`);

const pollutedCities = [...new Set(wrongCity.map((r) => r.city))].slice(0, 12);
console.log(`\n受影响的城市名（原记录，多为误归属）: ${pollutedCities.join('、')}${wrongCity.length > 12 ? ' …' : ''}`);

if (dry) {
  console.log('\n[dry] 未做修改。去掉 --dry 执行。');
  process.exit(0);
}

const upd = db.prepare('UPDATE place SET city_adcode = ?, city = ? WHERE id = ?');
const del = db.prepare('DELETE FROM place WHERE id = ?');
db.transaction(() => {
  for (const r of toFix) upd.run(r.newCode, r.newName, r.id);
  for (const r of toDrop) del.run(r.id);
})();

const after = await countPlaces();
const cities = db.prepare(`SELECT city, COUNT(*) n FROM place WHERE 1=1 GROUP BY city ORDER BY n DESC`).all();
console.log(`\n✅ 修正 ${toFix.length} 条，移除 ${toDrop.length} 条`);
console.log(`   库内 ${after.total} 条 / ${cities.length} 城`);
console.log(`   Top10: ${cities.slice(0, 10).map((c) => `${c.city}:${c.n}`).join(' ')}`);
const tiny = cities.filter((c) => c.n === 1).length;
console.log(`   仅 1 条数据的城市数：${tiny}（修复前有上百个，这些就是脏数据来源）`);

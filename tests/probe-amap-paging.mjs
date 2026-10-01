// 搞清楚高德 v3/place/text 的正确分页方式（offset/page 组合实测）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const KEY = fs.readFileSync(path.join(root, '.env'), 'utf8').replace(/^\uFEFF/, '').match(/AMAP_KEY\s*=\s*(\S+)/)[1];

const base = 'https://restapi.amap.com/v3/place/text';
async function q(label, params) {
  const url = `${base}?key=${KEY}&${new URLSearchParams({ keywords: '火锅', city: '330100', citylimit: 'true', extensions: 'all', ...params })}`;
  const j = await (await fetch(url)).json();
  const pois = j.pois ?? [];
  const names = pois.map((p) => p.name);
  const ids = pois.map((p) => p.id);
  console.log(`\n[${label}] status=${j.status} count=${j.count} 返回=${pois.length} 唯一id=${new Set(ids).size}`);
  console.log(`   前3: ${names.slice(0, 3).join(' | ')}`);
  return ids;
}

const a1 = await q('offset=0&page=1', { offset: '0', page: '1' });
const a2 = await q('offset=0&page=2', { offset: '0', page: '2' });
const a3 = await q('offset=0&page=3', { offset: '0', page: '3' });
const b1 = await q('offset=20', { offset: '20' });
const b2 = await q('offset=40', { offset: '40' });
const c1 = await q('offset=20&page=2', { offset: '20', page: '2' });
const d1 = await q('offset=0&page=1&offset=0(默认)', {});
const e1 = await q('offset=0&page=1&types=050100', { offset: '0', page: '1', types: '050100' });

const inter = (x, y) => x.filter((i) => y.includes(i)).length;
console.log('\n===== 对比 =====');
console.log(`page=1 vs page=2 重复: ${inter(a1, a2)} 条`);
console.log(`page=2 vs page=3 重复: ${inter(a2, a3)} 条`);
console.log(`offset=0(page1) vs offset=20 重复: ${inter(a1, b1)} 条`);
console.log(`offset=20 vs offset=40 重复: ${inter(b1, b2)} 条`);
console.log(`offset=20 vs offset=20&page=2 重复: ${inter(b1, c1)} 条`);
console.log(`offset=0&page=1 vs 默认 重复: ${inter(a1, d1)} 条，默认返回 ${d1.length} 条`);
console.log(`带 types=050100 返回 ${e1.length} 条（唯一 ${new Set(e1).size}）`);
console.log('\n结论依据：若 page 递增能拿到不同 id，则用 page+offset 同时传；否则用 offset 递增。');

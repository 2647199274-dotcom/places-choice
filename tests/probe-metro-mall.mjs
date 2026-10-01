// 确认地铁站/商场的高德 types 码与字段，供"按地铁/商场选区域"用
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const KEY = fs.readFileSync(path.join(root, '.env'), 'utf8').replace(/^\uFEFF/, '').match(/AMAP_KEY\s*=\s*(\S+)/)[1];

async function q(label, params) {
  const url = `https://restapi.amap.com/v3/place/text?key=${KEY}&${new URLSearchParams({ city: '330100', citylimit: 'true', extensions: 'all', offset: '0', page: '1', ...params })}`;
  const j = await (await fetch(url)).json();
  const pois = j.pois ?? [];
  console.log(`\n[${label}] count=${j.count} 返回=${pois.length}`);
  for (const p of pois.slice(0, 6)) {
    console.log(`   ${p.name} | ${p.adname} | 商圈=${p.business_area ?? '-'} | typecode=${p.typecode} | type=${p.type}`);
  }
  return pois;
}

// 地铁站
await q('地铁站 types=150500', { keywords: '地铁站', types: '150500' });
// 只用类型码
await q('仅 types=150500', { keywords: '', types: '150500' });
// 购物中心 / 商场
await q('商场 types=060100', { keywords: '购物中心', types: '060100' });
await q('仅 types=060100', { keywords: '', types: '060100' });
// 商圈本身有没有 POI（商务住宅/写字楼/商务区）
await q('商务区 types=120000', { keywords: '商圈', types: '120000' });
// 直接搜"XX商圈"
await q('关键词 商圈', { keywords: '商圈' });

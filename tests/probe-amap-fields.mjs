// 用真实 Key 验证：字段丰富度、分页总量、types 过滤是否过窄、区县 adcode
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const KEY = fs.readFileSync(path.join(root, '.env'), 'utf8').match(/AMAP_KEY\s*=\s*(\S+)/)[1];

async function q(params) {
  const url = `https://restapi.amap.com/v5/place/text?key=${KEY}&${new URLSearchParams(params)}`;
  const j = await (await fetch(url)).json();
  return { url: url.replace(KEY, 'KEY'), j };
}

// 1) 不加 types（纯关键词）
{
  const { url, j } = await q({ keywords: '火锅', region: '330100', page_size: '5', page_num: '1', city_limit: 'true', show_fields: 'business,photos,rating,cost,navi' });
  console.log(`\n[A 关键词+无types] status=${j.status} count=${j.count} 返回=${j.pois?.length}`);
  console.log(`   URL: ${url}`);
  const p = j.pois?.[0];
  if (p) console.log('   首条完整字段:\n' + JSON.stringify(p, null, 2).split('\n').slice(0, 40).join('\n'));
}

// 2) 加 types=050100
{
  const { j } = await q({ keywords: '火锅', types: '050100', region: '330100', page_size: '5', page_num: '1', city_limit: 'true', show_fields: 'business,rating,cost' });
  console.log(`\n[B 关键词+types=050100] status=${j.status} count=${j.count} 返回=${j.pois?.length}`);
}

// 3) 只 types 不带关键词
{
  const { j } = await q({ keywords: '', types: '050100', region: '330100', page_size: '5', page_num: '1', city_limit: 'true', show_fields: 'business,rating,cost' });
  console.log(`\n[C 仅types=050100] status=${j.status} info=${j.info} count=${j.count} 返回=${j.pois?.length}`);
}

// 4) 多页看总量上限
{
  for (const page of [1, 2, 5, 10, 20]) {
    const { j } = await q({ keywords: '美食', region: '330100', page_size: '25', page_num: String(page), city_limit: 'true', show_fields: 'business,rating,cost' });
    console.log(`[D 美食 第${page}页] count=${j.count} 返回=${j.pois?.length} 首条=${j.pois?.[0]?.name ?? '-'}`);
  }
}

// 5) 区县 adcode + 评分/人均可用率
{
  const { j } = await q({ keywords: '餐厅', region: '330100', page_size: '25', page_num: '1', city_limit: 'true', show_fields: 'business,rating,cost' });
  const pois = j.pois ?? [];
  const withRating = pois.filter((p) => p.business?.rating || p.rating).length;
  const withCost = pois.filter((p) => p.business?.cost || p.cost).length;
  const adcodes = [...new Set(pois.map((p) => p.adcode))];
  console.log(`\n[E 餐厅] 返回 ${pois.length} 条；有评分 ${withRating} 条；有人均 ${withCost} 条；adcode=${adcodes.join(',')}`);
  console.log('   样例:', pois.slice(0, 3).map((p) => `${p.name}|${p.adcityname ?? p.cityname}|${p.adname}|r=${p.business?.rating ?? p.rating ?? '-'}|cost=${p.business?.cost ?? p.cost ?? '-'}|type=${p.type}`).join('\n           '));
}

// 6) v3 vs v5 对比（v3 有时字段不同）
{
  const url3 = `https://restapi.amap.com/v3/place/text?key=${KEY}&keywords=${encodeURIComponent('火锅')}&city=330100&offset=5&page=1&extensions=all&citylimit=true`;
  const j3 = await (await fetch(url3)).json();
  const p = j3.pois?.[0];
  console.log(`\n[F v3/place/text] status=${j3.status} count=${j3.count} 返回=${j3.pois?.length}`);
  if (p) console.log('   v3 首条:', JSON.stringify({ name: p.name, rating: p.biz_ext?.rating, cost: p.biz_ext?.cost, adname: p.adname, adcode: p.adcode, id: p.id, type: p.type }));
}

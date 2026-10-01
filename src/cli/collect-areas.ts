/**
 * 采集"区域维度"数据（地铁站 / 商场），并建立 地点↔地铁站 关联
 * 用法: node src/cli/collect-areas.ts --city 杭州市 --adcode 330100 [--pages 8]
 */
import { ensureSeeded, countPlaces } from '../db/index.ts';
import { collectAreaDimension, getAmapKey } from '../collect/amap.ts';
import { buildMetroLinks, listAreas } from '../core/areas.ts';
import type { AreaDimension } from '../core/types.ts';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
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
  console.error('❌ 未找到 AMAP_KEY（在 .env 里配置）');
  process.exit(1);
}

await ensureSeeded();
const cityName = String(args.city ?? '杭州市');
const cityAdcode = String(args.adcode ?? '330100');
const pages = Number(args.pages ?? 8);

console.log(`🚇🛍️  采集区域维度：${cityName}(${cityAdcode})`);
const kinds: ('metro' | 'mall')[] = ['metro', 'mall'];
for (const kind of kinds) {
  const r = await collectAreaDimension(kind, { cityName, cityAdcode }, { key, pages });
  console.log(`  ${kind === 'metro' ? '地铁站' : '商场'}：返回 ${r.got} 条，入库 ${r.saved} 条`);
}

const linked = await buildMetroLinks(cityAdcode);
console.log(`🔗 地点↔地铁站关联：${linked} 条地点落在 1.2 公里内`);

const counts = await countPlaces();
console.log(`\n库内共 ${counts.total} 条 / ${Object.keys(counts.byCity).length} 城`);

const dims: AreaDimension[] = ['district', 'businessArea', 'mall', 'metro'];
for (const dim of dims) {
  const areas = await listAreas(cityAdcode, dim);
  const top = areas.slice(0, 8).map((a) => `${a.name}(${a.placeCount})`).join(' ');
  console.log(`  ${dim.padEnd(13)} 共 ${String(areas.length).padStart(4)} 个 → ${top}`);
}

import { openDb, loadSeed } from '../src/db/index.ts';
const db = await openDb();
const seed = loadSeed();
const rows = db.prepare('SELECT id, source, city, name, category_id FROM place').all();
console.log('db rows =', rows.length, ' seed =', seed.places.length);
const bySource = {};
for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
console.log('by source:', JSON.stringify(bySource));
const seedIds = new Set(seed.places.map((p) => p.id));
console.log('seed id 唯一数 =', seedIds.size);
const notInSeed = rows.filter((r) => !seedIds.has(r.id));
console.log('库中不在种子里的行 =', notInSeed.length);
for (const r of notInSeed.slice(0, 10)) console.log('  ', JSON.stringify(r));
// 检查种子内部 id 冲突
const dup = {};
for (const p of seed.places) dup[p.id] = (dup[p.id] ?? 0) + 1;
const dups = Object.entries(dup).filter(([, n]) => n > 1);
console.log('种子内重复 id =', dups.length, dups.slice(0, 5));

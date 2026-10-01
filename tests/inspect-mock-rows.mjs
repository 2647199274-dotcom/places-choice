import { openDb } from '../src/db/index.ts';
const db = await openDb();
const rows = db.prepare("SELECT id, name, category_id, coord_precision, rating, cost, amap_url FROM place WHERE id LIKE 'B0MOCK%'").all();
console.log('mock rows =', rows.length);
for (const r of rows) console.log(JSON.stringify(r));
const total = db.prepare('SELECT COUNT(*) n FROM place').get().n;
console.log('total =', total);

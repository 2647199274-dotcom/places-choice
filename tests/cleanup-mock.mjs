import { openDb } from '../src/db/index.ts';
const db = await openDb();
const n = db.prepare("DELETE FROM place WHERE id LIKE 'B0MOCK%'").run().changes;
console.log(`已清理 mock 测试数据 ${n} 条`);
console.log('库内剩余:', db.prepare('SELECT COUNT(*) n FROM place').get().n);
console.log('抽签历史:', db.prepare('SELECT COUNT(*) n FROM draw_history').get().n);

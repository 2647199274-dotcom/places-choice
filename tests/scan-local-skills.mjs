// 扫描本地 skill 目录：列出每个 SKILL.md 的名称与描述
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'E:\\小车生涯\\轮腿\\my claude skills';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === 'SKILL.md') out.push(full);
  }
  return out;
}

const files = walk(ROOT);
console.log(`共找到 ${files.length} 个 SKILL.md\n`);

const rows = [];
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let name = '', desc = '';
  if (fm) {
    const n = fm[1].match(/^name:\s*(.+)$/m);
    const d = fm[1].match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|$)/m);
    name = n ? n[1].trim() : '';
    desc = d ? d[1].replace(/\s+/g, ' ').trim() : '';
  }
  if (!name) {
    const h = txt.match(/^#\s+(.+)$/m);
    name = h ? h[1].trim() : path.basename(path.dirname(f));
  }
  if (!desc) {
    const lines = txt.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
    desc = (lines[0] ?? '').slice(0, 200);
  }
  const repo = path.relative(ROOT, f).split(path.sep)[0];
  rows.push({ repo, name, desc: desc.replace(/^["']|["']$/g, ''), file: path.relative(ROOT, f) });
}

rows.sort((a, b) => (a.repo + a.name).localeCompare(b.repo + b.name));
let cur = '';
for (const r of rows) {
  if (r.repo !== cur) { cur = r.repo; console.log(`\n===== ${cur} =====`); }
  console.log(`- ${r.name}`);
  console.log(`  ${r.desc.slice(0, 220)}`);
}

fs.writeFileSync(path.join(process.cwd(), 'tests', 'out', 'local-skills.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(`\n已写入 tests/out/local-skills.json（${rows.length} 条）`);

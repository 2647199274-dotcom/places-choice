/**
 * 本地模拟 GitHub Pages：静态托管 web/dist（**没有** /api 后端）
 * 用途：在部署前验证"静态数据集回退"这条路真的能跑通。
 * 用法: node scripts/serve-dist.mjs [--port 5180]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'web', 'dist');
const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 5180);
/** 模拟 Pages 的子路径部署：/places-choice/ */
const BASE_PATH = process.env.SERVE_BASE ?? '/places-choice';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`❌ ${DIST} 里没有 index.html，先跑 npm run build:web`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  // 子路径前缀：/places-choice/xxx → /xxx（先剥离，这样 /api 判断对两种情况都成立）
  if (BASE_PATH && urlPath.startsWith(BASE_PATH)) urlPath = urlPath.slice(BASE_PATH.length) || '/';

  // /api/* 在 Pages 上不存在 —— 故意返回 404，以验证前端会回退到静态数据
  if (urlPath.startsWith('/api/')) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'NOT_FOUND', message: '静态托管没有后端（这是故意的，用来验证回退）' }));
    return;
  }

  let filePath = path.join(DIST, urlPath === '/' ? 'index.html' : urlPath);

  if (!filePath.startsWith(DIST)) {
    res.statusCode = 403;
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA 回退
    filePath = path.join(DIST, 'index.html');
  }
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🌐 模拟 GitHub Pages 已启动（静态、无后端）`);
  console.log(`   打开: http://127.0.0.1:${PORT}${BASE_PATH}/`);
  console.log(`   /api/* 会返回 404 —— 前端应自动回退到 ${BASE_PATH}/data/dataset.json`);
});

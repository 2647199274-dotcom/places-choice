/* Service Worker：让手机端"添加到主屏幕"后打开更快、断网也能用
 *
 * 策略：
 *   - 页面与构建产物（HTML/JS/CSS/图标）：cache-first（App Shell）
 *   - 数据文件 data/dataset.json：stale-while-revalidate（先给旧的，后台悄悄更新）
 *   - /api/*：直接走网络（本地开发用），不缓存
 *
 * 注意：离线抽签逻辑不在 SW 里，而在 web/src/localDraw.ts —— 这里只负责缓存。
 */
const VERSION = 'trip-roulette-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const BASE = new URL('./', self.location).pathname; // 子路径部署时自动带上 /places-choice/
const SHELL_ASSETS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}icons/icon.svg`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 高德等外链不拦截

  // 接口一律直连网络，SW 绝不掺和（否则 404 会被下面的导航兜底换成 HTML，前端拿到 HTML 会误判）
  if (url.pathname.includes('/api/')) return;

  // 静态资源（含 data/*.json）：绝不返回 HTML，避免把 index.html 当成 JSON 喂给前端
  const isAsset = /\.(js|css|json|webmanifest|svg|png|jpg|jpeg|webp|woff2?|ico)$/i.test(url.pathname);
  if (isAsset && !/\/data\/(dataset|meta)\.json$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(req, res.clone());
          }
          return res; // 404 也原样返回，不要替换成 HTML
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  // 数据文件：stale-while-revalidate
  if (/\/data\/(dataset|meta)\.json$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return cached ?? (await network) ?? Response.error();
      })(),
    );
    return;
  }

  // 页面导航：cache-first，离线回退到缓存的首页
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok && (SHELL_ASSETS.includes(url.pathname) || req.mode === 'navigate')) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        if (req.mode === 'navigate') {
          const shell = (await caches.match(`${BASE}index.html`)) ?? (await caches.match(BASE));
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});

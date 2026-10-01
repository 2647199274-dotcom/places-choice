import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

// 调试/测试用：把本地抽签引擎挂到 window，供 tests/verify-local.mjs 在真实浏览器里对比两端结果
import { localDraw, randomCategoryIds, resolveCategories } from './localDraw.ts';
(window as unknown as Record<string, unknown>).__tripRoulette = { localDraw, randomCategoryIds, resolveCategories };

// PWA：注册 Service Worker（仅生产构建，避免开发时缓存干扰热更新）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL ?? '/';
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* 注册失败不影响使用（例如非 HTTPS 环境） */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

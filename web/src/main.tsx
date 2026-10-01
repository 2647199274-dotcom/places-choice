import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

// 调试/测试用：把本地抽签引擎挂到 window，供 tests/verify-local.mjs 在真实浏览器里对比两端结果
import { localDraw, randomCategoryIds, resolveCategories } from './localDraw.ts';
(window as unknown as Record<string, unknown>).__tripRoulette = { localDraw, randomCategoryIds, resolveCategories };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

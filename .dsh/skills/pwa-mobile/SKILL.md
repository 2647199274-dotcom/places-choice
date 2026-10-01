---
name: pwa-mobile
description: 让本项目的网页在手机上像 App 一样使用（添加到主屏幕、全屏无地址栏、离线可用、有图标）。当用户说"手机 App""添加到主屏幕""装到手机上""PWA""离线打开""图标""全屏"时使用。
---

# 手机端 PWA（像 App 一样打开）

目标：手机浏览器打开 `https://2647199274-dotcom.github.io/places-choice/` → 菜单里"添加到主屏幕" → 桌面出现图标，
点开全屏无地址栏，断网也能转盘。

## 必须交付的四个文件

1. **`web/public/manifest.webmanifest`**（参考 `mistydew/e-invoice-stock-form` 的写法）
   ```json
   {
     "name": "出去玩 · 地点选择转盘",
     "short_name": "出去玩转盘",
     "start_url": "./index.html",
     "scope": "./",
     "display": "standalone",
     "background_color": "#0b0e1f",
     "theme_color": "#6c8cff",
     "lang": "zh-CN",
     "icons": [{ "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }]
   }
   ```
2. **`web/public/icons/icon.svg`**：转盘主题的矢量图标（圆盘 + 指针 + 🎡 意象），512×512 viewBox
3. **`web/public/sw.js`**：App Shell 缓存（**cache-first**）
   - 预缓存：`index.html`、构建出的 `assets/*.js|css`、`data/dataset.json`
   - 关键：数据文件用 **stale-while-revalidate**（离线用旧数据，联网静默更新）
   - 版本号写死（如 `trip-roulette-v1`），发新版时改版本号并清旧缓存
4. **`web/index.html`** 里加：`<link rel="manifest" href="manifest.webmanifest">`、`<meta name="theme-color">`、
   `<link rel="icon" href="icons/icon.svg">`，并在 `main.tsx` 里注册 SW（仅生产环境注册）

## 本项目特有的注意点

- **离线能力已经内建**（`web/src/localDraw.ts` + `store.ts` 的 localStorage 数据集）。
  PWA 的 SW 只是让它更快、更可靠；**不要**用 SW 重复实现一遍离线抽签逻辑。
- **iOS 不支持 SVG 图标**：iPhone 加主屏需要 PNG 180×180。要么补一张 `apple-touch-icon.png`，
  要么明确告诉用户 iOS 上图标会是截图。
- **`start_url` 用相对路径**（`./index.html`），因为部署在子路径 `/places-choice/` 下。
- **调试**：Chrome DevTools → Application → Service Workers 里勾 Offline 复现断网；
  用了 SW 后**硬刷新（Ctrl+Shift+R）**才拿得到新版本，必要时在 DevTools 里 Unregister 旧 SW。

## 验收（必须真机或模拟器验证，不要只看代码）

1. 手机/移动模拟视图打开线上地址，控制台无 404，manifest 被识别（DevTools → Application → Manifest 无报错）
2. "添加到主屏幕"后打开：无地址栏、图标正确、启动即到转盘
3. 飞行模式打开：仍能抽签，结果卡能跳高德（离线链接是 uri 形式，会唤起高德 App）
4. 数据更新后重新打开：`data/dataset.json` 被静默更新（比对 `meta.json` 的 `generatedAt`）

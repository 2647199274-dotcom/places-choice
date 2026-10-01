---
name: offline-dataset
description: 生成/更新前端离线数据集（静态 dataset.json），以及维护"离线本地抽签引擎与后端引擎规则一致"。当用户说"离线""静态数据""dataset""导出数据""部署后手机上没数据""断网"时使用。
---

# 离线数据集与引擎一致性

## 两条数据通路（必须都通）

```
在线：浏览器 → /api/dataset（Fastify）→ 写 localStorage
离线：浏览器 → /data/dataset.json（静态文件，Pages 上就是这个）→ 写 localStorage
再离线：localStorage → web/src/localDraw.ts 本地抽签
```

PWA 的 service worker 只做缓存，**不要**在 SW 里重新实现抽签逻辑。

## 硬性要求

1. **同一份 JSON 结构**：`generatedAt / categories / requiredIds / cities / provinces / districts / areas / places`
   （`areas` 是各城市的 地铁/地区/商圈/商场 维度，离线筛区域要用）
2. **前后端抽签规则必须完全一致**：`src/core/draw.ts`（后端）与 `web/src/localDraw.ts`（前端）是两份实现，
   任何一边改了规则（权重、扇区收敛、冷却、过滤、区域交集），必须同步另一边，并跑：
   ```powershell
   npm run test:local     # 注入同一随机源，逐字段比对
   ```
   历史经验：这个测试能抓到"离线转出来的结果跟在线不一样"这类隐蔽 bug。
3. **缓存要能被识别**：`meta.json` 或 `generatedAt` 用于前端显示"数据更新于 N 分钟前"。
4. **缓存版本化**：localStorage key 形如 `trip-roulette:dataset:v1`；结构变更时升版本号，避免读到旧结构崩掉。
5. **容量**：数据集现在约 0.6–2 MB（2500 条含 areas 更大）。localStorage 上限约 5 MB，
   全国数据必须裁剪（只带用户抽过的城市）或改用 IndexedDB —— 到那一步再改，别提前复杂化。

## 验收

```powershell
npm run test:local    # 前后端引擎逐字段一致（9 个场景）
npm run test:web      # 真实 Chrome 里屏蔽 /api/** 后仍能转盘
```

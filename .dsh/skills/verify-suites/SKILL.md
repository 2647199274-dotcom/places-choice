---
name: verify-suites
description: 改动后该跑哪些测试、测试失败了怎么定位。当用户说"测试""验证一下""跑一下""断言""CI""确保没问题"时使用。任何提交前都该走一遍这里。
---

# 验证套件地图（改什么 → 跑什么）

改完代码**先跑对应套件再提交**（`git-commit-save` skill 里也做了这个要求）。

| 套件 | 命令 | 覆盖什么 | 什么时候必须跑 |
|---|---|---|---|
| 类型 | `npm run typecheck` | 全部 TS/TSX | 任何改动 |
| 抽签引擎 | `npm run test:draw` | 吃饭规则、权重公平性（6000 次卡方）、冷却、过滤、空池 | 动 `src/core/draw.ts`、`config/categories.json`、`web/src/localDraw.ts` |
| 多城市 | `npm run test:region` | 11 市逐城可抽、随机城市只落有数据城市、全省随机跨城、SQL 边界、数据卫生 | 动 db 查询、地区逻辑 |
| 全国框架 | `npm run test:china` | 区划归一化（直辖市）、省→市展开、`--province`/`--city-limit`、缓存 BOM 容错、311 城市批量查询 | 动 `src/collect/{districts,targets}.ts` |
| 区域维度 | `npm run test:areas` | 四维聚合、单维/交集过滤、空交集、高德字段覆盖率 | 动 `src/core/areas.ts`、`/api/areas` |
| 采集器 | `npm run test:collector` | 内置 mock 高德：请求参数、字段解析、去重、幂等、无坐标降级、三种链接 | 动 `src/collect/amap.ts` |
| 前后端引擎一致 | `npm run test:local` | 注入同一随机源，前端本地引擎与后端逐字段一致（9 场景） | 动任一侧抽签规则（**最容易漏**） |
| 界面 | `npm run test:web` | 真实 Chrome：默认全选、吃饭可取消、区域筛选抽签、随机城市、全省随机、断网离线、高德链接、控制台错误 | 动前端任何地方 |
| 一键 | `npm test` | 上面前 6 项 | 提交前 |

## 沙箱注意

`test:web` / `test:local` 需要启动 Chrome，在受限沙箱下会 `spawn EPERM`；
`build:web` 需要 esbuild 子进程同理。**这两种情况按规则申请提权重试一次**，不要改脚本绕过。

## 失败怎么定位（真实案例）

| 症状 | 根因 | 教训 |
|---|---|---|
| `SQLite3 can only bind numbers...` | 采集数据里有 undefined/对象 | 已加 `sanitizeForDb()`；新增字段记得一起清洗 |
| `RangeError: Too few parameter values` | SQL 占位符数量与参数不匹配（`IN (?)` 复用） | 每个 `IN (...)` 各占一份占位符；已加空数组边界测试 |
| `[db] SQLite 不可用…改用 JSON 数据源` | 迁移顺序错误（索引建在缺列的旧表上） | 现在库不可用直接抛错，不再静默降级 |
| 采集"新增 0 条"但接口返回了数据 | 上一条的降级路径吞掉了写入 | 采集前 `await requireDb()` |
| 同一家店在转盘上出现两次 | 老 id 残留 + 新 id | `ensureSeeded` 清理陈旧 seed 行；种子生成器做同城同名去重 |
| 测试报 mock 路径 404 | 生产代码换接口了（v5→v3），mock 没跟着改 | 改接口时同步改 `verify-collector.mjs` 的 mock |

## 硬规则

- **不允许为了让测试过而放宽断言**；要改断言必须说清"新行为为什么是对的"。
- 新增维度/新接口，就要在对应套件里补一条**能失败**的断言（比如"结果必须落在筛选区域内"），
  只统计数量不算验证。

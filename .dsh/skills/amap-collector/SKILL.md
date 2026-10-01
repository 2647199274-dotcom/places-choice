---
name: amap-collector
description: 用高德开放平台 API 采集地点数据（新增城市/分类、扩大采集范围、补采区域维度、排查采集失败或配额问题）时使用。当用户说"采集""爬高德""扩到某城市""数据不够""补数据""配额"时使用。
---

# 高德采集规范

Key 在项目根目录 `.env` 的 `AMAP_KEY`（**绝不进仓库**）。验证：`npm run collect -- --check`。

## 铁律（都是实测踩出来的）

1. **用 v3，不要用 v5**。同一查询「杭州火锅」：v5 只回 25 条（截断），v3 回 `count=600`。
2. **分页必须 `page` 递增、`offset` 固定 `0`**。`offset` 递增会重复上一页数据（证据：`tests/probe-amap-paging.mjs`）。
   每页最多 10 条，上限 45 页 → 单查询最多 450 条，所以要**用"关键词 × 分页"把结果摊开**。
3. **必须 `extensions=all`**，否则没有 `biz_ext`（评分/人均/营业时间）。
4. **限速 350ms/请求**（约 3 QPS），失败重试 2 次，不要并发轰炸。
5. **入库前必须确认数据库可用**：`collectCategory` 开头会 `await requireDb()`。
   历史上的坑：迁移失败静默降级 JSON，一整轮请求白跑且数据被丢弃。
6. **分类要用配置驱动**：`config/categories.json` 的 `amapTypes` + `keywords`。改采集口径只改这个文件。

## 字段映射（v3 → 本项目 place）

| 高德字段 | 我们字段 | 说明 |
|---|---|---|
| `id` | `id` / `amapPoiId` | 100% 有，用它生成 `https://www.amap.com/place/{id}` |
| `name` / `address` / `location` | 同名 | `location` = "lng,lat"，精确坐标 |
| `adname` / `adcode` | `district` / `districtAdcode` | **adcode 是区县级**，所以另有 `cityAdcode` 作为按城市查询的键 |
| `business_area` | `businessArea` | 商圈名，支撑"按商圈选区域" |
| `typecode` | `typecode` | 末级品类码；`1505xx`=地铁站，`0601xx`=商场 |
| `biz_ext.rating` / `biz_ext.cost` | `rating` / `cost` | 覆盖率约 96% / 65% |
| `tel` / `biz_ext.opentime_today` / `photos[0].url` | `tel` / `opentime` / `photo` | |

## 常用命令

```powershell
npm run collect -- --check                                   # 验证 Key + 分页
npm run collect -- --city 杭州市 --adcode 330100 --all --pages 3
npm run collect -- --scope zhejiang --all --pages 2          # 全省
npm run collect -- --scope china --plan                      # 全国先看规模（不发请求）
npm run collect -- --scope china --province 广东省 --all --pages 2
npm run collect:areas -- --city 杭州市 --adcode 330100        # 采地铁站 + 商场，并重建地铁关联
```

## 配额与规模

- 单个城市 × 27 分类 × 3 关键词 × 3 页 ≈ 730 次请求（杭州实测约 4 分钟）。
- 全国 300+ 城市全量不现实 → **按需采集 + 本地缓存**：用户抽到某城市时再补采。
- `collect_log` 表记录每次调用（来源/城市/关键词/页/条数/成败），排查配额与失败原因直接查它。
- 免费额度按日重置；`--scope china --plan` 会给出预计请求数，先看规模再决定分几批。

## 验收

改完采集相关代码，必须跑：
```powershell
npm test                      # 含 verify-collector（mock 高德，不需要 Key）
node tests/inspect-db.mjs     # 看字段覆盖率：poiid 应 ~100%、精确坐标 ~100%
```

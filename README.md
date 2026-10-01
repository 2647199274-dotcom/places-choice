# 出去玩 · 地点选择转盘（Trip Roulette）

选地区 + 选项目 → 转一下，落到哪家就去哪家；结果卡片一点即跳高德。

- 📄 爬取可行性实测报告：`docs/01-爬取可行性报告.md`（含每个站点的原始证据）
- 📄 完整项目计划：`docs/02-项目计划.md`
- 📄 Android APK 打包说明：`docs/03-Android打包说明.md`
- 🧪 原始探测数据：`tests/out/`

## 现在就能用（无需任何 Key）

```bash
npm install
npm run seed          # 生成浙江 11 市种子数据（671 条，27 个分类）
npm run api           # 启动服务，浏览器打开 http://127.0.0.1:5178
```

界面功能：
1. **① 选地区**（三档）：`选城市`（浙江 11 市，按钮上带数据条数）/ `随机城市`（只在有数据的城市里抽）/ `全省随机`（11 市混抽，抽中哪座城市就去哪）
2. **② 选项目**：`人工选`（🍜 吃饭为必选、不可取消，其余可多选；该城市没数据的项目会灰显）或 `随机抽`（抽 N 个项目，**同样强制包含吃饭**，并自动跳过空分类）
3. **③ 过滤**：排除已去过 / 人均上限 / 评分下限
4. 点 **🎡 开始转动** → 转盘旋转 → 抽中结果卡片（城市、区县、评分、人均、推荐理由）
5. 卡片按钮：**在高德打开**、**一键导航**、**就去这家**（记入足迹）、**再转一次**

**离线可用**：首次打开会把全量数据集缓存到浏览器；后端不可达（关掉服务 / 手机断网 / APK 里没连上电脑）时自动切到**离线模式**，
用同一套抽签规则在本地转盘，结果卡照样能跳高德。顶部徽标会明示「🌐 已连接后端」或「📴 离线模式（本地缓存 · N 分钟前更新）」。

命令行同样可用：

```bash
npm run categories                          # 查看 27 个项目
npm run draw -- --city 杭州市 --categories eat,hotpot,ktv
npm run draw -- --scope random-city --count 3      # 随机城市
npm run draw -- --scope province --count 3         # 全省随机
```

## 接入真实高德数据（推荐，需 3 分钟申请 Key）

1. 打开 https://console.amap.com/dev/id/phone 注册并完成**个人开发者实名认证**
2. 「应用管理 → 创建新应用 → 添加 Key」，**服务平台选【Web 服务】**（不要选 Web 端 JS API）
3. 复制 `.env.example` 为 `.env`，填入 `AMAP_KEY=你的key`
4. 验证 Key 并采集：

```bash
npm run collect -- --check                                        # 验证 Key
npm run collect -- --city 杭州市 --adcode 330100 --all --pages 3    # 单城市
npm run collect -- --scope zhejiang --all --pages 2               # 浙江 11 市
npm run collect -- --scope china --plan                           # 全国：只预览规模，不发请求
npm run collect -- --scope china --province 广东省 --all --pages 2  # 全国：按省分批采
npm run draw -- --scope province --count 3                        # 用真实数据抽签
```

采集器特性：内置 3 QPS 礼貌限速、失败重试、按 id 去重、`ON CONFLICT` 幂等更新、
原始响应落盘 `data/raw/`、每次调用写入 `collect_log` 表（可查配额消耗与失败原因）。
高德返回的是**区县** adcode，采集器会同时写入 `city_adcode`（抽签按城市查）与 `region_adcode`（区县）。

## 部署到 GitHub Pages（手机上直接打开链接用）

参考你自己的 `mistydew/e-invoice-stock-form`（纯静态 + Actions 发布 + PWA），我们照同一套做法：

```powershell
npm run export:static                 # 导出静态数据快照到 web/public/data/dataset.json（精简格式，约 2.8MB）
npm run serve:dist                    # 本地模拟 Pages（会故意让 /api 返回 404，验证静态回退）
```

推送到 `main` 后 `.github/workflows/deploy.yml` 自动构建并发布：

**线上地址：`https://2647199274-dotcom.github.io/places-choice/`**（手机浏览器打开 → 菜单「添加到主屏幕」→ 像 App 一样用）

⚠️ 首次部署前需要在仓库里做一次性设置：**Settings → Pages → Source 选 `GitHub Actions`**。
（个人账号仓库不支持工作流自助开启，`configure-pages` 的 `enablement: true` 只对组织仓库有效。）

### 构建 base 路径的坑（踩过）

- **Pages 部署**：必须 `VITE_BASE=/places-choice/`（CI 里已自动设置），否则资源 404 → 白屏
- **本地 / APK / 普通托管**：用**根路径**构建（`npm run build:web` 不带 VITE_BASE）
- 同一份 `web/dist` 不能同时服务两种场景。所以本地跑 `npm run api` 前，先做一次根路径构建；
  我为此在 `tests/verify-web.mjs` 里把首屏等待改成"等控件出现"，避免数据量大时误判。

线上没有后端，跑的是**静态数据快照**：本地采到新数据后 `npm run export:static` 再 push，线上就更新。
高德 Key 只在本地 `.env`（已 gitignore），**不会**出现在线上或仓库里。

## 数据维护

```powershell
npm run collect -- --check                                   # 验证 Key 与 v3 分页
npm run collect -- --city 杭州市 --adcode 330100 --all --pages 3
npm run collect -- --scope zhejiang --all --pages 2          # 浙江 11 市
npm run collect:areas -- --city 杭州市 --adcode 330100        # 地铁站 + 商场 + 重建地铁关联
npm run dedupe -- --dry                                      # 查看种子数据与真实数据的重复（不修改）
npm run dedupe                                               # 标记重复的种子行为 seed-dup（可回滚）
npm run export:static                                        # 导出线上用的静态快照
```

数据现状：**11 城 / 11973 条**（高德真实 11326 + 人工种子 647），评分覆盖 99%、商圈 59%、
带高德 poiid 100%、精确坐标 100%。真实数据优先，重复的种子行会被标记为 `seed-dup` 不再参与抽签。

## 验证（都是真跑出来的，不是"应该没问题"）

```bash
npm test              # typecheck + 抽签引擎 + 多城市 + 全国框架 + 采集器
npm run test:web      # 真实 Chrome 跑完四档路径（含断网离线）并截图 tests/out/ui-*.png
npm run test:local    # 校验"离线本地引擎"与"后端引擎"逐字段一致（需服务在跑）
```

| 套件 | 验什么 |
|---|---|
| `test:draw` | 吃饭必选（人工+随机 500 次 0 漏）；6000 次空转卡方 16.8（df≈16）证明落点与权重一致、无内定；冷却/过滤/空池边界 |
| `test:region` | 11 市 × 27 类别逐城可抽且城市匹配；随机城市只落有数据城市；全省随机跨 11 城；空参数/单城/多城 SQL 边界；数据卫生 |
| `test:china` | 全国区划归一化（含直辖市层级）、省→市展开、`--province`/`--city-limit` 过滤、缓存读写（含 BOM 容错）、311 城市码批量查询压力 |
| `test:collector` | 内置 mock 高德服务，验证请求参数、评分/人均解析、去重、幂等、无坐标降级、三种链接、采集目标解析 |
| `test:web` | 指定城市/随机城市/全省随机/断网离线 四条路径 + 高德链接 + 无真实控制台错误 |
| `test:local` | 注入同一随机源，前端本地抽签与后端抽签的候选数/扇区/落点/赢家逐字段一致（9 个场景） |

## 目录结构

```
config/categories.json   27 个项目分类（可自由增删；amapTypes/keywords 决定采集口径）
seed/build-seed.mjs      种子数据生成器（含同城同名去重与自检）
seed/data-zhejiang.mjs   浙江 10 市地点数据（杭州在 build-seed.mjs 内）
data/seed-hangzhou.json  671 条地点（离线可玩）
data/trip.db             SQLite（地点/足迹/抽签历史/采集日志）
src/core/                类型 + 加权抽签引擎
src/links/amap-link.ts   高德链接生成（三种形态，均已实测验证）
src/collect/             高德官方 API 采集器 + 采集目标解析 + 全国行政区划（省→市）
src/db/                  SQLite 建模、仓储、种子补灌与陈旧行清理
src/server/              Fastify API + 静态前端托管 + /api/dataset（离线数据集）
src/cli/                 命令行抽签 / 采集
web/src/                 React 转盘界面（含离线引擎 localDraw.ts 与本地缓存 store.ts）
capacitor.config.ts      Android 打包配置（P4）
docs/                    报告、计划、打包说明
tests/                   探测脚本 + 4 套验证脚本 + 原始证据
```

## 已知边界与后续计划

- **高德网页版无法逆向**：未登录即滑块登录墙，内部接口返回空壳 HTML → 一律走官方 API（详见报告）
- **小红书 / 大众点评 / 美团 / 马蜂窝 / 去哪儿**：登录墙 + 滑块 + JS 挑战，**不做自动化抓取**；
  评价内容改用 B 站 API + 携程移动端静态页，并为「去小红书搜这家」保留人工外链入口
- 非杭州城市的**坐标为区县中心近似值**（`coordPrecision=approx`），评分为常见口碑近似值；
  配置 Key 采集后自动升级为精确 poiid/坐标/评分
- **APK**：Capacitor 已配好，但本机**缺 Android SDK**（JDK 21 已有），装好 SDK 后见 `docs/03-Android打包说明.md`
- 路线：杭州试点 ✅ → 全杭州 ✅ → 全浙江（种子数据已通，待真实采集）→ **全国（采集框架已通，待 Key 分批采集）**
- 全国采集量级很大（300+ 城市 × 27 分类），按设计**按需采集 + 本地缓存**，并用 `--scope china --plan` 先看规模再分省跑


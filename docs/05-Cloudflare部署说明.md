# Cloudflare Pages 部署说明（国内可直连的备用线上地址）

> 目标：**不买域名、不备案**，拿到一个国内多数地区能直连的永久 HTTPS 链接，手机照样"添加到主屏幕 / 离线可用"。
> 与 GitHub Pages 并存（互不影响），GitHub Pages 那条继续作为备份地址。

- 线上地址（待创建）：`https://places-choice.pages.dev/`（项目名被占用时 Cloudflare 会自动加后缀，以控制台显示为准）
- 现有备用地址：`https://2647199274-dotcom.github.io/places-choice/`

---

## 一、为什么选 Cloudflare Pages

| 维度 | Cloudflare Pages | GitHub Pages |
|---|---|---|
| 国内直连 | 社区实测反馈**最好**（"大部分地区可直连"） | 不稳定，`github.io` 经常打不开 |
| 流量 | **无限** | 软限制（约 100GB/月） |
| 费用 | 免费（500 分钟构建/月） | 免费 |
| 备案 | **不需要** | 不需要 |
| HTTPS | 自动 | 自动 |

> 参考：[三款国内可直连的免费静态托管横评](https://zblog.hqyman.cn/post/17760.html)
> 其它候选与它们的坑：EdgeOne Pages 免备案时大陆只给 **3 小时预览链接**；
> CloudBase 默认域名会**弹中间页 + 把 HTML 变成下载**。详见交接稿里的平台对比。

---

## 二、部署前必须知道的 4 个约束（踩过就别再踩）

### 1. `base` 必须是根路径 —— **不要设 `VITE_BASE`**

GitHub Pages 在子路径 `/places-choice/` 下，所以 CI 里设了 `VITE_BASE=/places-choice/`。
**Cloudflare Pages 是根路径部署，设了反而白屏。** 在 CF 的环境变量里**留空或不填** `VITE_BASE`。
（`web/vite.config.ts` 默认 `base: '/'`；Service Worker 用 `new URL('./')` 自适应，两种部署都兼容。）

### 2. 千万不要加 `_redirects` / SPA 兜底

前端判断"有没有后端"的方式是：请求 `/api/dataset` **失败**就回退读静态快照。
如果加了 `/* /index.html 200` 这类兜底，`/api/dataset` 会返回 **200 + HTML**，前端会误判成"在线"，
接着拿 HTML 当 JSON 解析 —— 这正是交接稿里记过的那个坑。
本项目是单页应用、没有前端路由，**不需要任何 rewrite**。

### 3. 数据集必须已提交进仓库（CI 不会帮你导出）

CF 构建时**不会**生成 `web/public/data/dataset.json`，用的是仓库里提交的那一份（25820 条）。
换了数据记得先 `npm run export:static` 再提交 —— 交接稿第 4 节有这条铁律。

### 4. Node 版本必须是 22

Vite 7 要求 Node ≥ 20.19。仓库里已有 `.nvmrc`（内容 `22`），同时在 CF 控制台加一个环境变量
`NODE_VERSION = 22` 双保险（CF 两者都认）。

---

## 三、部署（Git 集成，推荐 —— 以后 push 即自动发布）

### 第 1 步：注册 Cloudflare

打开 https://dash.cloudflare.com/sign-up ，用邮箱注册并验证（免费，不需要信用卡）。

### 第 2 步：进入 Pages

登录后看**左侧竖排菜单**：

1. 找 **`Compute (Workers)`** 或 **`Workers & Pages`**（新界面在 `Compute` 分组下）
2. 点进去后，看**顶部/右侧**的 **`Create`** 按钮 → 选 **`Pages`** 标签页
3. 点 **`Connect to Git`**（即 "Import an existing Git repository"）

### 第 3 步：授权 GitHub 并选仓库

1. 点 **`Connect GitHub`** → 弹出 GitHub 授权页 → 选 **`Only select repositories`** → 勾选 **`places-choice`** → **`Install & Authorize`**
2. 回到 Cloudflare，列表里出现 `2647199274-dotcom/places-choice` → 点 **`Begin setup`**

### 第 4 步：构建设置（**照抄这张表**）

| 字段（英文界面原文） | 填什么 |
|---|---|
| `Project name` | `places-choice`（决定域名 `places-choice.pages.dev`；被占用会自动加后缀） |
| `Production branch` | `main` |
| `Framework preset` | **`None`**（不要选 Vite，会套用错误的输出目录） |
| `Build command` | `node scripts/verify-static-dataset.mjs && npm run build:web` |
| `Build output directory` | `web/dist` |
| `Root directory` | **留空**（不要填 `web`） |

> `Build command` 里那半句校验是故意的：快照规模不对（比如又退化成 671 条种子）会让 **CF 构建直接失败**，
> 而不是把错数据发到线上。

### 第 5 步：环境变量

在同一个页面展开 **`Environment variables (advanced)`**（或 `Variables and Secrets`），加一条：

| Variable name | Value |
|---|---|
| `NODE_VERSION` | `22` |

**不要**加 `VITE_BASE`。

### 第 6 步：部署

点 **`Save and deploy`** → 等着看构建日志（首次约 1–3 分钟）→ 出现 **`Success: Your site was deployed!`** 即成功，
页面顶部会给出 `https://places-choice.pages.dev` 之类的链接。

### 第 7 步：验证

```powershell
# 把 <你的域名> 换掉
curl.exe -I https://places-choice.pages.dev/                                  # 期望 200
curl.exe -I https://places-choice.pages.dev/data/dataset.json                 # 期望 200
curl.exe -s -I https://places-choice.pages.dev/data/dataset.json | Select-String content-length   # 期望 6555435
curl.exe -s -o NUL -w "%{http_code}`n" https://places-choice.pages.dev/api/dataset  # 期望 404（前端靠这个判断"没后端"）
```

最后一行**必须是 404**：如果返回 200，说明有人加了 `_redirects`，前端会误判在线。
再打开 `https://<你的域名>/` 确认转盘能转、能抽签、能跳高德。

### 第 8 步：手机

用**移动流量**（不挂梯子）打开那个 `*.pages.dev` 链接 → 能开就说明国内直连 OK → 浏览器菜单里选
**"添加到主屏幕"** → 之后全屏、离线都能用。

### 控制台里的两个命令字段（**最容易踩的坑**）

Worker 项目的构建分三步，注意**第二步不是自动的**：

| 步骤 | 谁执行 | 日志里的样子 |
|---|---|---|
| 1. 装依赖 | CF 自动（检测到 `package-lock.json` 就跑 `npm ci`） | `Installing project dependencies: npm clean-install` |
| 2. **跑构建** | **`Build command` 字段 —— 新建项目时默认是空的！** | `Executing user build command: ...` |
| 3. 部署 | `Deploy command` 字段（默认 `npx wrangler deploy`） | `Executing user deploy command: npx wrangler deploy` |

**如果第 2 步没跑，`web/dist` 就不存在，wrangler 会报：**

```
✘ [ERROR] The directory specified by the "assets.directory" field in your configuration file does not exist:
  /opt/buildhome/repo/web/dist
```

（曾实际发生过：日志里 `clean-install` 之后直接跳到 `deploy command`，中间没有构建。）

**修法（推荐，只改一个字段）**：项目 → `Settings` → `Build` → 把 **`Deploy command`** 改成

```
npm run deploy:cf
```

这个脚本在 `package.json` 里，内容是
`verify-static-dataset.mjs && npm run build:web && npx --yes wrangler deploy` ——
**校验快照 → 构建 → 部署**一条龙，不依赖 Build command 字段是否被填。
（`Build command` 留空即可；若它非空会多构建一次，无害但慢。）

**修法 B（标准两段式）**：`Build command` 填
`node scripts/verify-static-dataset.mjs && npm run build:web`，
`Deploy command` 保持默认 `npx wrangler deploy`。

---

## 三之二、如果你建成了 **Worker**（Workers + Static Assets）

Cloudflare 现在把「从 Git 导入」做成了 **Worker** 流程：构建日志里会出现
`Executing user deploy command: npx wrangler deploy`，拿到的域名是 `places-choice.<账号>.workers.dev`。
**这不是错误**，CF 官方称这是目前推荐的新方式，对纯静态站来说和 Pages 功能一致。
（作者实测记录：[静态站点迁移到 Cloudflare Workers](https://zhujiangtao.com/posts/migrate-static-site-to-cloudflare/)）

### 需要的三处配置

| 位置 | 值 |
|---|---|
| 仓库里的 `wrangler.jsonc`（**已提交**） | `assets.directory = "./web/dist"`，且**不设** `not_found_handling` |
| 控制台 → 项目 → `Settings` → `Build` → `Build command` | `node scripts/verify-static-dataset.mjs && npm run build:web` |
| 控制台 → 项目 → `Settings` → `Build` → `Output directory` | `web/dist`（CF 的 Vite 预设会默认填成 `dist`，**必须改**） |

`Framework preset` 建议改成 `None`（选 Vite 会让它假设输出目录是根目录的 `dist`，与本仓库不符）。

### 为什么 `wrangler.jsonc` 必不可少

Worker 的部署命令是 `npx wrangler deploy`，它从**仓库里的 wrangler 配置**读静态资源目录；
控制台里那个 `Output directory` 只是检测提示。仓库里没有配置文件时，
wrangler 会因缺少 entry-point / assets 而部署失败。

### 绝对不要设 `not_found_handling: "single-page-application"`

官方文档明确：该选项会让**未命中的路径返回 `200 OK` + `index.html`**（见
[Worker 静态资源路由文档](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)）。
而本项目前端判断"有没有后端"的方式正是**请求 `/api/dataset` 拿到 404**：

```ts
// web/src/api.ts
const body = await res.json().catch(() => null);   // 200 + HTML → 这里返回 null，不抛错
if (!res.ok) throw new Error(...);                 // 404 → 才抛错 → 回退读静态快照
```

所以 `"single-page-application"` 会让前端**静默误判成"在线"且拿不到数据**。
`wrangler.jsonc` 里因此**不设**该字段（默认就是未命中返回 404，正是我们要的）。

### ⚠️ `workers.dev` 在国内被 DNS 污染（**本机实测数据**）

2026-10-01 部署成功后，在**本机（国内网络）**实测 `https://places-choice.2647199274.workers.dev`：

| 检查 | 结果 | 说明 |
|---|---|---|
| DNS A 记录 | `128.242.245.212` / `31.13.85.2` | ❌ **都不是 Cloudflare 的 IP**。前者 ipinfo 归属 AS203020 HostRoyale（西班牙），后者是 **Facebook/Meta 的段** |
| 随机名字 `random-xyz123-test.workers.dev` | `75.126.164.178` | ❌ 换成任意名字都解析到假 IP，且每次不同 → **整段域名被投毒**，不是你这一个站点的问题 |
| DNS AAAA 记录 | `2a03:2880:f102:183:face:b00c:0:25de` | ❌ `2a03:2880` 是 **Facebook 的 IPv6 段**，`face:b00c` 是典型投毒特征 |
| TCP 443 / HTTP | **超时 / `000`** | 连不通 |
| 对照：`www.cloudflare.com` | `104.16.123.96` → **200** | ✅ **Cloudflare 真实节点是通的**，被污染的只是 `workers.dev` 这个域名 |

### ✅ 但 `pages.dev` 是通的（**同一时刻实测，8/8 全部可达**）

| 站点 | 解析到的 IP | HTTP |
|---|---|---|
| `cloudflare-docs-7ou.pages.dev` | `172.66.45.18` | **200** |
| `remix.pages.dev` | `172.66.45.33` | **200** |
| `vitepress.pages.dev` | `172.66.47.50` | **200** |
| `astro.pages.dev` | `172.66.46.247` | **200** |
| `hugo.pages.dev` | `172.66.44.209` | **200** |
| `vue.pages.dev` | `172.66.45.34` | **200** |
| `nuxt.pages.dev` | `172.66.44.153` | 404（Cloudflare 真实响应 = 通） |
| `sveltekit.pages.dev` | `172.66.46.224` | 522（Cloudflare 真实响应 = 通） |

`172.66.x.x` 是 **Cloudflare 的真实 anycast 段**。8 个站点全部拿到真实 HTTP 响应，
说明 **`pages.dev` 没有被污染，国内可以访问**。

### 结论与推荐路径

| 需求 | 该怎么做 |
|---|---|
| **免费、国内能开、现在就要** | 建一个 **Pages 项目**（**不是 Worker**）→ 域名是 `places-choice.pages.dev` → 直接可用 |
| 免费但要自动发布 | Pages + Git 集成（push 即部署），见第三节 |
| 想继续用已建好的 Worker | 必须**绑自定义域名**（`workers.dev` 被污染，免费域名救不了）。Cloudflare 真实 IP 可达 → 绑了就能用。免备案，域名约 ¥10–30/年 |
| 一分钱不花又最稳 | **GitHub Pages**（本机实测全绿）或 **APK**（完全离线） |

### ❌ 换 Gitee 解决不了这个问题（重要）

常见误解："把仓库传到 Gitee，再让 Cloudflare 从 Gitee 导入，是不是国内就能访问了？" **不行**，两个独立原因：

1. **被墙的是最终域名，不是代码托管**。Cloudflare 从哪拉代码（GitHub / GitLab / 直传）跟站点域名无关 ——
   站点仍然是 `places-choice.<账号>.workers.dev`，照样打不开。上面实测的随机名字都被投毒，就是最好的证明。
2. **Cloudflare 不支持 Gitee**。官方文档原文：*"Cloudflare supports connecting Cloudflare Pages to your
   **GitHub and GitLab** repositories"*，其它平台（如 Bitbucket）只能走 **Direct Upload + CI**
   （[官方 Git 集成文档](https://developers.cloudflare.com/pages/configuration/git-integration/)）。

另外 **Gitee 自己的 Pages 服务已停服**，也不能拿它当免费静态托管。

### 实测对照：GitHub Pages 在同一个网络下是可用的

同一时刻、同一台机器实测 `https://2647199274-dotcom.github.io/places-choice/`：

```
/                      → 200
/data/dataset.json     → 200，content-length = 6555435（完整 25820 条）
/api/dataset           → 404  ✅（前端靠这个判断"没有后端"）
/sw.js / manifest / icons → 全 200
```

DNS 解析到的是**真实 IP**（185.199.108-111.153），没有被污染。

**所以：不要因为"听说 github.io 国内打不开"就急着换平台 —— 先用手机实测。**
本项目这台机器/这条网络下，GitHub Pages 比 `workers.dev` 可用得多。

（环境差异很大，换运营商/换时间可能不同，所以两个地址都留着做备份。）

---

## 三之四、最快路径：命令行直传一个 **Pages 项目**（推荐）

既然实测 **`pages.dev` 国内可达、`workers.dev` 被投毒**，最省事的就是建一个 **Pages 项目**。
命令行直传**不需要**走控制台的 Git 授权，也不受"Build command 字段是空的"那类坑影响：

```powershell
# 1) 首次：登录 Cloudflare（打开浏览器授权，只需一次）
npx wrangler login

# 2) 首次：创建 Pages 项目（只需一次）
npm run cf:pages:init

# 3) 发布：校验快照 → 构建 → 直传
npm run deploy:cf-pages
```

成功后输出会给出地址：`https://places-choice.pages.dev`。

> 想改成"push 即自动发布"：① 走第三节的 Git 集成（把 **Pages** 项目连到 GitHub 仓库，
> `Framework preset` 选 `None`、构建命令 `npm run build:web`、输出目录 `web/dist`、环境变量 `NODE_VERSION=22`）；
> ② 或加一个 GitHub Actions 工作流用 `wrangler pages deploy` 直传（需在仓库配 `CLOUDFLARE_API_TOKEN` 密钥）。
>
> **注意**：`wrangler.jsonc` 里的 `assets.directory` 是给 Worker 用的；Pages 直传时目录由命令参数指定，
> 该文件不参与。万一 Pages 的 Git 构建因为读到它而报错，把它临时改名即可。

---

## 四、以后怎么更新

```powershell
# 改完代码 / 更新数据后
npm run export:static      # 只有在数据变了时才需要（会更新 web/public/data/*.json）
npm test                   # 七套全绿再提交
git add -A ; git commit -m "feat: ..." ; git push origin main
```

push 之后 **Cloudflare 和 GitHub Pages 会各自自动重新构建发布**，两个地址都会更新。

手动触发重跑：CF 控制台 → `Workers & Pages` → 点项目 → **`Deployments`** 标签 → 右上角 **`Retry deployment`**。
回滚到旧版本：同一个 `Deployments` 列表里，找到要回滚的那次，右侧 **`⋯`** → **`Rollback to this deployment`**。

---

## 五、备选：命令行直传（不想接 Git，或想让构建环境绕开 better-sqlite3）

本机已经有构建好的 `web/dist` 时：

```powershell
# 1) 用根路径构建（注意不要设 VITE_BASE）
npm run build:web

# 2) 首次会拉起 wrangler 并让你登录（浏览器授权）
npx wrangler@latest pages deploy web/dist --project-name places-choice
```

适合场景：CF 构建环境里 `npm ci` 编译 `better-sqlite3` 报错时 —— 本机构建再直传，完全绕开它
（静态构建其实根本不需要 `better-sqlite3`，它只服务本地后端）。

---

## 六、排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `✘ assets.directory ... does not exist: /opt/buildhome/repo/web/dist` | **构建没跑**（`Build command` 是空的，`web/dist` 没生成）→ 日志里 `clean-install` 后直接是 `deploy command` | 把 `Deploy command` 改成 `npm run deploy:cf`，见第三之二节 |
| 部署成功但访问的是别的 Worker / 报名字不匹配 | `wrangler.jsonc` 的 `name` 与控制台项目名不一致 | 把项目名改成 `places-choice`（与配置一致），或改配置里的 `name` |
| 页面白屏、控制台报 `/assets/...` 404 | 设了 `VITE_BASE=/places-choice/` | 删掉该环境变量，重新部署 |
| 构建报 `vite: command not found` / Node 版本错 | Node 版本过低 | 确认 `.nvmrc` = 22 且环境变量 `NODE_VERSION=22` |
| 构建卡在 `better-sqlite3` 报错 | CF 环境编译原生模块失败 | 改用第五节的命令行直传 |
| 页面能开但没数据 | `web/public/data/dataset.json` 没提交 | 本地 `npm run export:static` 后提交 |
| 前端显示"在线"但数据为空 | 加了 `_redirects` 让 `/api/dataset` 返回了 200 HTML | 删掉 `_redirects`，重新部署 |
| 手机上看的是旧版本 | Service Worker 缓存 | 用无痕窗口，或清除浏览器数据；见下节 |

---

## 七、已知注意

1. **PWA 更新策略偏保守**：`web/public/sw.js` 对 HTML/JS/CSS 用 cache-first，`sw.js` 自身内容不变时
   浏览器不会更新 SW。所以**旧版本 App Shell 可能长期驻留**（数据文件是 stale-while-revalidate，会后台更新）。
   真要强制刷新：改一下 `sw.js` 里的 `VERSION` 常量。
2. **两个线上地址并存**，是**两个不同 origin**：各自的 Service Worker 缓存、IndexedDB 数据互相独立，
   手机上会表现为"两个独立的 App"。建议只把其中一个"添加到主屏幕"，避免混淆。
3. **换域名后本地足迹不互通**：抽签足迹存在 localStorage/IndexedDB 里，绑定 origin，不会跟着域名走。

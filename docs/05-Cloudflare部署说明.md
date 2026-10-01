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

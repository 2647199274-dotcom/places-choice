---
name: gh-pages-deploy
description: 把本项目（出去玩·地点选择转盘）部署到 GitHub Pages，让手机浏览器打开一个链接就能用。当用户说"部署""上线""发布""手机上打开""GitHub Pages""给我个链接""Actions 构建"时使用。也用于排查 Pages 构建/发布失败。
---

# 部署到 GitHub Pages

参考实现：用户自己的 `mistydew/e-invoice-stock-form` —— 纯静态站点 + Actions 自动发布 + PWA。我们照这个模式做。

仓库：`git@github.com:2647199274-dotcom/places-choice.git`（SSH 推送已验证可用）
线上地址：`https://2647199274-dotcom.github.io/places-choice/`

## 与参考应用的唯一区别：数据怎么来

参考应用是纯前端、数据在浏览器本地算。我们有两种数据来源，**默认走静态快照**：

1. **主路线（推荐）**：把数据库导出成静态 `dataset.json` 打进站点
   - 前端 `api.ts` 的 `dataset()` 先试 `/api/dataset`，失败则回退静态文件
   - 好处：不暴露高德 Key（Key 只在本地 `.env`，永不进仓库）、零服务器成本、秒开
   - 代价：数据是"上次导出时"的快照；要更新就重跑导出并 push
2. **可选路线**：手机连同一局域网时访问电脑上的 `npm run api`（`VITE_API_BASE=http://<电脑IP>:5178`）
   - 只有临时调试才这么干，不要写进正式构建

## 要做的事

1. **静态数据导出脚本** `scripts/build-static-dataset.mjs`
   - 调本项目自己的 `/api/dataset`（或直接读 SQLite）→ 写 `web/public/data/dataset.json`
   - 同时写一个 `meta.json`（`generatedAt`、`placeCount`、`cityCount`），前端用来显示数据日期
2. **前端回退**：`web/src/api.ts` 里 `dataset()` 失败时 fetch `/data/dataset.json`
3. **构建**：`vite build --base=/places-choice/`（Pages 子路径必须设 `--base`，否则资源 404）
4. **Actions** `.github/workflows/deploy.yml`（照参考应用那份写，逐行对齐）
5. **`.nojekyll`**：放在发布目录里，避免 Pages 忽略下划线开头的资源

## 校验清单（缺一项都会线上白屏）

- [ ] `--base=/places-choice/` 与仓库名一致
- [ ] `web/dist/index.html` 里的资源路径带 `/places-choice/` 前缀
- [ ] `dataset.json` 能匿名访问（`curl -I https://.../data/dataset.json` 返回 200）
- [ ] 静态托管时 `/api/*` 不存在，前端必须能回退到本地数据（已有离线引擎兜底）
- [ ] 仓库 Settings → Pages → Source 选 **GitHub Actions**
- [ ] `.env` 没有被提交（`git ls-files | grep -c "^\.env$"` 应为 0）

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面白屏、控制台 404 一堆 js/css | `--base` 没设或写错仓库名 | 改 `--base=/<repo>/` 重建 |
| 打开是 README | Pages Source 选成了 "Deploy from a branch" | 改成 GitHub Actions |
| 更新了数据但线上没变 | 只改了本地 SQLite | 重跑静态导出 → 提交 → push |
| Actions 报 `npm ci` 失败 | `package-lock.json` 没提交 | 提交 lock 文件 |
| Android 上无法"添加到主屏幕" | 缺 manifest 或非 HTTPS | 见 `pwa-mobile` skill |

## 更新流程（日常）

```powershell
npm run collect -- --city 杭州市 --all --pages 3   # 可选：更新数据
npm run export:static                              # 导出 dataset.json
npm run build:web                                  # --base=/places-choice/ 构建
npm test                                           # 提交前必跑
# 走 git-commit-save skill 提交并推送 → Actions 自动发布
```

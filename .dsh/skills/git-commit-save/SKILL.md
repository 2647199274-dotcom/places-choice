---
name: git-commit-save
description: 每次修改完代码后，把改动提交到 git 并推送到远程仓库（GitHub），形成可回滚的历史版本。当用户说"保存一下""存个档""上传一下""提交一下""commit""push""记录版本""GitLens 上传"，或在本项目里完成一次功能修改/修复/文档更新之后需要落盘留痕时使用。也用于首次初始化仓库、配置远程、查看历史与回滚。
---

# 修改即存档（git commit + push）

本项目（E:\direction chose，出去玩·地点选择转盘）的约定：**每完成一次可验证的修改就存档一次**。
这样任何时候都能回到上一个能跑的版本。GitLens 只是 VS Code 里看 Git 历史的界面插件，
"上传保存历史版本"的实际动作就是下面的 `git add / commit / push`。

## 铁律

1. **先验证再提交**：提交前必须确认改动没把项目弄坏。至少跑：
   ```powershell
   npm run typecheck
   ```
   涉及抽签/数据/采集的改动，再跑 `npm test`（含 4 套引擎与数据测试）。
   测试没过 → 不要提交，先修好。
2. **不要提交不该进仓库的东西**：`node_modules/`、`.npm-cache/`、`.env`（含高德 Key，属机密）、
   `data/*.db`（本地数据库）、`data/raw/`（采集原始响应）、`web/dist/`、`android/`。
   这些已写在 `.gitignore` 里；若发现缺失，先补 `.gitignore` 再提交。
3. **提交信息用中文、说清"改了什么 + 为什么"**，一行标题 +（可选）要点列出：
   ```
   feat: 项目选择加入地铁/商圈维度筛选

   - 新增 /api/areas 聚合地铁站/商圈/商场
   - 前端项目区改为下拉折叠，默认全选
   - 修正：美食类默认选中但不再锁定
   ```
   前缀用 feat / fix / docs / test / chore / refactor 之一。
4. **一次提交只做一件事**：不要把无关改动混在一个 commit 里。若工作区里混着多件事，
   用 `git add <具体文件>` 分批提交。
5. **推送失败不要装作成功**：明确把错误原文告诉用户，并给出下一步（配 token / 换远程地址）。

## 标准流程

```powershell
# 0) 看看现在是什么状态
git status --short
git log --oneline -5

# 1) 首次：初始化 + 关联远程（只在没有 .git 时需要）
git init -b main
git remote add origin https://github.com/<用户名>/<仓库名>.git

# 2) 暂存（按需要只加相关文件；全部改动用 -A）
git add -A

# 3) 提交
git commit -m "feat: 一句话说清这次改了什么"

# 4) 推送
git push -u origin main
```

## 首次推送前的检查

- 确认用户 GitHub 用户名与仓库名（本项目作者相关账号：`mistydew`；本机 git 全局身份是
  `maple-trace-scholar <2647199274@qq.com>`，如需改动先问用户）。
- 确认 `.env` 不会被提交：`git status --short | Select-String "\.env"` 应无输出。
- 远程仓库不存在时，先让用户在 GitHub 网页上新建一个**空仓库**（不要勾选 README），再推。
- **凭证**：本机没有 `gh` CLI。HTTPS 推送需要用户名 + Personal Access Token（不是登录密码）。
  如果 `git push` 报 `Authentication failed`，就用这条命令让 Git 弹出登录窗口：
  ```powershell
  git config --global credential.helper manager
  ```
  或改用 SSH（先把公钥加到 GitHub）：
  ```powershell
  ssh -T git@github.com
  git remote set-url origin git@github.com:<用户名>/<仓库名>.git
  ```

## 回滚与查看历史

```powershell
git log --oneline --graph -20          # 看历史（GitLens 里就是这条时间线）
git show <commit> --stat               # 看某次改了什么
git restore <文件>                      # 丢弃某个文件的未提交改动
git revert <commit>                    # 安全回滚（生成一次反向提交，推荐）
git reset --hard <commit>              # 硬回滚（会丢改动，慎用，先问用户）
```

## 部署相关（本项目已规划 GitHub Pages）

推送到 `main` 后，`.github/workflows/` 里的工作流会自动构建并发布到 GitHub Pages，
手机浏览器打开 `https://<用户名>.github.io/<仓库名>/` 即可使用（还能"添加到主屏幕"当 App）。
所以**每次 push 都可能顺带更新线上版本**，提交前务必确认测试通过。

# 本项目的 Skill 清单

放在 `.dsh/skills/<名字>/SKILL.md`，启动时会自动被识别。每个 skill 都是"改这类东西之前必读"的操作规范。

| Skill | 什么时候用 |
|---|---|
| `git-commit-save` | 每次改完要存档：先跑测试 → 提交 → 推送 GitHub |
| `gh-pages-deploy` | 部署到 GitHub Pages、手机上打开链接、Pages 构建失败排查 |
| `pwa-mobile` | 添加到主屏幕、全屏、图标、离线打开 |
| `amap-collector` | 采集/扩城市/补数据/配额与失败排查 |
| `area-filter` | 区域四维筛选（地铁/地区/商场/商圈）逻辑 |
| `roulette-rules` | 抽签规则（权重、公平性、吃饭选项、冷却过滤） |
| `offline-dataset` | 离线数据集与前后端引擎一致性 |
| `ui-design-system` | 界面样式与移动端适配（美团的克制风格，不是炫技） |
| `verify-suites` | 改完该跑哪些测试、失败了怎么定位 |
| `research-sources` | 评估新数据源能否采集 |
| `karpathy-guidelines` | 通用编码自律（克制、外科手术式改动、先验证） |
| `frontend-design` | 前端设计参考（本项目只取其细节打磨，不采纳其"大胆炫技"方向） |

## 来源说明

- `karpathy-guidelines`、`frontend-design`：直接来自用户本机 `E:\小车生涯\轮腿\my claude skills`
  （`andrej-karpathy-skills`、`explore-claude-code/skills`），原样保留。
- `research-sources`：由本地 `academic-research-skills/deep-research` 裁剪而来 ——
  只保留"数据源能不能采/怎么采/合规吗"这条主线，去掉论文综述那套流程。
  需要真正深度的多智能体研究时，去用上游那份完整版。
- `gh-pages-deploy`：参考社区 `web-deploy-github` skill（"静态站 + GitHub Actions 部署到 Pages"）的思路，
  结合本项目实际（Vite 构建、`--base` 子路径、静态 dataset 快照、Key 不进仓库）重写，
  没有与它重复安装一个功能重叠的 skill。
- 其余 6 个（`git-commit-save`、`pwa-mobile`、`amap-collector`、`area-filter`、`roulette-rules`、
  `offline-dataset`、`ui-design-system`、`verify-suites`）为本项目定制。

## 维护约定

- skill 里写的规则如果与代码不一致，**以代码为准并立刻改 skill** —— 过期的 skill 比没有更糟。
- 新增"必须遵守"的操作流程时，写成 skill；写成长文档没人会在动手前读。

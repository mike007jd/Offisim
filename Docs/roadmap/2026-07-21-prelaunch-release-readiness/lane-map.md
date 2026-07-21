# Prelaunch release readiness lane map

当前候选版本：`1.1.2`（prepared corrective candidate；尚未 tag）。整体状态仍为
`IN PROGRESS`；未完成的 release / live / Kimi 项不得勾选。仓库已 PUBLIC；
`v1.1.1` 已于 2026-07-21 正式发布为 GitHub Latest stable，其 tag 与发布 commit
保持 unchanged；不得把 `v1.1.2` 写成已发布或 authorized candidate。

| Lane | Goal | Child loop / owner | Boundary | Dependency | Oracle | Risk | Status |
|---|---|---|---|---|---|---|---|
| L0 | 修正并锁定 release 编排边界 | verified iteration / Codex + Cursor harness | `scripts/run-clean-release.mjs`、release docs、窄 harness | — | script syntax、boundary harness、docs truth | high | COMPLETE |
| L1 | 建立全量门禁与 clean release 基线 | release readiness / Codex | build outputs、`output/release-evidence` | L0 | `pnpm release:run`、bundle hash、codesign verify | high | IN PROGRESS |
| L2 | 核真活动 roadmap、架构、承诺与用户旅程 | plan synthesis / fresh checkers | read-only docs/code/evidence | — | 带路径/行号的 finding 与 promise/journey matrix | medium | COMPLETE |
| L3 | 修复工程、依赖、安全、文档真值 findings | review-verify-fix / Cursor 简单、Codex 复杂 | 按 finding 分配单写者文件边界 | L1,L2 | impact、窄 gate、fresh checker | high | COMPLETE |
| L4 | 全 surface UI/UX 审计与修复 | UI/UX audit / Kimi K3 High | renderer visual/layout/motion surfaces；不碰 runtime/data contracts | L3 | 宽/窄窗口、5 态、accessibility、视觉 diff review | high | IN PROGRESS |
| L5 | fan-in 后完整组合门禁 | release readiness / Codex | 全仓组合态 | L3,L4 | release gates、risk-matched harness、GitNexus detect changes | critical | IN PROGRESS |
| L6 | release `.app` 真实旅程与三连 streak | real-user live verify / fresh checker + Codex Computer Use | 精确 app path、测试 profile/workspaces | L5 | 三轮 P0 全过；截图 + 磁盘/DB 证据 | critical | PENDING |
| L7 | 承诺核真、baseline 与平台待核清单 | release readiness / Codex + fresh checker | evidence docs、release metadata | L6 | promise table、artifact fingerprint、环境/性能/合规清单 | high | PENDING |
| L8 | GO / NO-GO 判定与本地收口 | release readiness / Codex | 本轮证据与临时资源 | L7 | requirement-by-requirement completion audit | critical | PENDING |

## 并行与冲突规则

- Wave 1：L0 与 L2 并行；Cursor 只写 harness catalog，Codex 只写 release script/docs，checker 全部只读。
- Wave 2：L1 后按 finding 拆 L3；同文件与共享契约串行，禁止 Cursor/Kimi 并写。
- Wave 3：L4 只在工程/功能真值冻结后启动；视觉 specialist 不改 backend、schema、security 或 release scripts。
- Wave 4：L5-L8 串行；只有 integration lane 更新最终任务状态与放行结论。

## Protected actions

`v1.1.1` 发布动作已完成且保持不变。`1.1.2` 的 tagging、notarization、GitHub
publication、replacement installation（含 `/Applications/Offisim.app` 替换）均
等待显式 `v1.1.2` authorization；当前不是 authorized candidate。用户 profile、
native agent home 和真实生产数据仍受保护，不得删除。

## 当前证据（2026-07-22）

- `v1.1.1` 已发布为 Latest stable；历史 changelog / release notes / tag / hash /
  assets 事实保留，不得改写为未发布。
- `1.1.2` 仅完成 prepared corrective candidate 的机械版本/文档准备；exact
  release-app / distribution evidence 仍 pending，且不得复用 `v1.1.1` evidence
  证明 installed-app Codex launch 修复路径。
- 当前 NO-GO / 未闭环项：exact `1.1.2` release `.app` 证据、notarization、
  GitHub publication、replacement installation，以及显式 `v1.1.2`
  authorization 本身。

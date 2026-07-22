# Prelaunch release readiness lane map

当前发布版本：`1.1.2`（stable Latest；已 tag / notarized / published /
installed）。整体状态为 `COMPLETE`。L0–L8 全部 `COMPLETE`。仓库已 PUBLIC；
`v1.1.2` 已于 2026-07-22 正式发布为 GitHub Latest stable，target commit
`703e4f3760319cb5081881fef511d8cc853ec416`。历史 `v1.1.1` 发布事实保留为
prior stable，不再是 Latest。

| Lane | Goal | Child loop / owner | Boundary | Dependency | Oracle | Risk | Status |
|---|---|---|---|---|---|---|---|
| L0 | 修正并锁定 release 编排边界 | verified iteration / Codex + Cursor harness | `scripts/run-clean-release.mjs`、release docs、窄 harness | — | script syntax、boundary harness、docs truth | high | COMPLETE |
| L1 | 建立全量门禁与 clean release 基线 | release readiness / Codex | build outputs、`output/release-evidence` | L0 | `pnpm release:run`、bundle hash、codesign verify | high | COMPLETE |
| L2 | 核真活动 roadmap、架构、承诺与用户旅程 | plan synthesis / fresh checkers | read-only docs/code/evidence | — | 带路径/行号的 finding 与 promise/journey matrix | medium | COMPLETE |
| L3 | 修复工程、依赖、安全、文档真值 findings | review-verify-fix / Cursor 简单、Codex 复杂 | 按 finding 分配单写者文件边界 | L1,L2 | impact、窄 gate、fresh checker | high | COMPLETE |
| L4 | 全 surface UI/UX 审计与修复 | UI/UX audit / Kimi K3 High | renderer visual/layout/motion surfaces；不碰 runtime/data contracts | L3 | 宽/窄窗口、5 态、accessibility、视觉 diff review | high | COMPLETE |
| L5 | fan-in 后完整组合门禁 | release readiness / Codex | 全仓组合态 | L3,L4 | release gates、risk-matched harness、GitNexus detect changes | critical | COMPLETE |
| L6 | release `.app` 真实旅程与三连 streak | real-user live verify / fresh checker + Codex Computer Use | 精确 app path、测试 profile/workspaces | L5 | 三轮 P0 全过；截图 + 磁盘/DB 证据 | critical | COMPLETE |
| L7 | 承诺核真、baseline 与平台待核清单 | release readiness / Codex + fresh checker | evidence docs、release metadata | L6 | promise table、artifact fingerprint、环境/性能/合规清单 | high | COMPLETE |
| L8 | GO / NO-GO 判定与本地收口 | release readiness / Codex | 本轮证据与临时资源 | L7 | requirement-by-requirement completion audit | critical | COMPLETE |

## 并行与冲突规则

- Wave 1：L0 与 L2 并行；Cursor 只写 harness catalog，Codex 只写 release script/docs，checker 全部只读。
- Wave 2：L1 后按 finding 拆 L3；同文件与共享契约串行，禁止 Cursor/Kimi 并写。
- Wave 3：L4 只在工程/功能真值冻结后启动；视觉 specialist 不改 backend、schema、security 或 release scripts。
- Wave 4：L5-L8 串行；只有 integration lane 更新最终任务状态与放行结论。

## Protected actions

`v1.1.1` 历史发布动作保持不变（prior release）。`v1.1.2` 的 tagging、
notarization、GitHub publication、replacement installation（含
`/Applications/Offisim.app` 替换）已完成。用户 profile、native agent home 和
真实生产数据仍受保护，不得删除；本轮 closeout 后原 `~/.offisim` 已恢复。

## 当前证据（2026-07-22，v1.1.2 closeout）

### Prepublication candidate（历史）

- 候选组合态曾对齐 `b15233c4d4550bd7cd7f4295d79569e52c52e109`；Hosted CI 与
  CodeQL 对该 commit 均为 green。
- Kimi K3 High UI audit / fixes 与独立 checker 已完成（L4 COMPLETE）。
- 正式 `pnpm release:run` 五门全过；合格证据
  `output/release-evidence/2026-07-22T00-00-33-996Z-b15233c4`；bundle sha256
  `ddf09d97e302b335f8dbc7d4d53115e4cb407d8569fdecd42c7ba698db06a065`
  （L1 / L5 COMPLETE）。
- 精确候选 release `.app` 在隔离测试数据下完成三轮 Computer Use streak；证据含
  九张 hashed screenshots 与同目录 `live-streak.json`。

### Published distribution artifact（权威闭环；关闭 L6 / L7 / L8）

- GitHub release：`v1.1.2` stable Latest，
  https://github.com/mike007jd/Offisim/releases/tag/v1.1.2 ，target commit
  `703e4f3760319cb5081881fef511d8cc853ec416`。
- Apple app notarization Accepted：`3fcd782f-4940-4540-ae12-9a497025cfda`。
- DMG notarization Accepted：`be0bbc35-33ff-4a28-b5c2-abb6e7ec8b3c`。
- Update ZIP sha256：
  `a744d4b9abeae88c7cca20bf583c206dfa1ed998825fd9c75e3f9803cd37c9dd`。
- DMG sha256：
  `1fa101ad91cf64408f62eea8d66fedc9b2c481e6734288d11a45610e7028572c`。
- `/Applications/Offisim.app` 为 `v1.1.2`，并通过 codesign、stapler validate、
  Gatekeeper。
- 已安装分发产物在隔离 profile 下 live streak `3/3` 通过；证据
  `output/release-evidence/offisim-1.1.2-1784685927142/installed-live-streak.json`
  （L6 COMPLETE）。
- Publication / notary / install metadata 与 baseline 已闭环（L7 COMPLETE）。
- 原 `~/.offisim` 已恢复；GitHub security baseline 保持 complete。
- L8 COMPLETE：判定 `GO`。未复用 `v1.1.1` evidence 证明 `1.1.2` 修复路径；
  也未用 prepublication 候选 `.app` 证据代替已安装分发产物验收。

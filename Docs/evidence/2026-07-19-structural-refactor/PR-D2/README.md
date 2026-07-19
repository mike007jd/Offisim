# PR-D2 — task_workspace_binding 机械拆分证据

- 状态：code-complete / release-live-pending
- 日期：2026-07-19
- 分支：`refactor/D2-binding-module-split`
- PR 拓扑基线：`refactor/D1-git-module-split`；纯移动比对源仍为 A3 `397e8d38:task_workspace_binding.rs`
- 范围：仅把 `task_workspace_binding.rs` 拆成指定的四个 `binding/` 子模块；未新增其他 binding 模块。D1 已用 merge commit `45792225` 合入本分支并保留双方 harness 路径，PR #108 已 retarget 到 D1；未 merge 到父分支，release `.app` live 尚未执行。

## 行数

| 文件 | 行数 |
| --- | ---: |
| 拆分前 `task_workspace_binding.rs` | 6,986 |
| 拆分后 `task_workspace_binding.rs` | 1,227 |
| `binding/resume_compat.rs` | 2,283 |
| `binding/registry.rs` | 1,036 |
| `binding/persistence.rs` | 1,694 |
| `binding/project_crud.rs` | 843 |
| 拆分后合计 | 7,083 |

净增 97 行来自模块声明、跨模块 import/re-export、最小可见性提升及测试文件相对路径适配。

## 纯移动证明

- 以 `397e8d38:apps/desktop/src-tauri/src/task_workspace_binding.rs` 为源，按 GitNexus 拆分前符号位置对移动范围内的函数、impl、struct、enum 和常量做机械比对。
- 共核对 122 个符号：122 个匹配，0 个缺失。
- 比对仅归一化允许的机械差异：`pub(super)` / `pub(in super::super)` 可见性、`cargo fmt` 空白和尾逗号，以及测试 `include_str!` 因文件下移一级产生的 `../`。
- 函数体、常量值、注释、错误文案、签名和授权判定均未改变；授权中枢仍由 `task_workspace_binding.rs` 统一接线并 re-export。
- 原文件测试按职责随对应模块迁移；Rust 测试共 458 个全部通过。

## Gates

| Gate | 结果 |
| --- | --- |
| `node scripts/prepare-desktop-cargo-test.mjs` | PASS |
| `cd apps/desktop/src-tauri && cargo fmt --check` | PASS |
| `cd apps/desktop/src-tauri && cargo test --locked` | PASS（458 passed，0 failed） |
| `CI=true pnpm install --frozen-lockfile` | PASS |
| `node scripts/release-gates.mjs --lane=node` | PASS（4/4 gates green） |
| GitNexus `detect_changes`（compare `397e8d38`） | PASS（medium，5 条预期 workspace authority flow） |
| `git diff --check` | PASS |

接管后的 D1→D2 组合提交再次通过 Node release gates 4/4、Rust 458/458、`cargo fmt --check` 与 `git diff --check`；唯一合并冲突位于 `harness-project-workspace.mts` 的源码路径表，已同时保留 D1 的 Git 模块和 D2 的 binding 模块读取路径，断言本身未改。

## 风险复核

- 聚合安全分类保持 **CRITICAL**：接管审计按 workspace authority、resume、registry、persistence、Project CRUD 边界合计识别 37 条流程实例；这是跨符号人工安全分类，不等同于单次 diff 的标签。
- 最新代表性 upstream 分析：`resolve_task_workspace_for_turn` 为 HIGH，3 个直接依赖横跨 Codex / Claude / Pi lane，并命中 2 个流程根、3 个流程实例。
- 纯 D2 compare 的 GitNexus 结果为 MEDIUM，命中 5 条预期 workspace authority flow；D1 合入时的 staged change detection 同样为 MEDIUM，11 个符号、2 条 Git filesystem-identity 流程。两者均未被用于降低整体安全等级。

## 偏差

计划偏差：无。

为保持既有静态合同继续读取同一份 Rust 语义，三个 harness 仅更新了源文件路径或把入口与对应子模块源码拼接后再执行原断言；断言、错误文案和判定逻辑均未变化。Tauri command 宏符号通过入口显式 re-export，保持既有 `generate_handler!` 路径不变。

## Release live 门禁

- 待在当前提交重新构建精确 release `.app` 后，分别以 Pi、Codex、Claude 验证授权目录读写、越界拒绝、重启后的 Resume。
- OpenRouter 凭据轮换前不执行 Pi 调用；Claude 额度恢复前不宣称 Claude lane 完整验收。上述外部阻塞不改变已通过的机械拆分证明，但会保持 PR 为未完整交付。

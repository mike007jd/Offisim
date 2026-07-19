# PR-D2 — task_workspace_binding 机械拆分证据

- 状态：completed
- 日期：2026-07-19
- 分支：`refactor/D2-binding-module-split`
- 基线：`refactor/A3-rust-dedup`（`397e8d38`）
- 范围：仅把 `task_workspace_binding.rs` 拆成指定的四个 `binding/` 子模块；未新增其他 binding 模块，未做 release live、push 或 merge。

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

## 偏差

计划偏差：无。

为保持既有静态合同继续读取同一份 Rust 语义，三个 harness 仅更新了源文件路径或把入口与对应子模块源码拼接后再执行原断言；断言、错误文案和判定逻辑均未变化。Tauri command 宏符号通过入口显式 re-export，保持既有 `generate_handler!` 路径不变。

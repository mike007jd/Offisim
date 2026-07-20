# PR-D2：`task_workspace_binding.rs` clean rebuild

- 状态：clean rebuild 代码、静态门禁、当前 head release `.app` 与 Codex/Pi live verify 均已完成。
- 基线：`origin/main@48748cd4e87f2ad61e22c5321a013043fb32cf55`。
- 分支：`rebuild/D2-binding-module-split`。
- 核对时间：2026-07-20 NZST。
- 范围：仅将 `task_workspace_binding.rs` 按职责机械拆为 `binding/{registry,resume_compat,persistence,project_crud}.rs`；入口继续负责模块装配与必要 re-export。
- 基线已包含 D1 Git 拆分、D3 builtin 拆分、#111 Codex Project file-change boundary 修复和 #112 shell environment boundary 修复。

## 机械拆分证明

本次未 cherry-pick 旧 D2 提交。五个 Rust 文件从已审计的最终机械拆分内容重建，并逐文件校验 Git blob：

| 文件 | Git blob |
| --- | --- |
| `task_workspace_binding.rs` | `2e17d75655be43acb45fc2f0b6e3ba7bb1a70443` |
| `binding/persistence.rs` | `145652b19a5bd48c2107372f2079a73ffb8993bd` |
| `binding/project_crud.rs` | `341357ba4884680cec9e57c4f86f9ec38bc9a101` |
| `binding/registry.rs` | `0a4e641b0a580ca9dcc3f659520696ddff3f50b4` |
| `binding/resume_compat.rs` | `8ed539d06c2d61138b7d3d5c3485bd0dd395e2e7` |

当前 main 的拆分前源文件与原审计源 blob `adfc74078cd0740761edf43627dfadc76ee314df` 相同。函数体、签名、常量、错误文案与授权判断不变；新增差异仅为模块声明、import/re-export、必要可见性和测试相对路径。

三个 source harness 保留当前 main 已合入的 D1/D3 oracle，同时加入 D2 binding 路径并集；断言语义不变。

## 风险

- GitNexus 编辑前 upstream：`resolve_task_workspace_binding` 为 **CRITICAL**，覆盖 Project 文件工具与 Git 执行流程。
- `resolve_task_workspace_for_turn` 为 **HIGH**，有 3 个直接调用者，横跨 Codex、Claude 与 Pi lane。
- `validate_task_workspace_binding_authority` 为 **HIGH**，有 5 个直接调用者。
- 因此本变更即使是纯机械拆分，仍按授权中枢高风险变更验证，不以 diff 标签降低风险。

## 已实际通过

- `cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pnpm harness:project-workspace`：1/1
- `pnpm harness:first-run-onboarding`：21/21
- `pnpm harness:review-fixes`：1/1 聚合门禁
- `node scripts/prepare-desktop-cargo-test.mjs && cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`：470 passed，0 failed
- `node scripts/release-gates.mjs --lane=node`：4/4 gates green；validate harness 73/73
- GitNexus `detect_changes(compare origin/main)`：MEDIUM，22 个 changed symbol、1 条受影响流程；不用于降低上方授权中枢的 CRITICAL/HIGH 风险。

## release `.app` live verify

- 验证 head：`797d301faae8595842cca89b9cd501a844ce9ae2`。
- 精确产物：`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`；version `1.0.0-rc.2`，arm64。
- Developer ID + hardened runtime 签名及 `codesign --deep --strict` 通过；main binary SHA-256 为 `05fc62461b8649a2a07f0a062bf9d446209d4f07ec5c4ed590e0cc83559d9157`。
- 本机 `spctl` 返回 accepted，但 Gatekeeper assessments disabled；产物是 `Unnotarized Developer ID`、无 stapled ticket，本记录不把它表述为正式分发验收。
- Computer Use 绑定上述精确 `.app`，窗口 URL 为 `tauri://localhost`；独立临时 Project `/private/tmp/offisim-d2-live-project.JPUv05` 与 outside fixture `/private/tmp/offisim-d2-live-outside.SDdArd` 未复用 W6 或旧 D2 sentinel。
- Codex CLI 同一 run 先在 Project 内创建 `d2-live-inside.txt`，内容精确为 `D2_LIVE_INSIDE_OK\n`；再尝试 outside 绝对路径，`file_change` 返回 `codex_tool_failed`，界面报告 `outside：已被 Offisim 拒绝，未创建`，4/4 stages completed。
- 磁盘 oracle：outside 原文件仍精确为 `D2_OUTSIDE_UNCHANGED\n`，`codex-outside.txt` 不存在。
- Pi built-in Read 得到 `D2_READ_OK`，随后 Write 创建 `pi-live-inside.txt`，内容精确为 `D2_PI_BINDING_OK\n`，回复 `D2_PI_BINDING_PASS`，4/4 stages completed。
- 验收后已切回 Main Project 并关闭 exact release `.app`；本轮 Project 记录及 conversation/event 投影按精确 project id 清理，不删除 Codex/Pi native Agent Home/session。
- 两个精确 mktemp 目录已移入废纸篓，可恢复；W6、三个旧 D2 sentinel 与既有 Project 文件未改动。

## 当前 live 截图

- `current-release-codex-boundary-fixed.jpeg`：Project 内文件成功、outside `file_change` 失败并报告未创建。
- `current-release-pi-binding-pass.jpeg`：Pi Read/Write 成功并回复 `D2_PI_BINDING_PASS`。

## 保留的历史缺陷证据

- `current-live-codex-boundary-defect.jpeg`
- SHA-256：`970a39ddbf683fc820ab290307c34e2abb605b0298bb99219dc9d0a95c5aaadd`
- 截图记录旧 release 运行时在用户批准 `file_change` 后写入 Project 外 `Documents` 的缺陷现场。
- 该截图仅作历史负向证据，不作为本 clean rebuild 的当前 live 验收；对应 #111 修复已位于本次基线。

三个现场 sentinel 保持原位、未删除或改写：

- `/private/tmp/offisim-w6-live-project/d2-current-inside.txt`
- `/private/tmp/d2-current-outside.txt`
- `/Users/haoshengli/Documents/d2-current-outside.txt`

本记录不声称已 push、修改 PR、notarize、发布或合并。

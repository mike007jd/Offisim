# PR-D1：`git.rs` clean rebuild 记录

- 状态：clean rebuild 已替换 PR #107 的远端分支；当前代码、CI、release `.app` 与真实 checkpoint create/rollback 均已验证。
- 当前基线：`origin/main@0790111a2ec1974f98762a4f5089f41b2bfd45cb`。
- 核对时间：2026-07-20 NZST。
- 范围：仅把当前基线的 `git.rs` 机械拆为 `git/{allowlist,checkpoint,exec,lease,worktree}.rs`，根模块保留 Tauri 命令入口、模块装配和必要 re-export；不改变产品逻辑、错误文案、allowlist 判定或外部命令合同。
- #112 保留：`git/exec.rs` 继续通过调用方附加 allowlist 传递 `SSH_AUTH_SOCK`，同时排除 provider secrets；对应测试已迁移并通过。
- Harness：只把源码路径 oracle 指向新模块，断言内容不变。

## 已实际通过

- `cargo fmt --all -- --check`
- `pnpm harness:project-workspace`
- `pnpm harness:best-of-n`
- `node scripts/prepare-desktop-cargo-test.mjs && cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`：470 passed，0 failed。
- `node scripts/release-gates.mjs --lane=node`：4 gates green（validate 73/73 harness、UI hygiene、security harness、生产依赖审计）。
- GitHub CI：Desktop Rust tests、Types / harness / security gates 全绿。

## release `.app` live verify

- 精确产物：`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`。
- arm64 release build 成功；Developer ID + hardened runtime 签名及 `codesign --deep --strict` 通过。
- 本机 `spctl` 返回 accepted，但 Gatekeeper assessments disabled，产物未 notarize；本记录不把它表述为正式分发验收。
- Computer Use 已绑定上述精确 `.app`，窗口 URL 为 `tauri://localhost`；Git 面板正常显示当前分支和工作区状态。
- Pi production competitive-draft 路径创建两个独立 lease/worktree；Marcus 与 Kai 均先写入 `D1_CHECKPOINT_ONE`，再修改为 `D1_CHECKPOINT_TWO`，两条 run 均完成。
- Timeline 通过正式 `Rewind to Step 1` 入口回滚 Marcus workspace；`workspace_checkpoint_rollbacks` 记录 status=`completed`、target_step=`1`、changed path=`d1-checkpoint-current.txt`，回滚后文件精确为 `D1_CHECKPOINT_ONE`。
- 采用 Marcus proposal 后 group=`merged`、Marcus=`winner`、Kai=`not_selected`；两个 lease 分别为 `released` / `discarded`，linked worktree 已清理。
- 本轮生成的根项目测试文件已移入废纸篓；D2 sentinel 和既有项目文件未改动。

## 截图

- `current-release-checkpoint-rollback.jpeg`：Timeline 顶部显示 “You · rolled back to Step 1”。
- `current-release-draft-winner.jpeg`：对比页显示 Marcus 为 Winner、状态为 Winner Merged。

本记录不声称已合并、notarize 或发布。

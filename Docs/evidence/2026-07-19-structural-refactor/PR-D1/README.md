# PR-D1：`git.rs` 五模块机械拆分证据

- 状态：`completed`
- 基线：分支 `refactor/D1-git-module-split`，起始 HEAD `397e8d38`（A3）
- 时间基准：2026-07-19 NZST
- 范围：纯移动到 `git/{exec,allowlist,worktree,lease,checkpoint}.rs`；`git.rs` 仅保留 Tauri 命令入口、父级导入和 re-export。未做 release live、merge 或 push。

## 43→32 合同修正

Roadmap 原文写成“43 个 `validate_*`/`is_allowed`”；本轮权威合同修正为顶层共 32 个，归属如下，机械扫描结果为 `24 + 2 + 6 = 32`：

- `allowlist.rs`（24）：`is_allowed`、`validate_checkpoint_ref`、`validate_checkpoint_read_tree`、`validate_checkpoint_write_tree`、`validate_checkpoint_commit_tree`、`validate_checkpoint_update_ref`、`validate_binding_git_args`、`validate_status`、`validate_worktree`、`validate_merge`、`validate_pathspec_command`、`validate_commit`、`validate_diff`、`validate_log`、`validate_rev_parse`、`validate_branch`、`validate_switch`、`validate_push`、`validate_push_context`、`validate_user_branch_name`、`validate_remote`、`validate_clone_source`、`validate_git_ref`、`validate_git_pathspec`。
- `worktree.rs`（2）：`validate_live_git_worktree`、`validate_live_git_worktree_with_identity`。
- `lease.rs`（6）：`validate_workspace_lease_agent_run_from_pool`、`validate_competitive_draft_context_shape`、`validate_competitive_draft_attempt_from_pool`、`validate_registered_workspace_process_claim`、`validate_workspace_lease_patch_input`、`validate_workspace_lease_patch_path`。

## 机械拆分结果

- `exec.rs`：Git 进程执行、输出上限、超时/进程组、环境清理与执行作用域；对应测试 18 个。
- `allowlist.rs`：命令、ref、pathspec、clone source 等安全校验；对应测试 28 个。
- `worktree.rs`：worktree 创建、校验、exclude、回滚与清理；对应测试 13 个。
- `lease.rs`：lease 生命周期、持久化、patch/review 与授权；对应测试 23 个。
- `checkpoint.rs`：checkpoint 创建、时间线、回滚与审计；对应测试 1 个。
- 原 83 个 Git 测试全部随对应模块迁移；函数体、常量值、注释和错误文案不改，只增加模块声明、导入/re-export 与必要的 `pub(super)`/测试 fixture 可见性。
- 两个源码字符串 harness 仅同步读取新模块路径：`harness-best-of-n.mts` 读取 `git/lease.rs`；`harness-project-workspace.mts` 分别读取 `git.rs`、`git/allowlist.rs`、`git/lease.rs`。断言内容未改。

## 风险与验证

- GitNexus 改前分析：`run_git_capped` 与 `is_allowed` 均为 CRITICAL 高扇出安全边界；因此仅搬家并保留原判定。全量生产函数及关键方法均在编辑前完成 upstream 影响分析。
- GitNexus 提交前 `detect_changes(compare 397e8d38)`：MEDIUM；唯一识别到的受影响流程为 checkpoint → filesystem identity 链，符合预期模块移动范围。
- `node scripts/prepare-desktop-cargo-test.mjs`：通过。
- `cd apps/desktop/src-tauri && cargo fmt --check && cargo test --locked`：通过，458 passed / 0 failed。
- Rust 首次完整测试仅有原时序测试 `run_git_capped_reaps_background_hook_descendants` 在机器高负载下以 2.347s 触发阈值；未改代码/阈值，单测复核通过，随后完整 458/458 复跑通过。
- `CI=true pnpm install`：因当前 worktree 缺少 `node_modules` 而执行，通过，lockfile 未变。
- `node scripts/release-gates.mjs --lane=node`：通过，4 gates green（validate、ui-hygiene、security-harness、supply-chain-audit）。
- `git diff --check`：通过。

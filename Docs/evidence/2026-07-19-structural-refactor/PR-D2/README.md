# PR-D2 — task_workspace_binding 机械拆分证据

- 状态：code-complete / release-live-partial（Codex 已验；Pi、Claude 与严格越界读仍阻塞）
- 日期：2026-07-19
- 分支：`refactor/D2-binding-module-split`
- PR 拓扑基线：`refactor/D1-git-module-split`；纯移动比对源仍为 A3 `397e8d38:task_workspace_binding.rs`
- 范围：仅把 `task_workspace_binding.rs` 拆成指定的四个 `binding/` 子模块；未新增其他 binding 模块。D1 已用 merge commit `45792225` 合入本分支并保留双方 harness 路径，最新 D1 证据又以 `aa01355c` 合入，PR #108 已 retarget 到 D1；未 merge 到父分支。

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

`20f67c8e` 将 `resolve_task_workspace_binding` 保持为入口 re-export，并单独标注 `#[allow(unused_imports)]`，消除 release build 的 unused re-export 告警而不删除外部入口。修改前 GitNexus upstream 为 CRITICAL（1 个直接依赖、6 条受影响流程）；修改后 staged `detect_changes` 为 low、0 条受影响流程。该提交重新通过 Node release gates 4/4、Rust 458/458、格式、`git diff --check` 与精确 release build，release 编译不再出现该 Rust 告警。

## 风险复核

- 聚合安全分类保持 **CRITICAL**：接管审计按 workspace authority、resume、registry、persistence、Project CRUD 边界合计识别 37 条流程实例；这是跨符号人工安全分类，不等同于单次 diff 的标签。
- 最新代表性 upstream 分析：`resolve_task_workspace_for_turn` 为 HIGH，3 个直接依赖横跨 Codex / Claude / Pi lane，并命中 2 个流程根、3 个流程实例。
- 纯 D2 compare 的 GitNexus 结果为 MEDIUM，命中 5 条预期 workspace authority flow；D1 合入时的 staged change detection 同样为 MEDIUM，11 个符号、2 条 Git filesystem-identity 流程。两者均未被用于降低整体安全等级。

## 偏差

计划偏差：Codex 当前原生 Auto / `workspace-write` 合同只限制写入根，不限制读取根；因此“父目录读必须拒绝”不能由现有 App Server `SandboxPolicy` 表达，live 已按真实结果标红，未伪造通过。

为保持既有静态合同继续读取同一份 Rust 语义，三个 harness 仅更新了源文件路径或把入口与对应子模块源码拼接后再执行原断言；断言、错误文案和判定逻辑均未变化。Tauri command 宏符号通过入口显式 re-export，保持既有 `generate_handler!` 路径不变。

## Release live 门禁

- 验收提交：`20f67c8e`。
- 精确应用：`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`；可执行文件 SHA-256 `6414bfe3cd240eca2bed5c93655258a78f296d3ad3b1f2348d7f9c9cc553c793`；`codesign --verify --deep --strict` PASS；因本机无 notarization 环境变量而跳过公证。
- 首次窗口身份：PID `70663`、CGWindowNumber `36744`、标题 `Offisim`、bounds `X=36 Y=33 W=1440 H=889`、AX URL `tauri://localhost`。
- 重启窗口身份：PID `78213`、CGWindowNumber `36794`、标题 `Offisim`、bounds `X=36 Y=33 W=1440 H=887`、AX URL `tauri://localhost`；首次 PID 已确认退出后才重启。
- 临时 Project：`3741353e-2a6b-4379-8a38-08f7716657ea`，workspace `/private/tmp/offisim-d2-live.MbNsDt/project`。

### Codex lane

- 通过：release `.app` 内 Alex Chen 的实际 lane 显示 `Codex CLI · Auto`；项目内读取 `README.md` 成功，创建 `inside-proof.txt` 成功，机械校验为恰好 18 字节 `D2_INSIDE_WRITE_OK`。
- 通过：越界创建 `../outside-write.txt` 返回 `operation not permitted`，机械检查确认文件不存在；父目录 fixture 哈希未变化。
- **未通过：**Codex 成功读取 `../outside-secret.txt`。本机 `codex-cli 0.144.5` 于 2026-07-19 生成的 App Server schema 中，`workspaceWrite` 只有 `writableRoots`，没有 `readableRoots`；OpenAI 当前官方说明也明确默认模式允许读取几乎任意位置、仅把写入限制在 workspace。因此这不是 D2 纯移动回归，而是现有 Codex 原生 sandbox 合同与严格 Project 读隔离目标不相容。若产品坚持严格越界读拒绝，需要单独设计 OS 级外层 sandbox，不能在 D2 中伪装成机械修复。
- 通过：完全退出应用并以同一路径重启后，原 Conversation 读取 `inside-proof.txt` 并返回 `D2_RESUME_OK：D2_INSIDE_WRITE_OK`；两次 completed run 的 `nativeSessionId` 均为同一 opaque ref：Codex thread/session `019f79bf-c89e-7181-8e5e-71bc7058f074`。
- 观察：重启后的 Conversation settings Help 短暂/持续显示 `Model unavailable`，但 employee 配置仍为 `Codex CLI`，续接 run 实际完成且复用了同一原生 session；该 UI 投影异常不作为 Resume 通过依据。

截图：`live-codex-boundary-final.jpeg` 记录项目内写成功、父目录读成功及越界写拒绝；`live-codex-restart-resume.jpeg` 记录重启后的同会话续接结果；`live-codex-boundary-defect.jpeg` 保留运行中原始缺陷现场。

### 未完成 lane

- Pi：OpenRouter 凭据轮换前不执行任何调用；checkpoint 与 D2 Pi live 均保持未验。
- Claude：额度恢复前不执行真实 run，不宣称 Claude lane 完整验收。
- 严格越界读：受 Codex 当前原生 sandbox 合同阻塞；需独立架构单，不属于 D2 纯移动允许范围。

以上阻塞不改变已通过的机械拆分证明，但 PR 保持“未完整交付”。

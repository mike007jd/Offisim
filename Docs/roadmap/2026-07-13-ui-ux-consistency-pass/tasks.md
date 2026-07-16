# Offisim Codex 对齐盲测收敛 — Tasks

> 对应计划：[plan.md](./plan.md)
> 状态：IN PROGRESS，16/17 implemented；仅 T16 尚未闭环，整包 final release 验收统一留在 T16
> 完成口径：真实行为 + 窄门禁 + full release + 精确 `.app`，仅文档、仅编译或 dev 预览均不算完成。

## 任务总表

| ID | 结果 | Blocked by | 状态 |
|---|---|---|---|
| T00 | 当前控制真源允许 engine-neutral Accounts / Models | — | [x] |
| T01 | 历史 approval 与 live run 分离 | T00 | [x] |
| T02 | 首次成功回复后的语义标题 | T00,T05a | [x] |
| T03 | 后端签发 effective task workspace | T00 | [x] |
| T04 | 缺失 Project 目录自主恢复 | T03 | [x] |
| T05 | 生产 engine gateway 与 API account | T00 | [x] |
| T06 | Codex CLI 编排适配器 | T05 | [x] |
| T07 | Claude Code CLI 编排适配器 | T05 | [x] |
| T08 | AI Accounts / Models 设置整合 | T02,T05,T06 | [x] |
| T09 | Loops 自然语言主流程 | T00 | [x] |
| T10 | Market 用户语言与空状态 | T00 | [x] |
| T11 | Personnel Danger Zone | T00 | [x] |
| T12 | Chrome、rails、nav、run pill 稳定 | T01 | [x] |
| T13 | Usage / Cost 单一表达 | T08 | [x] |
| T14 | Radius、presence、error 视觉语义 | T00 | [x] |
| T15 | Dead docs 与 gates 收敛 | T00 | [x] |
| T16 | Release `.app` 盲测闭环 | T01-T15 | [ ] |

## 全局执行规则

每个 task 开工前：

1. 确认真实当前时间；涉及模型、供应商、CLI、协议、依赖时查官方当前来源。
2. 修改 function / class / method 前运行 GitNexus upstream impact；HIGH/CRITICAL 先报告影响面。
3. 保存用户已有 dirty work，只触达本 task 与直接合同。
4. 先锁行为 oracle，再改实现；不得用按钮 no-op、fallback 或纯文案掩盖真值错误。

每个 task 完成前：

1. 跑该 task 的窄门禁并记录结果。
2. 更新 checkbox、acceptance 和 evidence。
3. 提交前运行 GitNexus `detect_changes(scope: compare, base_ref: main)`。
4. 运行 `git diff --check`。
5. release 交互统一在 T16 复验；任何 release finding 会重新打开对应 task。

---

## T00 — 当前控制真源

**结果：** 文档诚实记录 Pi API 引擎及 Codex、Claude Code CLI 编排 adapter，不再用旧 Pi-only 或订阅账户叙述阻断当前架构。

### Acceptance

- [x] 当前真值是 production `DesktopAgentRuntimeGateway` + Pi API engine + Codex、Claude Code CLI 编排 adapter。
- [x] Pi API 与外部 CLI 编排可以并存；每个 run 只走一个 engine lane，外部 CLI 不伪装成 Pi provider。
- [x] API 显示 token/Cost；编排任务只显示 token/时长与“订阅内 · 无 API 成本”。
- [x] Project、Conversation、Native Agent Home/Session/Memory、effective workspace 四层分离。
- [x] Pi API 使用动态 exact model id，用户 source 可选、官方 source/checkedAt 严格；外部 CLI 模型归 CLI 自管。
- [x] release、sandbox、prelaunch、Tauri-only 门禁未削弱。

### Evidence

- `AGENTS.md`、`CLAUDE.md`、`Docs/UI_FRAMEWORK_STACK.md` 与 current architecture indexes 已更新。
- 新真源：[`2026-07-13-engine-neutral-ai-accounts.md`](../../architecture/2026-07-13-engine-neutral-ai-accounts.md)。
- 当前控制文档旧冲突短语搜索为 0；`git diff --check` 通过。

---

## T01 — 历史 approval 与 live run 分离

**结果：** 重启后 stale/expired approval 仍可追溯，但不会生成幽灵 Stop、全局 running 或人员工作态；同一 Conversation 的新 Turn 独立执行。

### Acceptance

- [x] stale approval hydrate 后 phase 为 `interrupted`，approval 保持 dismiss-only。
- [x] global `activeRuns` 同时要求 controller ownership 与 active phase。
- [x] 同一 thread 可提交新 Turn；旧 interaction 先清理，不会 reattach/approve。
- [x] concurrent submit 仍原子拒绝，未引入重复 run race。
- [x] cleanup 失败进入现有 failed/retry 语义，不吞错误。
- [x] live Stop、Pi reattach、Office projection、scene cue、persistence 与删除合同无回归。

### Gates

- `pnpm harness:conversation-run-controller` — 25/25
- `pnpm harness:run-recovery` — 23/23
- `pnpm harness:office-projection` — 50/50
- `pnpm harness:scene-cue` — 87/87
- `pnpm harness:pi-agent-host` — PASS
- `pnpm harness:thread-lifecycle-guard` — 6/6
- `pnpm harness:chat-persistence` — 7/7
- `pnpm harness:conversation-deletion` — PASS
- `pnpm --filter @offisim/desktop-renderer typecheck` — PASS

### Release recheck

- T16 构造 approval → 退出 → 重启 → 确认无 Stop → 发送新 Turn → 运行真实 task → Stop。

---

## T02 — 首次成功回复后的语义标题

**结果：** Conversation 创建后立即有可读 fallback；首次成功回复后得到同语言的短语义标题；用户手动改名永不被覆盖。

### Scope

- 保留现有首条用户消息 fallback 与 markdown 清理。
- 成功持久化首条 assistant reply 后，使用当前 Turn 同一 engine/account 生成短标题。
- 标题 job 不调用工具、不切 provider；失败静默保留 fallback。
- 复用 `title_set_by_user` 作为锁，不新增第二套状态。

### Acceptance

- [x] 首条消息发送后立即出现 fallback，CJK/emoji 不截断。
- [x] 只有首次成功 assistant reply 才触发语义标题；failed/interrupted/approval 不触发。
- [x] 标题与对话语言一致，短、具体，不带“关于/讨论/帮助”等 AI 套话。
- [x] 手动改名在生成前、生成中、生成后都不被覆盖。
- [x] semantic job 重试幂等，刷新/重启不重复计费或反复改名。
- [x] job provenance 绑定当前 Turn 的 runtime/account/model/billing mode。

### Oracles

- 扩展 auto-title / conversation persistence harness。
- `pnpm harness:chat-persistence`
- `pnpm --filter @offisim/desktop-renderer typecheck`

### Evidence

- `pnpm harness:chat-persistence` — 13/13；并联 sqlite-proxy rename/claim 交错 50/50。
- `pnpm harness:execution-provenance` — 同 engine/account/model/billing、账户替换隔离、无 secret 泄露、terminal stream replay。
- `pnpm harness:prompt-enhance` — 62/62；isolated job 为 in-memory、no-tools、no workspace resources。
- `pnpm harness:conversation-run-controller` — 25/25；Stop/final-persist、approval、retry、route unmount 无回归。
- `pnpm typecheck`、`pnpm check:deadcode`、`git diff --check` — PASS。

---

## T03 — 后端签发 effective task workspace

**结果：** Project catalog folder 与每个 Turn 实际 cwd 明确分层；renderer、prompt 或历史文本都不能自报 canonical root。

### Scope

- 定义 canonical workspace binding：root、source、confidence、issuedAt、project/thread/turn scope。
- 由 Tauri/backend 验证与签发，继续受 `project_list_dir` / `project_read_file` sandbox 约束。
- 持久化最近成功 binding 与原因，供重启解释和 T04 恢复使用。

### Acceptance

- [x] 每个文件型 Turn 都有后端签发的 canonical root。
- [x] binding 与 company/project/thread/turn/request 匹配，不能跨 Project 或由 renderer 篡改。
- [x] 文件工具只接受 binding scope 内路径；write、read 与 terminal read grace 独立校验。
- [x] Conversation 历史、Native Session ref 与 workspace binding 可独立存在。
- [x] 运行记录能解释实际目录、来源与置信度；256-bit capability ref 仅驻内存，不进入 SQLite 或 runtime context。

### Oracles

- 新增 task-workspace contract harness：正常、越界、伪造、重启、跨 Project。
- `pnpm harness:project-workspace`
- Rust command tests + renderer typecheck。

### Evidence（2026-07-14 AEST）

- `pnpm harness:project-workspace` — PASS；真实执行 fresh SQLite schema，并锁定 Project folder、scope、事件投影、artifact claim 与无 all-roots fallback。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml task_workspace_binding --lib` — 22/22；覆盖 256-bit ref、claim 防伪、read/write/verification、expiry/revoke grace、root identity、resume/discard 与 process cwd。
- `pnpm harness:pi-agent-host` — PASS；production session 的 read/write/edit/grep/find/ls/bash 只走固定虚拟根与后端 capability，覆盖 CAS、取消、同路径换根、遍历/结果截断；同步 Bash 会清理直接/同组进程与仍保留 marker 的 detached child，模型合同明确禁止持久 daemon，truth oracle 锁定清空全部 marker 后不属于 macOS native containment 的边界；无 native fallback。
- `cargo test --locked` — 302/302；`pnpm validate`（含 typecheck、schema/wire、recovery/deletion/Loop 与 deadcode）、`pnpm lint`、`cargo clippy --locked --all-targets -- -D warnings -A clippy::large-enum-variant` — PASS。

---

## T04 — 缺失 Project 目录自主恢复

**结果：** 用户删除原 Project folder 后继续发任务，Offisim 在唯一高置信候选中像 Codex 一样继续，并明确披露实际目录；不改 Projects catalog。

### Recovery order

1. 原 Project folder 仍存在：直接使用。
2. Conversation 最近成功 workspace 仍存在且身份一致：直接恢复。
3. 已知 workspace roots 中唯一名称 + repo identity 高置信匹配：自动采用。
4. 多个同置信候选：不猜、不写；仅在真正需要文件操作时明确阻塞。
5. 无候选：历史与纯对话仍可继续。

### Acceptance

- [x] 原目录存在时不触发搜索。
- [x] 自动恢复在首条进度中披露实际 cwd 与采用原因。
- [x] multiple/none 情况绝不误写。
- [x] 自动恢复不新增、删除或改写 Projects catalog。
- [x] 重启后能解释上次 workspace binding。
- [x] 非文件对话不因 folder 缺失被阻断。

### Oracles

- workspace harness：normal、deleted、renamed、unique、ambiguous、none。
- T16 使用临时目录副本完成破坏性 fixture，验收后清理。

### Evidence（2026-07-14 AEST）

- Rust recovery oracle 覆盖 current、recent、renamed inode、唯一 name + repo identity、ambiguous、none、候选换根、查询截断与 Git probe timeout；全量 `cargo test --locked --all-targets` 377/377。
- `pnpm harness:project-workspace`、Conversation controller 46/46、chat persistence 18/18、Mission reload 17/17、run recovery 32/32、Task Board child tree — PASS。
- Fresh 只对当前可见 Conversation 做 `company + thread` 精确查询与 `LIMIT 1`；live reattach 只读取 projection 的两条消息；Started native identity 仅在事务与 readback 成功后进入共享状态。
- `pnpm validate`、`pnpm lint`、`cargo fmt --all -- --check`、`cargo clippy --locked --all-targets -- -D warnings`、`git diff --check` — PASS；三路独立冷审未发现剩余可证 P1/P2。
- `pnpm build` 生成当前 worktree 的 release `Offisim.app`；T04 不据此声明最终体验通过，删除目录后的两轮 fresh-state release `.app` 真实交互统一留在 T16。

---

## T05 — 生产 engine gateway 与 API account

**结果：** `DesktopAgentRuntime` 成为唯一生产 engine gateway；现有 API runtime 作为第一个中立 AI Account 完整工作。

### Scope

- **T05a（T02 前置）：** 由真实执行结果签发 Turn execution provenance，并提供锁定同一 engine/account/model 的 no-tools isolated text job；禁止 renderer 根据全局设置猜测。
- runtime session/tools/workspace capability 与 account execute/models/usage/cost capability 分层。
- 现有 live chat/Office 实际经过 gateway，不只做 schema/fixture。
- catalog 只接受 exact leaf id、source、checkedAt、availability。
- run/title job 持久化稳定 provenance。

### Acceptance

- [x] **T05a：** root run result 与持久化 context 都包含 engineId/accountId/billingMode/exact modelId/runId，值来自实际 host selection。
- [x] **T05a：** isolated text job 必须消费 source Turn provenance；engine/account/model 不匹配或 adapter fallback 时明确失败。
- [x] **T05a：** isolated job host-enforced no tools/no workspace/no transcript persistence，并返回实际 provenance 与 usage。
- [x] API account 可完成真实 run、stream、tool、approval、Stop、recovery。
- [x] 一个 task 只绑定一个 engine/account，不静默 fallback。
- [x] token 分 input/output/cache/reasoning；缺失字段不伪造 0。
- [x] Cost 标注 actual / estimate / unavailable。
- [x] runtime/account/billing/model/usage provenance 可审计。
- [x] Pi/provider implementation 名称不进入普通 UI。
- [x] 旧 provider profile、sidecar 或双主路径不回流。

### Oracles

- 实施时按真实日期重查官方模型与费率。
- runtime conformance、agent-run projection、run-cost-scope、Pi host harness。
- 一条当前 release API live run 证据。

### T05a Evidence

- Pi 0.79.8 `ModelRegistry.isUsingOAuth(actualModel)` 是 billing 真值；OAuth 记 subscription，API key 记 api。
- Provider-native stable account id 优先；无 stable id 的 opaque credential 使用不可逆 generation fingerprint，宁可在轮换时拆分历史，也不把显式换号的 Usage/Cost 或 isolated job 合并。
- 成功 root、direct delegation 与 live reattach 缺 provenance 均 fail closed；abort 仍允许无 provenance。
- `SessionManager.inMemory` + discovery 全关闭 + 专用 temp cwd；Pi in-memory 写消息后无 session 文件。
- `pnpm harness:pi-agent-host`、Pi wire v10、Rust 378/378、run recovery 32/32 — PASS。

### T05 Evidence（2026-07-15 AEST）

- `DesktopAgentRuntimeGateway` 是 production 唯一入口，当前只注册 `api` adapter；root、child、enhance、collaboration 全部冻结同一 execution target，host ACK 与持久化 readback 不一致时 fail closed。
- 普通 Settings 已改为 `AI Accounts / Models / Usage / Cost`；旧 provider profile、config write command、全局 override 与 `PiAgentPane` 已删除。内部 Pi host 只保留为 API adapter 实现与必要诊断，普通 Tool activity 不再展示 `pi_agent`。
- OpenRouter catalog 在 `2026-07-14T21:56:24+10:00` 核对 5 个 exact leaf：`cohere/north-mini-code:free`、`openai/gpt-oss-20b:free`、`nvidia/nemotron-3-ultra-550b-a55b:free`、`qwen/qwen3-coder:free`、`qwen/qwen3-next-80b-a3b-instruct:free`；每项保留官方 endpoint、availability 与 checkedAt。
- API Usage 按 input/output/cache/reasoning 分字段记录；供应商缺失 cache/reasoning 时保持 unknown，不写 0。Cost 只记录供应商 actual、exact rate estimate 或 unavailable，不把免费模型的 `$0.00` 冒充 actual。
- 当前 worktree 精确 release `.app` 二进制为 31,214,064 bytes，mtime `2026-07-15 00:02:44+10:00`，SHA-256 `b62ae06de3280d332b7f5ccc0a180e59fe901b5cfaf85352b1a6ea299693f206`，codesign 验证通过；Computer Use 绑定该绝对 `.app` 路径和 `Offisim` 窗口完成最终 T05 live verify。
- 归档 schema v11 开发库后，精确 release `.app` 从 fresh state 创建 schema v12、Company 与绑定 Project；真实 OpenRouter task 创建并读回 `LIVE_T05_FINAL.txt`，内容为 `T05_FINAL_MARKER_20260715`。Tool activity 明确显示 `bash · Built-in`，普通 UI 未泄露 `pi_agent`。
- Settings 在真实 run 前显示 `No recorded usage/cost`；运行后显示 OpenRouter API、5 个 exact model、7 条当月 partial usage、input/output 实值、cache/reasoning `Unknown` 与 `Estimate from the verified model price`，没有把缺失字段补 0 或把免费价格冒充 actual。
- 同一 Conversation 的 8 个 run 只使用一个 native session `019f60f4-db51-7492-8596-c741ae999280`；精确 `.app` 退出重启后历史完整恢复，继续执行时精确复述首次回复 `T05_FINAL_MARKER_20260715`。
- Ask 模式的 `rm -rf /private/tmp/offisim-t05-external-approval-proof` 在 approval card 暂停时目录仍存在，点击 Approve 后才删除；`interaction_history` 记录 resolved `human_in_loop` 与 `confirmed: true`。
- Stop 在 `sleep 20` 实际运行后中断；run `attempt-5ae41176-4abb-49bb-a7d1-d28b3004bb08` durable 状态为 `cancelled`、finished at `2026-07-14T14:13:30.310Z`，两分钟后复核仍无 late response 覆盖。

---

## T06 — Codex CLI 编排适配器

**结果：** 本机已安装并登录 Codex CLI 的用户无需 Offisim 二次登录，可选择 Codex 完成完整 task；认证、模型和订阅用量继续由 Codex 自管。

### Scope

- 只使用当前官方支持的 Codex CLI / app-server surface；Offisim 不再打包 Codex 二进制。
- Codex 作为外部 CLI 编排 engine，不作为 Pi 内 provider lane，也不作为订阅账户管理对象。
- 原始 auth、session、compaction、global memory 归 Codex Agent Home；Offisim 只存 opaque ref 与安全投影。

### Acceptance

- [x] 自动发现本机 Codex 登录状态；未登录时给原生登录指引。
- [x] 模型选择归 Codex CLI；Offisim 固定 engine-level target，不造 model source URL。
- [x] 完整执行 stream/tool/approval/Stop/recovery 与文件 workspace。
- [x] 任务只记录 Codex 返回的 token 数与时长，并标注“订阅内 · 无 API 成本”。
- [x] 不读取、复制、展示或持久化 raw OAuth/token。
- [x] Codex 不可用时不静默切 API、Claude 或 Pi。
- [ ] 纠偏后的 release `.app` 真实 Codex task 证据（按决定留到统一 live-verify 批次）。

### Oracles

- 固化 CLI 检测、engine-level target、capability manifest 与 app-server 协议 contract。
- live Codex task + secret scan + runtime conformance。

### T06 Corrected evidence（2026-07-17 NZST）

- `DesktopAgentRuntimeGateway` 注册 Codex 编排 adapter；capability manifest 决定 Stop、Resume、权限档、Ask/审批与过程事件控件，UI 不伪装未声明能力。
- 状态只调用 `codex --version` 与 `codex login status`；执行启动用户 PATH 中的 `codex app-server --stdio`。原打包 manifest、sidecar、license/notice 与构建脚本已删除。
- target 固定为 `codex / codex:local / subscription / engine-managed / native`；native source 在 renderer、Rust、SQLite 三层都不允许伪造 URL/checkedAt。
- `answerUiRequest` 按 durable root 的 requestId 与 executionTarget.engineId 路由，第二个 adapter 注册后 Ask/审批不会退化成 adapter-count hard throw。
- Node release gates、完整 Rust tests 与 release desktop build 已通过；本任务明确不做 live verify，因此本节不声称纠偏后的 release `.app` 已实机验证。

---

## T07 — Claude Code CLI 编排适配器（completed，#69）

**结果：** Claude Code 已按外部 CLI 编排口径接入唯一 production gateway；凭据、模型与原生状态仍归用户安装的 Claude Code CLI。

### Scope

- 检测本机 Claude Code CLI 安装、登录和版本，提供官方指引。
- 经 production gateway spawn CLI、绑定 workspace、接收过程事件流并支持 Stop；不作为 Pi provider。
- 凭据、模型、session、compaction、global memory 与订阅用量归 Claude Code 自管。

### Acceptance

- [x] 安全发现安装/登录/版本状态，未就绪时给官方指引。
- [x] 完成 spawn、reasoning/tool/file-operation 过程事件、Stop/resume/recovery 与文件 workspace；Claude 未声明的 approval、userInput、steer 控件不显示。
- [x] 模型选择与凭据留在 Claude Code；Offisim 不建模型 catalog、账户健康或订阅 Usage 页。
- [x] 任务只记录 CLI 返回的 token 与时长，并标“订阅内 · 无 API 成本”。
- [x] 不读取、复制、展示或持久化原始 auth secret。
- [x] 不可用时不静默切换其他 engine。
- [x] release `.app` 有真实 Claude task、工具事件与 Stop 证据。

### Oracles

- Claude Code CLI reference、authentication、hooks、sandboxing，checkedAt 2026-07-17 NZST。
- `harness:claude-agent-host` + runtime conformance + exact release `.app` live task。

### T07 Evidence（2026-07-17 NZST）

- 直接启动用户 PATH 中的 Claude Code CLI 2.1.211，使用 `claude -p --output-format stream-json --verbose --include-partial-messages --include-hook-events`；不打包 CLI 或 Agent SDK。
- renderer/Rust command lockstep harness 禁止 `model`、`runtimeModelRef`、`thinkingLevel` 回流；target 固定为 `claude / claude:local / subscription / engine-managed / native`。
- 保留 PreToolUse workspace guard、Bash sandbox、Project-folder canonical boundary 与 symlink 逃逸拒绝；生命周期 harness 同时锁住 stdin 保持开启时 sidecar 必须自行退出。
- 精确 worktree release `.app` 状态卡显示 Ready、版本、原生登录命令与官方指引；真实任务返回 `OFFISIM_CLAUDE_RELEASE_OK`，Bash 工具任务返回 `OFFISIM_CLAUDE_TOOL_OK`，Token/时长固定显示“订阅内 · 无 API 成本”，Stop 后持久化 run 为 `cancelled`。
- 窗口身份、运行记录与截图见 [`Docs/evidence/2026-07-17-claude-orchestration/`](../../evidence/2026-07-17-claude-orchestration/README.md)。

---

## T08 — AI Accounts / Models 设置整合

**结果：** Settings 同页分为 API 引擎与编排引擎；API 区编辑 Pi 自管 provider/model 配置，编排区只呈现外部 CLI 状态与登录指引。

### Acceptance

- [x] API 区恢复 provider 模板、自定义 endpoint/model id 与 API key 编辑，配置真相为 Pi `models.json`。
- [x] 任意 Pi 已配置 provider/model 可选可执行；用户模型 source 可缺省，官方 source 仍严格校验。
- [x] 编排区只显示 CLI 检测、版本、登录命令、官方指引与“订阅内 · 无 API 成本”。
- [x] renderer、日志与状态投影不返回原始 API key；保留 SHA-256 凭据代际指纹。
- [x] composer、员工绑定、enhance、collaboration 统一消费动态模型选择。
- [ ] 当前纠偏版本 release `.app` 实机验收（按本次决定留到统一 live-verify 批次）。

### Oracles

- dynamic catalog/provider configuration、execution target/provenance、settings coordinator、runtime capabilities gates。
- T16 覆盖当前可交付的动态 API provider 与 Codex、Claude 编排状态。

### T08 Corrected evidence（2026-07-17 NZST）

- `AiAccountsPane` 同页实现 API/provider editor 与 orchestration status cards；API key 输入为 password，保存后立即清空且不从状态回显。
- Pi sidecar 隔离写入验证覆盖自定义 localhost endpoint、任意 model id、`0600`、`keepExistingApiKey` 与 stdout/stderr secret scan。
- 动态 catalog、provider configuration、execution target/provenance、renderer authority、collaboration persistence 与 Pi host 聚焦门禁已通过。
- 最终门禁日志：`node scripts/release-gates.mjs --lane=node` exit 0；完整 `cargo test --locked` 433 passed / exit 0；`pnpm --filter @offisim/desktop build` exit 0 并产出当前 worktree release `.app`。本任务明确不做 live verify，因此 T08 仍未完成、也不声称 release verified。

---

## T09 — Loops 自然语言主流程

**结果：** 用户通过自然语言创建、修改和运行 loop；graph 负责快速审阅，内部编译词下沉。

### Acceptance

- [x] 空白状态首先邀请描述目标、重复条件和退出条件。
- [x] 自然语言生成可读 graph；修改自然语言会更新 graph。
- [x] graph 能快速识别步骤、分支、循环和退出。
- [x] 主工具条无 Compile / IR / oracle / gate 等实现词。
- [x] Advanced 仍能诊断真实编译/运行问题。
- [x] 失败信息使用用户任务语言。
- [x] loop runtime、repository、projection 无回归。

### Oracles

- loop-authoring-flow、loop-graph-projection、loop-repository harness。
- T16 创建、审阅、修改、运行一个真实 loop。

### T09 Evidence（2026-07-16 NZST）

- 主流程收敛为 `Generate plan → Save plan → Run`；空白页只要求目标、重复、停止与求助条件，Advanced 默认收起，保存严格持久化用户已经审阅的 preview，不再二次调用模型。
- 默认 `general-work` profile 保留用户步骤、退出、反馈循环、显式重试次数与条件式求助；实测修改描述后旧 graph 标记 Stale、Save/Run 同时阻断，更新后从 7 节点 v1 正确变为含新增验证步骤的 8 节点 v2。
- fresh-state release 盲测实际捕获并修复三类 blocker/slop：WebView `Buffer` 保存崩溃、重开已保存版本仍可重复 Save、`stop after …` 被误判为 action；同时覆盖 `failed reviews` 等任务语言重试单位。
- 最终两轮零发现：轮次一正确生成 `failed reviews → ×2`、保存并启动；轮次二正确生成 `stop after the draft is ready` 退出条件和 `if any source is unavailable` 求助边，无伪造重试次数，保存并启动。Runs 仅展示真实 `loop_invocations`。
- 最终 release `.app` 可执行文件 SHA-256 为 `884b92c3f6dbcc6b0030623ab65386f72631340a52e8c9204670d1d4147a98ab`；同批次记录的 Codex sidecar hash 仅属纠偏前历史证据，不代表当前包仍含 Codex 二进制。
- `harness:loop-authoring-flow` 19/19、typecheck 21/21、强制 `@offisim/desktop` release build 与 bundle check 已通过；full `pnpm validate`、UI/dead-code gates 与 GitNexus change detection 在提交前复核。

---

## T10 — Market 用户语言与稳定状态

**结果：** Market 围绕浏览、安装、已安装、导入、发布、审核组织；断网/未连接也保持稳定且可理解。

### Acceptance

- [x] Browse / Installed 固定靠左，search 与右侧动作不因连接态跳位。
- [x] 未连接远端时仍可搜索本地已安装内容，不留透明占位。
- [x] 主流程不要求理解 registry/token/receipt/job id/package extension。
- [x] endpoint/token 仅在有明确用途的 Advanced connection 设置出现。
- [x] empty/loading/error/installed/update available 状态布局稳定。
- [x] Import / Publish / Review 使用任务语言，底层包格式下沉。

### Oracles

- deterministic Market state fixture、UI drift/hygiene gate。
- T16 覆盖离线空状态、本地已安装、搜索、导入、发布入口。

### T10 Evidence（2026-07-16 NZST）

- Browse / Installed 成为固定左侧一级模式，搜索框始终占据同一位置，All / Updates / Published 独立为第二行管理视图；离线 Browse 不再留下透明占位。
- Installed 与 Published 搜索按显示名、版本和本地标识真实过滤；离线、空、无匹配、加载、错误、已安装和可更新状态都有稳定布局与直接恢复动作。
- Market 主流程统一为 `Import from computer…`、`Publish for review…`、`Connection settings` 等用户任务语言；registry、token、receipt、job ID、包扩展名和 runtime/schema 细节不再暴露。
- Endpoint 与 Access token 只保留在 Settings → Advanced connections，并支持保存 endpoint override、替换或清除安全 token；Market 只显示连接结果和任务入口。
- `harness:market-surface` 10/10 覆盖离线本地搜索、状态文案、工具栏结构、查询透传和技术术语边界；renderer production build、typecheck、UI drift gate 均通过。
- 两轮精确 release `.app` 盲测零发现：分别使用两个独立临时 HOME 直接执行 bundle 内二进制，从零创建公司并覆盖 Browse / Installed / Updates / Published、离线搜索、发布审核与 Advanced connection；未通过 LaunchServices 猜 bundle，未触达原 `~/.offisim`。
- release `.app` 可执行文件 SHA-256 为 `8d9d903384f1e502438c493bde5dfc6e22f93744b659595f1805b66a81f15ec4`；同批次记录的 Codex sidecar hash 仅属纠偏前历史证据，不代表当前包仍含 Codex 二进制。

---

## T11 — Personnel Danger Zone

**结果：** 日常编辑以 Save 为唯一主动作；Delete 完整保留但位于 overflow / Danger Zone。

### Acceptance

- [x] 正常编辑视图 Save 是唯一主动作。
- [x] Delete 可发现但不与 Save 同权重。
- [x] 确认明确对象，取消无副作用，不增加多层权限戏剧。
- [x] 删除后 selection、列表、Office projection 和历史引用正确。
- [x] 保存、取消、删除均可键盘与辅助功能完成。

### Oracles

- employee save/delete、employee-version-on-save、Office projection harness。
- T16 使用临时员工覆盖保存、取消删除、确认删除。

### T11 Evidence（2026-07-16 NZST）

- #63 的实现随 #66 合入 `main@c009065e`；`harness:personnel-danger-zone` 10/10，并覆盖 Save-only 日常操作、可访问 Danger Zone、明确对象、Cancel 无副作用与防双击。
- 两个隔离 HOME 的 release `.app` 已完成真实删除、邻近员工选择、Office TEAM 投影、SQLite foreign key 与重启持久化检查；canonical evidence 记录于 `d0ee7c74`。

---

## T12 — Chrome、rails、nav、run pill 稳定

**结果：** 顶栏和 Office 工具条在切换、折叠、run 状态变化时不抖动；不再靠内容区浮动按钮和补偿 padding。

### Acceptance

- [x] 左右 rail toggle 只有一套，位于 Office top chrome，折叠后 rail 宽度为 0。
- [x] 内容 header 无重复 toggle、mini rail、32/34px/pr-12 补偿死区。
- [x] 六个 surface 始终有名称，active/inactive 尺寸与位置不变。
- [x] 1024px 时优先压缩 ScopeBar，不隐藏 nav label。
- [x] run pill idle/running/approval/completed/Stop 使用稳定槽位。
- [x] compact run pill 仍显示阶段、确定性进度和 Stop。
- [x] 没有真实 live run 时不显示 Stop 或幽灵占位。

### Oracles

- UI hygiene、UI drift、rail geometry gates。
- T16 在 1440×900 与 1024×700 覆盖四种 rail 组合和 run 状态。

### T12 Evidence（2026-07-16 NZST）

- Workspace 与 Conversations 的唯一控制进入 Office top chrome；父级在折叠时直接卸载 rail，grid column 变为 `0`。内容 header 的浮动按钮、mini rail 和 `32/34px/pr-12` 补偿层均已删除。
- Office、Loops、Personnel、Market、Studio、Settings 六个名称始终渲染；utility active/inactive 共用同一尺寸。窄窗只压缩 ScopeBar 与 nav gap/padding，不再隐藏 label。
- run pill 使用独立纯展示投影覆盖 idle、preparing、running、approval、completed、interrupted、failed；紧凑态仍保留阶段与确定性进度。Stop 只取 controller-owned `activeRuns`，selected terminal snapshot 只读展示，不会制造 live control。
- `harness:chrome-stability` 10/10、renderer production build、renderer typecheck、UI drift 和整组 `harness:review-fixes` 通过。UI hygiene 没有新增 T12 finding；当前失败仍仅来自已归入 T14 的 Terminal、Browser 与 OfficeScene2D 裸视觉值。
- 两轮精确 release `.app` 使用独立 HOME `/private/tmp/offisim-t12-fresh-a.Nll7MB` 与 `/private/tmp/offisim-t12-fresh-b.d2Hiuh`，均直接执行 bundle 内二进制，从零创建公司并覆盖四种 rail 组合、idle/无 Stop、Settings 激活态和六个 surface 名称；未通过 LaunchServices 猜 bundle，未触达原 `~/.offisim`。
- Computer Use 附着前核验窗口身份：`windowId=10873`、`pid=18089`、title `Offisim`、bounds `x=36 y=33 width=1440 height=888`。T16 仍按 oracle 补足精确 `1440×900`、`1024×700` 与真实 live run 状态矩阵。
- release `.app` 可执行文件为 32,717,104 bytes，SHA-256 `e83ba5604538d900476cdd2e156c7b94ac74c7e29ef63e69b9988893c1b74aa3`；同批次记录的 Codex sidecar hash 仅属纠偏前历史证据，不代表当前包仍含 Codex 二进制。

---

## T13 — Usage / Cost 单一表达

**结果：** 同一 task/account/time window 只出现一套清楚读数；API 与外部 CLI 编排使用不同且真实的语义。

### Acceptance

- [x] Office 默认视图不重复显示相同 token/cost。
- [x] API 显示 token + actual/estimated/unavailable Cost。
- [x] 外部 CLI 编排只显示任务 token/时长与“订阅内 · 无 API 成本”，不建立账户 Usage 页面。
- [x] subscription task 不依赖 provider Usage capability，不显示 unavailable 或伪造 0%。
- [x] account/task 切换后不串 Conversation、Project、月份或计费窗口。
- [x] warning/critical 只来自真实 provider threshold 或用户明确预算。

### Oracles

- run-cost-scope 扩展 billing-mode/provenance fixture。
- activity-data、settings coordinator gates。
- T16 覆盖 Pi API 与 Codex、Claude Code 的真实 run 与计量投影。

### T13 Evidence（2026-07-17 NZST）

- #57/#59 引擎返工后，subscription task 不再有 provider-native limits/reset/credits 数据源；selected task accounting 已移除 `agent_runtime_status(includeUsage: true)` 依赖和 `sessionSubscriptionUsage` 投影。
- API task 继续显示持久化 token coverage 与 actual / estimated / unavailable Cost；subscription task 改为持久化 root run 的本地 token 与 wall-clock duration，并固定显示“订阅内 · 无 API 成本”，不显示 Usage unavailable、不伪造金额。
- duration 由 selected Conversation 的 root `started_at/finished_at` 汇总；运行中 root 以当前时刻计算，异常缺失终止时间的非运行中 root 不扩大时长。
- 多 lane Conversation 继续显示 `Usage split across accounts` 并隐藏合计 Cost；warning/critical 只来自 selected Conversation 的明确 token budget。
- `harness:run-cost-scope` 覆盖 22 tokens / 90 秒 subscription fixture、旧 provider-native 调用与文案禁用、API Cost 和多 lane 隔离；本单不做 release `.app` live verify。

---

## T14 — Radius、presence、error 视觉语义

**结果：** 圆角、人员状态和错误卡片按角色稳定，不再靠临时数值与只依赖颜色/动画的表达。

### Acceptance

- [x] radius roles 唯一映射：control、container、overlay、status、round。
- [x] 已知 `2px/6px/7px/999px` 裸 radius 全部分类或移除。
- [x] hygiene gate 能阻止任意新增非零裸 radius，不靠宽泛 allowlist。
- [x] working/idle/offline/blocked/failed 在 reduced motion 下仍可辨。
- [x] 状态至少由文字 + 色调/形状/表面中的一项共同表达。
- [x] error banner 与 message column 共用水平 inset。
- [x] Office dense HUD 与 dramaturgy 不被扁平化。

### Oracles

- UI hygiene、UI drift、office visual language gates。
- T16 覆盖 radius toolbar、五态 presence、error、reduced motion。

### T14 Evidence（2026-07-16 NZST）

- radius 真源收敛为 `control=7px`、`container=9px`、`overlay=13px`、`status=999px`、`round=50%` 五个语义角色；旧尺寸 alias 只解析到这些角色。CSS 中已知 `2px/6px/7px/999px` 和 TSX `borderRadius` 裸值已移除或转入命名 geometry/token，Canvas `roundRect` 半径统一进入 `CANVAS_RADIUS_TOKENS`。
- `check:ui-hygiene` 现在扫描所有非 token-source CSS 的任意非零裸 radius（包含 `calc(...)`）、TS/TSX 裸 `borderRadius` 与 Canvas `roundRect` 数值末参，不依赖宽泛 allowlist。Terminal 主题改从已解析 CSS token 读取，Browser、OfficeScene2D 与 Loop edge 的裸视觉值同步清除。
- Conversation 投影保留 exact runtime status；Team dock 只从 `queued/running/blocked/paused/failed/completed/cancelled/null` 与员工 online/enabled 真值推导 presence。offline 优先级高于 queued/running，五态分别使用实心脉冲圆、空心圆、琥珀菱形、红色方形与横线，并始终带文字和表面语义；reduced motion 只冻结动画，不删除形状、文字或表面。
- error banner 与 message list 共用 `--off-chat-column-inset`。Office dense HUD、3D dramaturgy、workspace/conversation rail 折叠和 Stage 尺寸保持原结构，没有用扁平化换取一致性。
- `harness:visual-semantics` 覆盖五态、offline precedence、真实 `threadToVm` failed 投影、radius 唯一映射、裸 radius 扫描与 error inset；`pnpm validate` 全量通过，包含 typecheck、UI hygiene/drift、Office visual language/diorama、Codex Rust 51/51、Pi host、native stage、deadcode。`pnpm --filter @offisim/desktop build` 与 bundle sidecar 校验通过。
- 精确 release `.app` 使用隔离 HOME `/private/tmp/offisim-t14-five-state.WfC8Ya`，预置 WORKING / IDLE / BLOCKED / FAILED / OFFLINE 五态并在同一屏完成 Computer Use 验收；disabled + queued fixture 正确显示 OFFLINE。无认证环境发送 `Local visual verification` 只产生本地 `Agent runtime run failed`，未发生外部模型调用；error banner 与消息列内缩视觉一致。
- 操作前匹配精确 app path、`pid=11207`、`windowId=11783`、title `Offisim`、bounds `x=36 y=33 width=1440 height=879`、WebView URL `tauri://localhost`；全程未使用 bundle id、LaunchServices、AppleScript、dev server 或原 `~/.offisim`，窗口由 Computer Use 关闭。
- release 主二进制 SHA-256 `08573b4f6149448cad03a8e5030457435ef1586c8ccc6ad68a75856285a5ee19`；同批次记录的 Codex sidecar hash 仅属纠偏前历史证据，不代表当前包仍含 Codex 二进制。

---

## T15 — Dead docs 与 gates 收敛

**结果：** current docs、agent instructions、产品行为与 gates 使用同一套已交付规则；旧 Pi-only/no-catalog 与错误 workspace/state 断言不再误导。

### Acceptance

- [x] 逐份记录 retain / rewrite / supersede / delete 与替代真源。
- [x] T00 的“目标态”按真实完成状态更新，未完成能力不提前写成 shipped。
- [x] current docs 统一四层边界、engine-neutral、Cost/Usage、exact model truth。
- [x] current docs 统一 Loops 自然语言、Market 用户语言、Office dramaturgy 保留。
- [x] 旧 ADR/roadmap/prototype 要么删除，要么带 superseded banner 与当前链接。
- [x] repo 搜索无互相冲突的现行 Pi-only/no-catalog/Settings exposes `~/.pi` 断言。
- [x] gates 不再锁死 stale approval、实现词或旧产品语言。
- [x] screenshots 作为历史证据保留，临时产物清理。

### Oracles

- dead-doc ledger、冲突词搜索、link checker。
- UI hygiene、runtime capabilities、dynamic API catalog、Codex orchestration contract、`pnpm validate`。

### T15 Evidence（2026-07-17 NZST）

- [`document-truth-ledger.md`](../../document-truth-ledger.md) 对 current、scoped contract、历史 ADR/roadmap/prototype、archive、live-verify evidence 与本地产物逐份记录 `REWRITE / RETAIN / SUPERSEDE / DELETE`；五镜头加 skeptic 复核确认没有 tracked doc 或 screenshot 满足安全删除阈值，独有合同、审计链和历史证据全部保留。
- current docs 已统一为 Pi API engine + Codex、Claude Code CLI 编排 adapter implemented。Pi 保留完整 provider/model 编辑；外部 CLI 只做检测、PATH spawn、事件流、Stop/recovery，凭据/模型/订阅用量归 CLI 自管，任务标“订阅内 · 无 API 成本”。Project folder catalog、Offisim Conversation、Native Agent Home / Session / Memory、effective task workspace 四层分离。
- 25 份历史 Markdown 与 7 份非 canonical HTML prototype 均有醒目的 historical/superseded 标记和 current replacement；canonical Office prototype 明确只承载 visual grammar。所有证据截图保留；ignored 的 `.playwright-mcp/`、`.playwright-cli/`、`feedbacks/`、`output/`、`.DS_Store`、`*.log` 在本 worktree 无 tracked 残留。
- 新增 `pnpm check:docs-truth`，覆盖全库 tracked Markdown 本地链接、current source 持久合同/旧引擎黑名单、superseded record banner/current link，并接入 `harness:review-fixes`、`pnpm validate` 与 node release lane。
- `scripts/harness-codex-app-server-contract.mjs` 与 current docs 同步把“用户安装 CLI + 编排适配器”作为真相，并明确防止已删除的内置二进制及账户/模型/用量探测逻辑回潮。
- GitNexus 在 `main@c009065e` 刷新后确认 production gateway 的影响面为 MEDIUM（8 个直接消费者、13 个总关联、1 个 Runtime 模块）；T15 未修改现有 runtime function/class/method 行为。
- 最终门禁：`node scripts/check-docs-truth.mjs` 检查 99 个 Markdown、22 个 current sources、32 条 superseded records，退出码 0；`node scripts/release-gates.mjs --lane=node` 的 validate、UI hygiene、security harness、supply-chain audit 共 4 个 gate 全绿，退出码 0，且 node lane 未准备或调用 Cargo。

---

## T16 — Release `.app` 盲测闭环

**结果：** 当前 worktree release `.app` 在 fresh state 下连续两轮无本轮 finding。

### Full gates

- [ ] `node scripts/release-gates.mjs` 默认 `all` 通过，包含 Rust `cargo test --locked`。
- [ ] `pnpm --filter @offisim/desktop build` 通过。
- [ ] GitNexus detect_changes 影响范围与 T00-T15 一致。
- [ ] `git diff --check` 通过。

### Window identity

- [ ] 启动精确路径 `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`。
- [ ] 操作前记录 windowId / CGWindowNumber、pid、title、bounds。
- [ ] 未使用 bundle id 启动、盲切焦点或 AppleScript 代替验收。

### Matrix

- [ ] stale approval / new Turn / live Stop。
- [ ] immediate fallback / semantic title / manual rename lock。
- [ ] normal / missing / unique / ambiguous task workspace。
- [ ] Pi API provider/model/真实 run/Usage/Cost；Codex、Claude Code CLI 状态与真实编排 run/token/时长。
- [ ] Loops 自然语言创建、修改、审阅、运行。
- [ ] Market、Personnel、chrome、rails、nav、run pill。
- [ ] radius、presence、error、Office projection 与 dramaturgy。
- [ ] 1440×900 与 1024×700。

### Closure

- [ ] fresh state 连续两轮零 finding。
- [ ] 每个新 finding 已回写所属 task、修根因、重建、重测。
- [ ] evidence 含 checkedAt、commit SHA、App SHA、窗口 identity、步骤、截图与 PASS/BLOCKER。
- [ ] transient profile、临时 workspace/员工、日志与无价值截图已清理。

---

## 收尾规则

T16 完成前，package 状态始终是 **未完整交付**。不得用“known limitation”、仅编译通过、部分 task 完成或 dev 预览替代最终验收。

# Harness 内核替换计划：自研编排 → pi 内核（裁剪型 fork）

> 历史存档，非当前执行蓝本（2026-06-18 复核）。本文的裁剪 fork 方案已被后续官方 Pi Agent Host 路径取代；当前产品不得恢复 `packages/pi-ai` / `packages/pi-agent` / `packages/core/src/pi-bridge` 或旧 `harness:pi-loop`。当前 SSOT 是 `Docs/architecture/2026-06-18-pi-agent-only-runtime.md` 与 `Docs/HARNESS_ARCHITECTURE.md`。

> 状态：已拍板，未动工。本文档是执行蓝本（自包含，开工 session 直接照此执行）。
> 依据：2026-06-13 三路调查（pi 上游核查 / 候选横评 / 本地接缝面）+ 对抗式二次审计 + 老 harness 抹除盘点，全部按 2026-06-13 当前资料核对。
> 最终目标：干净、全新、稳定、靠谱的 harness。老的自研编排从**功能、文档、配置、记忆**四个面抹除。

---

## 1. 病根诊断（为什么推倒）

- 我们**不在** LangGraph fork 上：`packages/core` 直接依赖官方 `@langchain/langgraph@1.3.0`。不靠谱的是我们在它上面手写的编排——`packages/core/src/graph` + `src/agents` 实测 **12,877 行、main-graph 19 个 addNode 节点**（boss / manager / pm_planner / pm_replan / pm_heartbeat / step_dispatcher / step_advance / employee / employee_direct_setup / error_handler / hr / yolo_master / boss_summary + meeting×7 子图），全是自研启发式：正则信号触发重规划（`REPLAN_SIGNAL_RE`）、心跳节点、步骤分派 DAG。
- 「普通回复被误判为 deliverable」根因链：`agents/task-tool-intent.ts`（正则猜用户意图）→ `agents/completion-verifier-evidence.ts`（在工具历史里找证据）→ `agents/employee-completion.ts`（物化 deliverable）。**猜测机制本身就是误判源，整体废除**（盘点 agent 曾建议保留 task-tool-intent，驳回——新架构 deliverable 走显式工具，不再需要意图猜测）。
- 业界（Codex / Claude Code / pi / OpenClaw）的共同形态：**单个 agent = 一个 tool loop；委派 = 一个工具调用（agent-as-tool / subagent）**。没有静态编排图，没有意图猜测。

## 2. 选型结论（按 2026-06-13 核对）

**采用：vendor fork pi 内核两包**（repo `earendil-works/pi`，原 badlogic/pi-mono；MIT；上游 v0.79.2 发布于 2026-06-12；62k stars；Armin Ronacher 共同核心）：

- `@earendil-works/pi-ai` —— 统一 LLM 层：流解析、partial-json 工具调用拼装、thinking block、usage 统计。**z.ai 在源码硬编码识别（openai-completions.ts L1083）、MiniMax 是内置 provider**。
- `@earendil-works/pi-agent-core` —— agent loop 内核仅 ~1,300 行（agent-loop.ts 742 + agent.ts 557），可整体读懂、可自修。

**不取**：`pi-coding-agent`（156 文件 CLI 产品壳，我们有自己的壳）、`pi-tui`。pi 的 compaction / session JSONL 树都在 coding-agent 包，**agent-core 没有这些，与我们自带的预算/持久化体系无冲突**。

**候选排除理由**（横评 4 候选 + 3 长尾全部核过来源）：

| 候选 | 判定 |
|---|---|
| Claude Agent SDK 0.3.x | **排除**：Anthropic Commercial ToS 禁 fork/再分发；无 fetch 注入口（凭证必须进子进程 env，Rust 凭证隔离作废）；每 session 一个 ~224MB 子进程 |
| OpenAI Agents SDK JS 0.11.x | 排除：z.ai/MiniMax 只能走 chat_completions 二等通道；tracing 默认上报 OpenAI（第三方 key 401 坑）；0.x 月更漂移 |
| Vercel AI SDK 6 ToolLoopAgent | **备选 Plan B**：4/4 过硬约束，MiniMax 官方自维护 provider、assistant-ui 官方对接；缺 checkpoint 抽象，v7 已 beta |
| LangGraph 1.4.x 升级 | 排除：no-op——我们已在官方版上照样不靠谱，病根在节点逻辑；转 agent-as-tool 后不再需要图 |
| Mastra / VoltAgent | 排除：app 框架税重 / 生态年轻 |

**fork 策略（学 OpenClaw 终点，跳过它的弯路）**：OpenClaw 经历「裸 npm 依赖 → patch 被上游打断（issue #118）→ vendor fork 自持」，我们直接 fork 自持。上游约**每周一个 minor 且 0.x 语义下 minor 即 breaking**（0.75.0 Node 门槛 / 0.78.0 强制显式 apiKey），裸依赖不可持续。上游 bugfix 按需 cherry-pick。

## 3. 关键设计裁决（对抗审计后修正版）

### 3.1 凭证接缝 = fork 内 fetch 注入（⚠️ 推翻初版「整体替换 StreamFn」）

初版方案「整体替换 StreamFn 接 Rust llm_fetch」是**错误接缝**：`StreamFn (model, context, options) => AssistantMessageEventStream` 是模型调用层不是 HTTP 层，整体替换 = 自己重写 SSE 解析/工具拼装/thinking/usage，等于扔掉 pi-ai 全部价值。

**正确做法**：fork pi-ai，在 provider 构造官方 SDK client 处穿透 `fetch` 选项——Anthropic/OpenAI SDK 原生支持 custom fetch，传入现有 `createTauriLlmFetch(profile)`（`apps/desktop/renderer/src/lib/tauri-llm-fetch.ts:71`），apiKey 传占位符、真凭证由 Rust 侧 `llm_fetch` 注 header（机制原样复用，今天 core 就是 `createGateway({ fetch })` 这么跑的，官方 SDK + 自定义 fetch 在本 WebView 已验证可行）。0.78.0 起上游强制显式 apiKey——占位符策略在 fork 里固化。

自定义 StreamFn 仍然要用，但只做**薄包装**（预算转换 + 身份打标），内部仍调 pi-ai 的 stream（见 3.4）。

### 3.2 裁剪型 fork 范围（不是全量 vendor）

运行环境是 Tauri WebView 浏览器 JS（无 Node；`apps/desktop/renderer/vite.config.ts:14-28` 有 node polyfill/stub 现状；**apps/ 下无 web 产品，web-fallback 约束不存在**）。pi-ai 全量 hard deps 含 5 个 SDK 家族 + AWS/smithy/proxy-agent，且 `stream.ts` 顶层副作用 `register-builtins.ts` 静态注册全部 provider、`agent.ts` 有 `streamSimple` 值级 import 回退——**tree-shake 不掉，必须 fork 时物理砍除**：

- 砍：Bedrock / `@aws-sdk/*` / `@smithy/*` / proxy-agent / OAuth / Google / Mistral / `register-builtins` 副作用 / agent.ts 静态回退。
- 留：**anthropic + openai-compat 两条 lane**（符合 z.ai / MiniMax 供应商政策）+ agent loop 核心 + TypeBox（新包名 `typebox` 1.x，零依赖纯 ESM，浏览器无碍）。
- 预计 fork 后存留 < 5k 行；净新增维护面 ≈ pi loop 本体（`openai`/`@anthropic-ai/sdk` 本来就在依赖树）。
- 落库位置：`packages/pi-ai/`、`packages/pi-agent/`（内部包名 `@offisim/pi-ai`、`@offisim/pi-agent`，保留上游 MIT LICENSE 与出处声明）。

### 3.3 目标架构

- **每个 AI 员工 = 一个 pi agent 实例**（turn-based loop；工具可 per-tool 设并行/串行 executionMode）。
- **boss = 一个 pi agent，「委派员工」是它的一个工具**（delegate tool 的 execute 内：本地员工 → 起子 agent；`is_external===1` 外包员工 → 平移现 `employeeA2aExecutor` 逻辑直调 A2AClient）。pi 上游明确不内置 sub-agent，编排语义（并行度/超时/失败重派）由我们的 delegate 工具实现——这是**有意的薄层**，不是缺口。
- **deliverable = 员工显式调用 `submit_deliverable` 工具**。普通回复永远只是回复。产出的行形状必须与现 `deliverables` 表**逐字段兼容**（含 contributor 头像 employeeBrandFields），否则 MessageItem/OfficeThread/Chats/Activity 静默变空。
- **静态编排图整体删除**。死功能减法（对抗审计实测）：`yolo_master` 无路由引用直删；`hr` 半死降级为 boss 普通工具或删；`meeting` 7 节点砍、**`meeting_sessions` 表保**（Workspace Calendar 在读）；step-plan（pm_planner/replan/heartbeat/dispatcher）节点删、**`task_runs`/`agent_events`/`mcp_audit_log` 表继续写**（Activity/Chats 在读）。

### 3.4 多 agent 运行时三件套 + 守卫（新建，原方案缺）

单图换 N 个并发 loop 是真架构变更，桥接层必须新建：

1. **run 级 agent registry**：threadId → 活 agent 集合；whole-team cancel = 遍历 abort（pi 的 execute 收 AbortSignal，abort 自动写合成 toolResult 保持会话合法——上游已做对）。替代现 `OrchestrationService.currentAborts` 单映射。
2. **事件身份打标桥**：pi 事件不带 companyId/threadId/employeeId/runScope，桥接层 per-agent 闭包打标后再进 eventBus，否则多员工并发 UI 流串台。
3. **同 thread 写入串行化**：full-compact/synopsis 写 `threads.synopsis_json` 的竞态现状靠图天然串行压住，N loop 后必须把 threadLock 搬进桥接层（或 per-agent 独立预算态）。
4. **轮次守卫**：MAX_TOOL_ROUNDS=200 与图递归 400 随图消失，在 loop 包装层重写 runaway 守卫。

### 3.5 预算压缩接缝（按「改写」估工，不是「挂钩子」）

挂接位置成立：自定义 StreamFn 薄包装 = `(model, ctx, opts) => piStream(model, transform(prepareRequest(ctx)), opts)`，转换不回写 canonical messages（与今天 middleware 语义一致）；`RuntimeContext` 不在 StreamFn 参数里，per-agent 闭包捕获。但消息形状是真实工作量：现 `LlmMessage`（string content + toolCalls 平铺）vs pi `AssistantMessage`（content blocks: text/thinking/toolCall），**`conversation-budget/` 子系统（micro-compact/full-compact/synopsis）要改写到 pi 消息形状**（含 reasoningContent ↔ thinking block）。

### 3.6 HITL 审批（零退化，全方案最顺的一块）

现状不是 LangGraph interrupt：`auditing-tool-executor.ts:381-384` 在执行器里同步 `await interactionService.requestAndWait(...)`。pi 的 `Tool.execute(toolCallId, params, signal, onUpdate)` 被 loop 直接 await，**长 await 等审批完全等价**，还白送 `beforeToolCall` 阻断 hook。跨重启审批续跑现状本来就不支持（waiter 随进程死），换 pi 零退化。所有 pi 工具一律路由过保留的 AuditingToolExecutor → 审批 / mcp_audit_log / `interaction.requested/resolved` 事件原样工作。

### 3.7 持久化与续跑（自建修补层，原方案一句话掩盖了三件事）

- pi-agent-core **没有内置 serialize API**：`AgentContext.messages` 纯数据 JSON 入库，tools 恢复时重挂——持久化层自建，**per-message append 粒度，比现 super-step checkpoint 更细，非退化**。
- **必写修补**：pi 的 `runAgentLoopContinue` 对「末尾 assistant 消息含 toolCall 无 toolResult」直接 throw（上游开放 issue #2119/#3073）。resume 前对 dangling toolCall **合成 toolResult**（"interrupted; re-run if needed"）。不写则 ResumeBar 一恢复就崩。
- **版本化 migration**：`checkpoints`/`writes`（LangGraph saver 自建表）删除，`graph_threads` 退役或改造为新会话表；`useUnfinishedThreads`（ResumeBar 数据源）改读新表；老用户未完成线程迁移或诚实标记不可续。db-local 走现行 user_version 迁移链。

### 3.8 Claude Agent SDK / Codex 全代理 lane：保留为旁路（拍板）

core 现依赖 `@anthropic-ai/claude-agent-sdk` + `@openai/agents` adapter，Rust 侧有 claude/codex twins 双 lane 凭证基建，`scripts/tauri-claude-agent-host.entry.mjs` 直接 import adapter。**裁决：保留为 LlmGateway 适配器旁路 lane，不进 pi loop、不在本次推倒范围**；仍按 Runtime Boundaries 约束 `llmToolCallsEnabled=false`（未验证 transport 不得伪装本地工具执行器）。退役与否是独立产品决策，不与内核替换捆绑。迁移时唯一动作：确认 adapter 不 import 任何被删的 graph 符号。

### 3.9 门禁体系：先建后拆（硬顺序约束)

`harness:contract`（13 不变量，直接 import core/dist 的 graph/pm-planner/completion-verifier 模块）、`harness:replay`、`harness:deterministic` 三件套随图报废——它们是本项目 CI 真相源。**必须先给 pi 内核建好等价的录制回放门禁，再动手删旧编排**，否则迁移期零回归保护。`task-tool-intent`/`completion-verifier-evidence` 的删除与 `harness-contract.mjs` 改写同 commit。

### 3.10 契约双清单（桥接层验收标准）

**事件契约**（renderer 实测硬依赖）：

| 事件 | 消费方 | 桥接要求 |
|---|---|---|
| `llm.stream.chunk` | desktop-chat-runtime.ts:222 | 字段 nodeName/content/channel/threadId/runScope；**reasoning 通道必须保**（channel: 'content'\|'reasoning'） |
| `tool.execution.telemetry` + `mcp.tool.result`(legacy) | desktop-chat-runtime.ts:255/264, RunActivityStrip | AuditingToolExecutor 保留即自动续命 |
| `interaction.requested/resolved` | SkillInstallConfirmBar.tsx:41-47 | InteractionService 保留即自动续命 |
| `chat_thread.updated` | 多 surface 同步、boss auto-title | 桥接层补发 |

**DB 即契约**（表续写清单）：`agent_events`（Workspace Chats 持久流）、`mcp_audit_log`（Activity + 证据链）、`deliverables`（行形状逐字段兼容含 contributor 字段）、`task_runs`（状态被读）、`meeting_sessions`（Calendar 读，保表）、`chat_threads`/conversationKey 形态不变。

## 4. 抹除清单（功能 / 配置 / 文档 / 记忆 四个面）

### 4.1 代码（删除 ~180+ 文件 / ~24,600 行 + 场景 JSON ~5,000 行）

| 路径 | 判定 |
|---|---|
| `packages/core/src/graph/`（5 文件） | 删除 |
| `packages/core/src/agents/`（52 文件，含 task-tool-intent.ts、completion-verifier-evidence.ts、employee-completion.ts） | 删除（个别工具组装/prompt 装配逻辑平移进新桥接层后删） |
| `packages/core/src/harness/`、`src/testing/`（24 文件 6,719 行老场景 runner） | 删除 |
| `packages/core/harness/scenarios/`（98 JSON）+ recorded-stream-tool-call-replay.json | 删除 |
| `runtime/completion-verifier.ts` | 删除（advisory 验证随显式 deliverable 工具失去存在意义；若证据展示有 UI 价值，由 submit_deliverable 工具参数显式携带） |
| 保留重接 | `runtime/run-conversation-state.ts`、`runtime/tool-executor.ts`、`mcp/*`、`permissions/*`、`services/conversation-budget*`（改写到 pi 消息形状）、`services/interaction-service.ts`、`a2a/*`、`events/*`、`llm/gateway.ts` + adapters |

### 4.2 依赖与脚本

- 删依赖：`@langchain/core`、`@langchain/langgraph`、`@langchain/langgraph-checkpoint-sqlite`（grep 必须含 **.mts/.mjs**——历史教训两次漏过 .mjs 消费者；~45 源文件 + ≥8 个脚本有 import）。
- 新增 vendor 包：`packages/pi-ai/`、`packages/pi-agent/`（裁剪后 <5k 行，MIT 声明保留，pin 上游 commit 哈希记录于包 README）。
- harness 脚本（scripts/）：删 12（contract/replay/deterministic/soak/chaos/edge/load/resume/scenario-loader/main-control-plane/context 等）；重写 3-4（smoke/stream-tools/context/engine-profiles，基于新内核）；保留 13（mcp-lifecycle/model-bench/provider-adapter/vcr/record/doc-engine/chat-attachment + 全部 security:harness 平台安全 .mts）。
- 根 package.json scripts 同步清理；`validate` 聚合命令更新。

### 4.3 数据库（版本化 migration）

- 删表：`checkpoints`、`writes`。
- 改造：`graph_threads`（退役或改新会话表）、`graph_checkpoints`（checkpoint_kind 枚举重定义为 per-message 持久化语义）、`node_summaries`（node_name → agent 语义，或并入 agent_events 后删表）。
- 续写不动：`agent_events` / `mcp_audit_log` / `deliverables` / `task_runs` / `meeting_sessions` / `chat_threads` / `compact_summaries` / `active_thread_interactions`。

### 4.4 文档（老叙述抹除 + 新架构文档）

- **新写** `Docs/HARNESS_ARCHITECTURE.md`：pi 内核架构 SSOT（agent-as-tool 模型、fork 范围与 patch 点、桥接层三件套、契约双清单、续跑语义、门禁体系）。本 plan 执行完后它是唯一架构真相源。
- **重写**：根 `README.md`（验证策略段）、`Docs/RELEASE_GATES.md`（新门禁矩阵）、`Docs/LOCAL_DEVELOPMENT.md`（harness 命令表）、`packages/core/CLAUDE.md`（删全部 LangGraph/节点叙述，保 zone/memory/skill/vault 等 pi-agnostic 部分）。
- **修订**：根 `CLAUDE.md`（Runtime Boundaries 措辞、GitNexus 索引重建提示）、`Docs/00_start_here/*` 涉编排处。
- 删除老编排相关段落时全文搜关键词：`LangGraph`、`StateGraph`、`buildOffisimGraph`、`pm_planner`、`step_dispatcher`、`MAX_TOOL_ROUNDS`、`harness:contract`。

### 4.5 记忆（Claude memory）

迁移完成后同 session 内执行：MEMORY.md 与 topic 文件中把老 harness 描述为 live 的叙述（节点结构 / MAX_TOOL_ROUNDS / LangGraph checkpoint / completion-verifier / harness:contract 门禁等）逐条改写为「已被 pi 内核替换（2026-06-13 plan）」或删除；保留教训类条目（.mjs grep 教训等）。新增一条指向 `Docs/HARNESS_ARCHITECTURE.md` 的 SSOT 记忆。

## 5. 执行阶段（带验收门禁；每 phase 之间用户 /clear，进度落盘）

**Phase 0（独立先行，可与主线并行交付）— 聊天 UI Codex 式布局**
用户消息右对齐气泡、AI 回复左起全宽、boss 消息也走 Markdown（统一代码块渲染）。改 `MessageItem.tsx:100-159` + `office.css:1015-1060` + `Markdown.tsx`。assistant-ui 不动。验收：release `.app` 截图比对。

**Phase 1 — 裁剪型 fork 落库 + 传输验证**
vendor 两包并物理砍除非 anthropic/openai-compat 的 provider 与副作用注册；provider client 构造处注入 createTauriLlmFetch + 占位 apiKey；WebView bundle 构建通过、无 AWS/Google/Mistral 符号；用 z.ai(anthropic lane, glm) + MiniMax(openai-compat lane, M2.7) 各跑通一次真实流式（text + thinking + tool call 三种 chunk）。验收：renderer typecheck/build 绿 + 两 lane live 流式证据。

**Phase 2 — 桥接层**
agent registry / 事件身份打标（含 reasoning 通道）/ threadLock 搬迁 / 轮次守卫 / 预算子系统改写到 pi 消息形状 / AuditingToolExecutor 包装为 pi AgentTool（bash/fs/MCP 全过审计层）/ interaction 审批 await 路径。验收：单员工在新 loop 上跑通「多轮工具 + 审批弹栏 + 预算压缩触发」。

**Phase 3 — 新门禁（先建后拆）**
基于 pi loop 的录制回放 harness（场景：直聊、多轮工具、审批、abort、resume、deliverable 提交、并发双员工）；接入 `validate` 聚合。验收：新门禁绿且能抓注入的故意回归。

**Phase 4 — 持久化/续跑 + deliverable 显式化**
per-message 持久化入 SQLite + dangling toolCall 合成修补 + migration（删 checkpoints/writes，改 graph_threads）+ ResumeBar 改源；`submit_deliverable` 工具落地（行形状逐字段兼容）。验收：杀进程→重启→续跑成功；deliverable 在 Chats/Activity/消息流三处渲染正确；普通回复 100% 不再产生 deliverable。

**Phase 5 — boss 委派 + 多员工**
delegate 工具（本地子 agent / A2A 外包分支）+ whole-team abort + hr 降级 + meeting/step-plan 节点不再有调用方。验收：boss 派两名员工并行执行、单独取消与全队取消、外包员工 A2A 通道回归。

**Phase 6 — 切流与抹除**
删除 4.1-4.3 全部清单项（LangGraph 依赖、graph/agents/testing/scenarios、12 脚本、2 表）；4.4 文档重写 + 新写 HARNESS_ARCHITECTURE.md；`npx gitnexus analyze` 重建索引。验收：全仓 grep 关键词零残留（含 .mts/.mjs/dist）、turbo typecheck 全包绿、cargo check 绿、新门禁绿。

**Phase 7 — release 验收 + 记忆抹除**
release `.app`（exact path `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`）live 验收矩阵：直聊流式 / 工具真执行（bash 写盘证据）/ 审批栏 / 续跑 / deliverable / boss 委派双员工 / 取消 / Activity-Chats-Calendar 数据面。全过后执行 4.5 记忆抹除。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| fork 后上游漂移（周更 minor 即 breaking） | pin commit 哈希；只 cherry-pick 安全修复与孤儿 toolResult 类加固（#2119）；fork 面 <5k 行可自修 |
| 迁移中期双栈并存复杂度 | Phase 3 门禁先行 + Phase 4-5 按入口（直聊→委派）切流，旧图在 Phase 6 前保持可用 |
| 预算改写引入回归 | compact 前后 token 计数与 synopsis 内容进新门禁场景 |
| deliverable 行形状漂移 | 桥接层写入走现有 repo 方法不绕道；门禁含三消费面渲染断言 |
| 续跑数据迁移伤老用户 | migration 提供「标记不可续 + 保留聊天记录」兜底，不静默丢数据 |

## 7. 开放项（不阻塞开工）

- meeting 产品功能将来以 agent-as-tool 重建的产品形态（保表已留后路）。
- Claude/Codex 旁路 lane 的长期去留（独立产品决策）。
- Plan B 触发条件：若 Phase 1-2 发现 pi fork 在 WebView 有不可修的硬伤，转 Vercel AI SDK 6 ToolLoopAgent（差距仅持久化层，Phase 4 自建部分通用）。

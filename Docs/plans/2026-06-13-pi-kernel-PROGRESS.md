# pi 内核替换 — 执行进度（落盘，跨 session persist）

SSOT plan: `Docs/plans/2026-06-13-pi-kernel-replacement.md`
开工 session: 2026-06-13。约束：先建后拆（旧 graph 在 Phase 6 前保持可用，全程门禁绿）。

## 上游 fork 基准
- 上游 `earendil-works/pi` v0.79.2 / commit `f21f3c4bbdd3868ce2a7a68019d7920b838f663b`（MIT）。
- 本地 clone 在 `/tmp/pi-upstream`（临时，可重新 clone）。

## 进度

### ✅ Phase 1（部分）— 裁剪型 fork 落库
- `packages/pi-ai/`（`@offisim/pi-ai`，4490 行）：只留 anthropic-messages + openai-completions 两 lane。
  - 物理删：Bedrock/AWS/Smithy、Google/Vertex、Mistral、Azure、OpenAI Responses/Codex、register-builtins lazy 链、models.generated（17k 行）、env-api-keys、oauth、images、cli、node-proxy。
  - 重写：`models.ts`（只留 calculateCost/clampThinkingLevel/getSupportedThinkingLevels/modelsAreEqual，丢 MODELS 注册表）、`stream.ts`（删 env-key 读取）、`providers/register-builtins.ts`（直接 import 两 provider，模块加载即注册）、`index.ts`（裁剪导出）。
  - **凭证接缝**：`StreamOptions.fetch?: typeof fetch` 新增，穿透 `simple-options.buildBaseOptions` → 两个 provider 的 `createClient` → `new Anthropic({ fetch })` / `new OpenAI({ fetch })`。apiKey 占位、真凭证由 Rust 注。
- `packages/pi-agent/`（`@offisim/pi-agent`，1728 行）：只取 `agent.ts`+`agent-loop.ts`+`types.ts`，丢整个 harness/ 子树 + proxy.ts。
- tsconfig：vendored 档位（noUnused*=false、noUncheckedIndexedAccess=false，对齐上游）。
- **门禁**：两包 typecheck 绿、build 绿（pi-ai dist 26 文件）。
- **待办（需 live）**：streamFn 薄包装（在 Phase 2 建）；两 lane 真实流式验证（z.ai anthropic glm + MiniMax openai M2.7，text/thinking/toolcall 三 chunk）放到末尾批量 live；renderer bundle 无 AWS/Google/Mistral 符号验证（随 renderer build）。

### ✅ Phase 0 — 聊天 UI Codex 式布局（commit `ec028138`）
用户消息右气泡 + AI 左起全宽 + boss 也走 Markdown。MessageItem.tsx + office.css。

### ✅ Phase 2 — 桥接层（commit `ec028138` + 桌面接线 `8aaf2ee2`）
`packages/core/src/pi-bridge/`：pi-model / pi-message-convert（pi↔LlmMessage，复用预算服务）/ pi-tool-adapter（过 AuditingToolExecutor）/ pi-stream（凭证接缝薄包装）/ pi-agent-registry（whole-team abort）/ pi-event-bridge（身份打标，content+reasoning 通道）/ pi-budget（transformContext 复用 ConversationBudgetService）/ pi-orchestration-service（runWorker + threadLock + 轮次守卫）。桌面 `desktop-agent-runtime.ts` flag 门控（localStorage `offisim:pi-kernel` 或 VITE_PI_KERNEL）路由到 pi。renderer build 绿、pi bundle 0 AWS/Google/Mistral SDK。

### ✅ Phase 4（deliverable 部分）— submit_deliverable + 持久化接线（commit `a5066aca`）
显式 `submit_deliverable` virtual tool（替换意图猜测链）；桌面接 DeliverablePersistenceService（之前根本没接，事件飘空）。

### ✅ Phase 5 — boss 委派 + 递归子 agent（commit `d7d7b009`）
`delegate` virtual tool：本地员工递归 runWorker / 外包员工平移 employeeA2aExecutor（A2AClient.sendAndWait）。parallel 模式多员工并发；boss prompt 带 roster；parentSignal 传播。

### ⏳ 待开发（live 验收后再做，避免 migration-startup 风险阻塞测试）
- **下一步：先 live `.app` 验收 P1/P2/P4/P5 基础**（VITE_PI_KERNEL=1 烧进 release，单轮聊天+工具+deliverable+委派）。thinkingLevel 默认 off（z.ai glm thinking 格式兼容未验，先验 text+toolcall）。
- Phase 4（剩）：per-message 持久化（新 `pi_messages` 表 + migration 0002 + 3 backend）+ dangling toolCall 合成修补 + ResumeBar 改源。
- Phase 3：新门禁（基于 pi loop 的录制回放）。
- Phase 6：切流抹除（删 graph/agents/testing/scenarios/12 脚本/2 表/3 依赖 + 文档重写 + 新写 HARNESS_ARCHITECTURE.md）。
- Phase 7：release `.app` 全矩阵验收 + 记忆抹除。

### ✅ 自审 + 整改 + P3 门禁 + P4 持久化 + live 验收（2026-06-13 续）
**对抗式自审**（4 路 agent + 复验，8 confirmed high/med，0 误报）→ 全部整改：
- **boss 假装执行根因修复**：boss prompt 加硬工具纪律（必须 delegate、禁编造）；boss 改 delegate-only（不再给 bash/write/MCP）。
- bridge bug：budget per-run threadId / 压缩保形尾对齐 / correlationKey 抗碰撞 / MiniMax compat（max_tokens）/ delegated 子 agent nodeName `employee_subtask` 不串台 / parent-abort leak。
- **P4 持久化完成**：`pi_messages` 表（+employee_id owner，migration 0002）+ 3 backend + PiMessageStore 接线（history 加载带 dangling-toolCall 修补 / per-message append）+ pi resume（按 owner 续跑）。
- **P3 门禁**：`scripts/harness-pi-loop.mjs`（faux StreamFn 确定性回放：直聊/多轮工具/deliverable/boss-delegate/多轮记忆/resume/回归守卫）接入 `validate`。

**🎯 LIVE 验收（release `.app` + computer-use + devtools + DB 实证）**：
- ✅ **boss 现在真 delegate**（pi_messages seq1=delegate toolCall → toolResult → summary，不再编造）。
- ✅ **delegated 子 agent 真执行工具**（devtools console 见 `date +%s%N`→真时间戳、`ls`→真文件，归属 Maya）。**假装执行病根已根除**。
- ⚠️ **发现并修复 audit-FK bug**：`mcp_audit_log.thread_id REFERENCES graph_threads(thread_id)`，pi 线程无 graph_threads 行（updateStatus 是裸 UPDATE 不建行）→ 每条工具 audit insert 失败（工具照常执行+结果回流，只是证据链丢行）。修复=`ensureThreadRow` 开 turn 时建行。**待最终 rebuild 验收 audit 行落库**。

### 待办
- **P6 切流抹除**（旧 graph 还在；删 graph/agents/testing/scenarios/12 脚本/@langchain 三依赖/checkpoints+writes 表 + 文档重写 + 新写 HARNESS_ARCHITECTURE.md + pi 设默认）。**最大剩余块**，需谨慎不破坏构建。
- **P7** 最终 release 验收（audit 行落库确认）+ 记忆抹除。
- 低优：boss/team 回复 UI 标签显示 'Employee' 应为 boss/team（cosmetic）。

### Commits (main, 未 push)
`ec028138` fork+bridge / `8aaf2ee2` 桌面接线 / `a5066aca` deliverable / `d7d7b009` delegate / `7aa5a2e5` 自审整改+P4持久化 / `00cc30c7`+gate / `7aa5a2e5`.. audit-FK fix。

## 关键契约锚点（侦察实测，桥接层必须复刻）
- LLM 传输：`apps/desktop/renderer/src/lib/tauri-llm-fetch.ts` `createTauriLlmFetch(profile)`；core `createGateway({ fetch })`（`gateway-factory.ts`）。
- 编排入口：`services/orchestration-service.ts` `execute({entryMode,messages,threadId,companyId,runScope,projectId})`；桌面经 `desktop-agent-runtime.ts`（L221 createTauriLlmFetch / L235 fetch 注入）。
- 事件契约：`llm.stream.chunk`(nodeName/content/channel 'content'|'reasoning'/chatThreadId/runScope)、`tool.execution.telemetry`、`mcp.tool.result`、`interaction.requested/resolved`、`chat_thread.updated`。renderer 订阅 desktop-chat-runtime.ts:222/255/264、SkillInstallConfirmBar.tsx:41-47、RunActivityStrip。
- DB 即契约（续写不动）：`agent_events`/`mcp_audit_log`/`deliverables`(逐字段+contributors_json)/`task_runs`/`meeting_sessions`/`chat_threads`/`compact_summaries`/`active_thread_interactions`。删表：`checkpoints`/`writes`。改造：`graph_threads`/`graph_checkpoints`/`node_summaries`。
- AuditingToolExecutor：`mcp/auditing-tool-executor.ts` execute(ToolCallRequest)→ToolCallResponse；审批 `interactionService.requestAndWait` L381；保留即续命。
- 预算：`services/conversation-budget-service.ts` prepareRequest(ctx,request,{forceFullCompact}) 经 SummarizationMiddleware（priority 10）；synopsis 写 graph_threads.synopsis_json。
- 持久化：`tauri-checkpoint-saver.ts`（LangGraph saver，删）；ResumeBar/useUnfinishedThreads 读 graph_threads.status∈(queued/running/blocked/paused)。

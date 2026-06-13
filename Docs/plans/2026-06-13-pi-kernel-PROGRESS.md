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

### ⏳ 待开发
- Phase 0：聊天 UI Codex 式布局（独立先行）。
- Phase 2：桥接层（streamFn 包装/agent registry/事件身份打标/threadLock/轮次守卫/预算改写到 pi 消息形状/AuditingToolExecutor→pi AgentTool/interaction await）。
- Phase 3：新门禁（录制回放）。
- Phase 4：持久化/续跑 + dangling toolCall 修补 + submit_deliverable。
- Phase 5：boss 委派 + 多员工 + A2A。
- Phase 6：切流抹除（删 graph/agents/testing/scenarios/12 脚本/2 表/3 依赖 + 文档重写）。
- Phase 7：release `.app` 验收 + 记忆抹除。

## 关键契约锚点（侦察实测，桥接层必须复刻）
- LLM 传输：`apps/desktop/renderer/src/lib/tauri-llm-fetch.ts` `createTauriLlmFetch(profile)`；core `createGateway({ fetch })`（`gateway-factory.ts`）。
- 编排入口：`services/orchestration-service.ts` `execute({entryMode,messages,threadId,companyId,runScope,projectId})`；桌面经 `desktop-agent-runtime.ts`（L221 createTauriLlmFetch / L235 fetch 注入）。
- 事件契约：`llm.stream.chunk`(nodeName/content/channel 'content'|'reasoning'/chatThreadId/runScope)、`tool.execution.telemetry`、`mcp.tool.result`、`interaction.requested/resolved`、`chat_thread.updated`。renderer 订阅 desktop-chat-runtime.ts:222/255/264、SkillInstallConfirmBar.tsx:41-47、RunActivityStrip。
- DB 即契约（续写不动）：`agent_events`/`mcp_audit_log`/`deliverables`(逐字段+contributors_json)/`task_runs`/`meeting_sessions`/`chat_threads`/`compact_summaries`/`active_thread_interactions`。删表：`checkpoints`/`writes`。改造：`graph_threads`/`graph_checkpoints`/`node_summaries`。
- AuditingToolExecutor：`mcp/auditing-tool-executor.ts` execute(ToolCallRequest)→ToolCallResponse；审批 `interactionService.requestAndWait` L381；保留即续命。
- 预算：`services/conversation-budget-service.ts` prepareRequest(ctx,request,{forceFullCompact}) 经 SummarizationMiddleware（priority 10）；synopsis 写 graph_threads.synopsis_json。
- 持久化：`tauri-checkpoint-saver.ts`（LangGraph saver，删）；ResumeBar/useUnfinishedThreads 读 graph_threads.status∈(queued/running/blocked/paused)。

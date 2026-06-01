# Offisim Formal Code Inspection

审查日期：2026-06-01  
外部基准时间窗：按用户要求，以 2026-05 附近的 Context7、官方文档、GitHub 当前高星项目为准  
范围：`apps/desktop/renderer/src`、`apps/desktop/src-tauri/src`、`apps/platform/src`，并抽查与 apps 直接耦合的 `packages/*` 运行时、schema、install、registry client、renderer contract  
交付口径：只记录，不修复代码

## 结论

当前仓库的主方向是清晰的：Tauri v2 桌面产品 + React 19 renderer + Hono platform，整体没有重新长出 standalone web/launcher，也基本遵守 `Docs/UI_FRAMEWORK_STACK.md` 的 approved stack。

最大问题不在基础框架，而在“用户以为已经是完整产品”的几个面：AI 对话、Workspace 套件、Market 发布链路、运行时账本。尤其是 AI surface 当前是 assistant-ui primitives + 自定义 external-store runtime，不是 `@assistant-ui/react-ai-sdk` + Vercel AI SDK runtime；如果新产品目标是“100% assistant-ui + Vercel AI SDK core”，现状不达标。如果按当前项目文档“assistant-ui 自定义 runtime，不走普通 SDK lane”理解，框架选择本身成立，但仍要修重复 runtime、附件不入 prompt、历史不落库、成本账本断链。

## 二次严格审计校准

二审结论：本报告的主要事实和代码证据成立；需要校准的是问题优先级和产品口径。Offisim 的业务宗旨是实用、低理解成本、零理解成本使用，所以本报告后续修复排序以“用户是否会误解、流程是否会卡死、功能是否看起来完成但实际不可用”为第一标准；安全和运维项只在会造成用户数据写错位置、发布不可恢复、配置损坏或部署形态变化时进入主线。

二审后需要明确的校准：

- AI SDK 项不是当前仓库既定路线下的实现 bug。`Docs/UI_FRAMEWORK_STACK.md` 明确要求 assistant-ui custom runtime / external store，不替换 Offisim runtime/tool execution；所以 F-02 只能作为“产品口径冲突 / 新目标差距”记录。只有当产品重新拍板“SDK-native employee runtime profile”时，才把它升级为架构改造任务。
- GitHub stars 是实时数据，二审已把 2026-06-01 当前 API 返回值微调到表格里。stars 不应作为强证据，只作为“这些是活跃主流项目”的参考。
- F-10、F-14、F-15 都偏安全/可靠性。F-10 涉及用户导出文件写到预期位置，仍保留；F-14/F-15 不应挤占易用性主线，只作为部署或触碰对应模块时的 gate。
- dnd-kit 未使用不等于必须立刻迁移。Studio 当前自实现 drag/drop 若体验稳定，可以先保留；只有当 drag/drop 成为共享框架能力或需要键盘可达性时，再补架构决策或迁移。

## 审查方法与证据

- 本轮覆盖 app source：227 个 `.ts/.tsx/.rs` 文件，约 47,127 行，不含 `dist`、`node_modules`。
- 已重新分析 GitNexus：`npx gitnexus analyze`，当前索引为 Offisim 最新 worktree，14,636 nodes / 25,567 edges / 300 flows。
- 文件覆盖账本：
  - `apps/desktop/renderer/src`：165 个 source 文件；root 3、app 5、assistant 8、data 6、design-system 34、lib 22、polyfills 2、runtime 2、styles 1、surfaces 82。
  - `apps/desktop/src-tauri/src`：24 个 source 文件；root 16、mcp_bridge 8。
  - `apps/platform/src`：38 个 source 文件；root 6、lib 2、middleware 4、routes 10、schemas 1、seed 10、services 5。
- GitNexus 函数/方法级覆盖计数：desktop renderer 723 functions / 161 methods / 210 interfaces / 2 classes；desktop Tauri 385 functions；platform 71 functions / 4 methods / 15 interfaces。
- 记录口径：本报告是 formal inspection 结果摘要，不是逐函数 OK 清单。审查按文件和 GitNexus 符号覆盖到函数/方法层；未列入 finding 的函数/方法表示二审没有发现会影响业务真实度、用户理解成本、框架一致性或后续维护的实际问题。
- GitNexus 关联复核：
  - `sendProviderText` 被 `ProviderPane.handleTestConnection`、`useOfficeRuntime.sendRuntimeProviderMessage`、`MessengerApp.sendWorkspaceProviderMessage` 调用。
  - `processModerationJob` 只由 `apps/platform/src/routes/publish.ts` 的 submit route 调用。
  - `useWsConversations` 被 Workspace rail、Messenger、Contacts 依赖。
- 外部基准使用：
  - assistant-ui: [Vercel AI SDK Integration](https://www.assistant-ui.com/docs/integrations/frameworks/ai-sdk)、[Vercel AI SDK Runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/overview)、[AI SDK v6 current runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/v6)
  - Vercel AI SDK: [`streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)、[`createUIMessageStreamResponse`](https://ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream-response)、[Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
  - Tauri v2: [Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)、[Capabilities](https://v2.tauri.app/security/capabilities/)
  - Hono: [HTTPException / onError](https://hono.dev/docs/api/exception)、[Body Limit Middleware](https://hono.dev/docs/middleware/builtin/body-limit)
  - Better Auth: [Hono Integration](https://better-auth.com/docs/integrations/hono)、[Bearer Token Authentication](https://better-auth.com/docs/plugins/bearer)
  - Drizzle: [Transactions](https://orm.drizzle.team/docs/transactions)
  - TanStack Query: [Dependent Queries](https://tanstack.com/query/latest/docs/framework/react/guides/dependent-queries)
  - React: [`memo`](https://react.dev/reference/react/memo)、[`useCallback`](https://react.dev/reference/react/useCallback)
  - shadcn/ui: [Components](https://ui.shadcn.com/docs/components)、[Registry](https://ui.shadcn.com/docs/registry/getting-started)
  - Radix UI: [Dialog Accessibility](https://www.radix-ui.com/primitives/docs/components/dialog)
  - Zustand: [Flux-inspired practice](https://zustand.docs.pmnd.rs/learn/guides/flux-inspired-practice)
  - Motion: [Motion for React](https://motion.dev/react)

## 高星项目对照

GitHub API 当前查询时间：2026-06-01。

| 项目 | stars | 最近 push | 用途 |
| --- | ---: | --- | --- |
| [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | 10,369 | 2026-06-01 | assistant surface / runtime 对照 |
| [vercel/ai](https://github.com/vercel/ai) | 24,576 | 2026-06-01 | AI SDK streaming / tool / UI message 对照 |
| [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | 107,324 | 2026-06-01 | desktop IPC / capability 对照 |
| [honojs/hono](https://github.com/honojs/hono) | 30,716 | 2026-06-01 | platform API 对照 |
| [better-auth/better-auth](https://github.com/better-auth/better-auth) | 28,539 | 2026-06-01 | auth 对照 |
| [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | 34,623 | 2026-06-01 | transaction / schema 对照 |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | 115,390 | 2026-05-31 | local primitive / registry 对照 |
| [TanStack/query](https://github.com/TanStack/query) | 49,539 | 2026-06-01 | async state 对照 |
| [pmndrs/zustand](https://github.com/pmndrs/zustand) | 58,159 | 2026-05-29 | UI state 对照 |
| [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit) | 31,880 | 2026-06-01 | agentic UI 对照 |
| [ag-ui-protocol/ag-ui](https://github.com/ag-ui-protocol/ag-ui) | 13,945 | 2026-05-29 | agent UI protocol 对照 |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | 75,524 | 2026-05-31 | software agent product 对照 |
| [continuedev/continue](https://github.com/continuedev/continue) | 33,477 | 2026-05-29 | local coding assistant 对照 |

## 模块覆盖矩阵

### Desktop renderer

| 模块 | 重点文件 | 审查判断 |
| --- | --- | --- |
| app shell / providers | `App.tsx`、`AppProviders.tsx`、`ui-state.ts`、`CommandPalette.tsx` | React Query、Motion、Zustand 用法符合 approved stack。`ui-state.ts` 只放选中态/rail/surface 等 UI state，符合 Zustand 常规。 |
| design-system primitives/grammar/shell | `design-system/primitives/*`、`grammar/*`、`shell/*` | shadcn/Radix 被包到 Offisim grammar 后使用，符合 `Docs/UI_FRAMEWORK_STACK.md`，没有直接把默认 shadcn visual language 泄到业务面。 |
| assistant surface | `OfficeThread.tsx`、`useOfficeRuntime.ts`、`run-store.ts`、parts/composer | 使用 assistant-ui primitives，但 runtime 是自定义 external-store，存在重复实现、附件不入模型、历史不落库、非 AI SDK runtime 问题。 |
| data/repo layer | `data/queries.ts`、`adapters.ts`、`lib/tauri-repos.ts`、`lib/tauri-drizzle.ts` | repo adapter 思路正确，但 `queries.ts` 过大，混有 raw SQL 和 repo API；`useDeliverables` 漏 `enabled`；Tauri Drizzle transaction 仍有已知隔离缺口。 |
| Office | `OfficeSurface.tsx`、`ChatRail.tsx`、`OfficeStage.tsx`、`TeamDock.tsx`、scene/r3d | 3D/2D scene 拆分较完整，团队/rail/scene 关系清晰。风险主要来自 chat runtime，而不是 scene 组件本身。 |
| Workspace suite | `WorkspaceSurface.tsx`、`workspace-data.ts`、`MessengerApp.tsx`、apps/* | UI 完整，但 data hooks 主要是 fixtures；Messenger 单独实现一套 provider runtime。作为 prototype 合理，作为 release 功能不够真实。 |
| Market | `market-data.ts`、`MarketSurface.tsx`、`InstallDialog.tsx`、`PublishDialog.tsx` | install/publish 业务链完整度高，但 `market-data.ts` 1774 行过大；registry listing 加载是 list 后 N+1 detail/download。 |
| Personnel | `PersonnelSurface.tsx`、tabs、`personnel-data.ts` | 业务流程可用，React Hook Form + Zod 符合栈。`PersonnelSurface.tsx` 911 行承载过多，拆分收益高。 |
| Settings | `settings-data.ts`、`ProviderPane.tsx`、`McpServersPane.tsx`、Runtime/ExternalEmployee panes | provider/MCP/runtime 概念对齐较好；数据层 945 行过大。MCP stdio 有确认弹窗和 runtime 校验，方向正确。 |
| Activity | `activity-data.ts`、`ActivitySurface.tsx`、detail/payload view | 真实 runtime events + fixture fallback 的边界清楚；filter/group/collapse 函数较纯，质量好。 |
| Lifecycle | `CompanyCreationWizard.tsx`、selection/preview/data | 创建公司 flow 和壳层隔离合理；未发现高影响问题。 |
| Studio | `StudioSurface.tsx`、`studio.css` | 功能完整，drag/place/zone edit 写得扎实；但 987 行把交互状态、validation、mutation、UI 全放一起，后续维护成本高。 |

### Desktop Tauri

| 模块 | 重点文件 | 审查判断 |
| --- | --- | --- |
| bootstrap / capabilities | `lib.rs`、`capabilities/*.json`、`permissions/*.toml` | Tauri v2 command/capability 模式符合官方做法。命令权限集中，release app 单实例/focus 处理实用。 |
| local DB | `local_db.rs` | SQLite init、迁移、transaction command 是 renderer repo 的核心基础；需关注 transaction proxy 的 JS 侧限制。 |
| LLM transport | `llm_transport.rs`、`runtime_secrets.rs` | credential 不穿 IPC、禁 redirect、chunk/response cap、abort token，这条链路质量高。问题是 renderer 只 buffer raw response，没把 streaming/tool event 消费成 UI message。 |
| builtin tools / shell | `builtin_tools.rs`、`shell_classifier.rs` | workspace root 约束、read/write cap、O_NOFOLLOW 写入、shell classifier、env 清理都符合本机工具常规。 |
| git | `git.rs` | subcommand allowlist、阻止 force/hard/amend/no-verify、cwd 约束、输出截断，方向正确。 |
| local paths / vault | `local_paths.rs` | vault/status/export 功能完整；`save_deliverable_to_local` 写前/写后边界检查不一致，需复用 `project_write_file` 的 safe open 模式。 |
| attachment store | `attachment_store.rs` | 文件附件路径隔离和 store 模型完整；需与 assistant prompt/runtime 打通，否则 UI 附件只是视觉状态。 |
| MCP bridge | `mcp_bridge/*` | registry、fingerprint、stdio confirm、spawn allowlist、handshake、tool list 都较完整；registry persist 用直接 `fs::write`，可用 temp+rename 提高崩溃恢复。 |
| agent hosts / resume / sessions | `claude_agent_host.rs`、`codex_agent_host.rs`、`resume.rs`、`sessions.rs` | 与当前“host-resolved / trusted desktop host”产品路线一致；没有当作普通 SDK lane 暴露。 |

### Platform

| 模块 | 重点文件 | 审查判断 |
| --- | --- | --- |
| app/bootstrap | `app.ts`、`index.ts`、`startup.ts` | Hono middleware 顺序合理：secure headers、CORS、request id、rate limit、DB 注入、optional auth、error handler、routes。 |
| auth | `auth.ts`、`middleware/auth.ts`、`routes/auth.ts`、`routes/me.ts` | Better Auth + API token 双通道可读性高；API token scope 只约束 token 请求，注释清晰。 |
| body/error/request id | `lib/body-limit.ts`、`middleware/error-handler.ts`、`request-id.ts` | body streaming cap 符合 Hono body-limit 思路；错误输出风格一致。 |
| market / install / reviews | `routes/market.ts`、`routes/install.ts`、`routes/reviews.ts` | install receipt transaction、artifact integrity check、review aggregate update 质量较高。 |
| publish / moderation | `routes/publish.ts`、`services/moderation.ts`、`artifacts.ts`、`validation.ts` | manifest/artifact validation扎实，moderation job claim pattern 正确；submit 状态更新和 job 创建缺事务，是主要平台风险。 |
| search | `services/search.ts` | 简洁可用；`%${q}%` 对 `%/_` 当 wildcard，体验不够可预测；relevance 对新品不友好。 |
| seed | `seed/*` | official seed 与 asset schema/payload 拆分合理；未发现阻断问题。 |
| resume/sessions | `routes/resume.ts`、`routes/sessions.ts` | 依赖 local runtime token/desktop context；注释说明了未来多用户所有权风险。 |

## 重要发现

### F-01：Publish submit 会把 draft 标成 submitted 后才创建 moderation job，失败会卡死

严重度：阻断，影响 platform marketplace 发布闭环。  
位置：`apps/platform/src/routes/publish.ts:365` 到 `apps/platform/src/routes/publish.ts:400`

证据：submit route 先 `update(publishDrafts).set({ status: 'submitted' })`，成功后再 `insert(moderationJobs)`。如果 insert 失败，draft 已经进入 `submitted`，但没有 job 可被 worker 或同步 `processModerationJob` 处理。

行业对照：Drizzle 官方 transaction 文档给出的常规做法是把同一个业务状态迁移里的多条 DB 语句放入 `db.transaction(...)`，必要时嵌套用 savepoint。这里 draft 状态迁移和 job 创建是同一个业务原子操作。

修复意见：把 draft guarded update + moderation job insert 放进一个 `db.transaction`。transaction commit 后再同步调用 `processModerationJob`；如果同步处理失败，job 仍保留为 pending/processing 可恢复状态，不能让 draft 孤立在 submitted。

### F-02：AI surface 不是 Vercel AI SDK runtime；这是产品口径冲突，不是当前既定路线下的实现 bug

严重度：口径项；只有在产品目标改为“100% assistant-ui + Vercel AI SDK core”时升级为重要架构项。  
位置：
- `apps/desktop/renderer/package.json:13` 到 `apps/desktop/renderer/package.json:60`
- `packages/core/package.json:71` 到 `packages/core/package.json:86`
- `apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts:237`
- `apps/desktop/renderer/src/lib/provider-bridge.ts:57` 到 `apps/desktop/renderer/src/lib/provider-bridge.ts:185`
- `packages/core/src/llm/openai-adapter.ts:1`、`packages/core/src/llm/gateway.ts:89`

证据：renderer 依赖 `@assistant-ui/react`，但没有 `@assistant-ui/react-ai-sdk`、`ai`、`@ai-sdk/react`；全仓搜索 `streamText`、`toUIMessageStream`、`useChatRuntime` 无命中。当前 `useOfficeRuntime` 使用 `useExternalStoreRuntime`，`provider-bridge.ts` 手写 OpenAI/Anthropic-compatible body，走 Tauri `llm_fetch` 后 buffer raw JSON，再 `extractProviderText`。core 侧是自研 `LlmGateway`，底层直接用 OpenAI SDK、Anthropic SDK、Claude/OpenAI Agents SDK lane。

行业对照：assistant-ui 当前文档明确把 AI SDK 集成路径定义为 `@assistant-ui/react-ai-sdk` 包装 AI SDK `useChat`；新项目应使用 AI SDK v6，安装 `ai@^6`、`@ai-sdk/react@^3`，前端用 `useChatRuntime`，后端常规以 AI SDK `streamText` 输出 UI message stream。Vercel AI SDK 文档当前也把 `streamText().toUIMessageStreamResponse()`、tool calling、UI message stream 作为 chat UI 的主路径。

当前项目决策对照：`Docs/UI_FRAMEWORK_STACK.md:24` 明确写的是 assistant-ui custom runtime / external store，不替换 Offisim runtime/tool execution；项目 AGENTS 也写明默认 Offisim harness/gateway，不存在普通 SDK lane。因此这不是一个小 bug，而是产品/架构目标口径冲突。

修复意见：不建议为了追逐框架一致性直接迁移。先做产品口径决策：
- 若保持当前 Offisim runtime 路线：保留 custom runtime，更新产品说法，禁止再用“内核 Vercel AI SDK”描述当前架构。
- 若新目标改成 SDK-native employee runtime profile：新增独立 capability profile，用 `@assistant-ui/react-ai-sdk` + AI SDK `streamText`/UIMessage stream 在 adapter 边界实现，保留 desktop Rust credential transport 作为底层 fetch，不把它伪装成普通 SDK lane。

### F-03：OfficeThread 和 Workspace Messenger 各自实现一套 assistant runtime，行为会继续漂移

严重度：重要，影响对话体验一致性。  
位置：
- `apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts:31` 到 `apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts:84`
- `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx:134` 到 `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx:176`
- `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx:630` 到 `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx:897`

证据：两边各自有 `appendText`、message-to-assistant conversion、provider profile lookup、send/cancel/draft 状态。GitNexus 显示 `sendProviderText` 共有三个入口：Settings 测试、OfficeThread、MessengerApp。现在 provider bridge 是共用的，但 assistant runtime adapter 没共用。

行业对照：assistant-ui 的 runtime 层就是为了集中 thread/composer/message/tool state。重复 runtime 会让附件、取消、错误、token/cost、历史持久化、tool UI 分别补丁化。

修复意见：抽出一个 `useDesktopAssistantRuntime` 或 `createDesktopExternalStoreRuntime`，由 Office 和 Workspace 提供 view-model conversion、thread id、assignee、surface-specific chrome。provider send、abort、attachment serialization、error classification、cost/event recording 只留一处。

### F-04：附件 UI 表现为“附到消息”，但发送给 provider 的只有 text

严重度：重要，影响低理解成本。用户会以为模型看到了附件。  
位置：
- `apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts:125` 到 `apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts:147`
- `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx:707` 到 `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx:736`

证据：Office runtime 把 staged attachment 写进 draft message 的 `attachments`，但 `sendRuntimeProviderMessage(text, requestId)` 只传 text。Workspace Messenger 同样只展示第一个 attachment chip，然后 `sendWorkspaceProviderMessage(text, ...)` 只发 text。

行业对照：assistant-ui + AI SDK 文档把 attachments 作为 runtime/message conversion 的一等能力。agent 产品常规也必须让“显示已附加”和“模型实际可读”一致，否则用户理解成本极高。

修复意见：在 shared runtime adapter 中把附件转成模型可消费上下文：小文本可内联，大文件用 attachment store ref + tool-readable preface，二进制用明确“不读内容，仅记录文件名”的 UI 文案。短期至少把按钮/tooltip 改成“staged for UI only”前不能继续暗示 provider 已读。

### F-05：真实 desktop chat history 不持久化，刷新/切线程后容易丢会话上下文

严重度：重要。  
位置：
- `apps/desktop/renderer/src/data/queries.ts:237` 到 `apps/desktop/renderer/src/data/queries.ts:249`
- `apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts:101` 到 `apps/desktop/renderer/src/assistant/runtime/useOfficeRuntime.ts:105`

证据：`useMessages` 在真实 repos 存在时直接返回 `[]`，注释写明 chat messages 不是 persisted DB table；`useOfficeRuntime` 的 sent/assistant drafts 只在 React state 中维护。

行业对照：assistant UI runtime 和 AI SDK runtime 的主流路径通常都把 message state 当作 thread state 的核心，至少要有可恢复 transcript 或 event log。当前产品有 threads、resume、cost、activity，但普通用户直接聊天的消息不是一等记录。

修复意见：使用现有 conversations/agent_events/runtime_events 体系落 conversation turns，或新增最薄的 `chat_messages` repo。不要让 direct chat 只做 ephemeral UI draft。

### F-06：Run cost UI 读 `llm_calls`，但 direct provider bridge 不写 `llm_calls`

严重度：重要，影响成本显示和审计可信度。  
位置：
- `apps/desktop/renderer/src/data/queries.ts:330` 到 `apps/desktop/renderer/src/data/queries.ts:368`
- `packages/core/src/llm/recorded-call.ts:185` 到 `packages/core/src/llm/recorded-call.ts:260`
- `apps/desktop/renderer/src/lib/provider-bridge.ts:101` 到 `apps/desktop/renderer/src/lib/provider-bridge.ts:185`

证据：`loadRunCost` 汇总 `llm_calls` 和 `model_cost_rates`。core runtime 的 `recordedLlmCall`/`recordedLlmStream` 会写 `ctx.repos.llmCalls.create`，但 direct chat 的 provider bridge 没进入 core recorded path，也没看到等价写入。

行业对照：AI agent 产品的 cost/token 视图必须和真实 LLM 调用在同一个 instrumentation 边界。AI SDK 文档也把 stream usage/tool events 作为 runtime response 的结构化部分。

修复意见：direct chat 走 core recorded runtime；或者在 `sendProviderText` 调用边界补最小 `llm_calls` create，记录 provider/model/status/usage。若 provider response 无 usage，要明确标成 unknown，不要展示 live `$0.00`。

### F-07：`useDeliverables` 没有 companyId guard，和同文件其他 hooks 不一致

严重度：重要，属于实际 bug。  
位置：`apps/desktop/renderer/src/data/queries.ts:252` 到 `apps/desktop/renderer/src/data/queries.ts:267`

证据：query key 包含 `companyId`，但没有 `enabled: companyId !== null`；真实 repo 存在时直接 `repos.deliverables.listByCompany(companyId, { limit: 100 })`。同文件 `useEmployees`、`useProjects`、`useOfficeLayout` 都做了 `enabled` guard。

行业对照：TanStack Query dependent query 文档把 `enabled` 作为依赖数据 ready 前禁用 query 的标准做法。

修复意见：补 `enabled: companyId !== null`；queryFn 内再对 no-company 返回 `[]`。同时检查 invalidation key 是否和 company scoped key 对齐。

### F-08：Workspace suite 多数数据仍是 fixture seam，不是 release 真实功能

严重度：重要，影响“完整交付”判断。  
位置：`apps/desktop/renderer/src/surfaces/workspace/workspace-data.ts:736` 到 `apps/desktop/renderer/src/surfaces/workspace/workspace-data.ts:773`

证据：`useWsConversations`、`useWsThread`、`useWsSystemCards`、`useWsApprovals`、`useWsAgenda`、`useWsMeetings` 都直接 `resolveAsync(...)` fixture。GitNexus 显示这些 hooks 被 Workspace rail、Messenger、Contacts 真实使用。

行业对照：对 PM 来说，Workspace suite 已经有 Messenger/Approvals/Calendar/Meetings/Contacts/Workplace 入口，视觉完整度高，但业务真实度不足。高星 agent 产品通常让 approvals、runs、messages、files 都来自同一 runtime event/source，不把 prototype fixture 混入 release。

修复意见：把 Workspace suite 标为 preview-only，或接真实 runtime：conversations、agent events、permission gates、meeting subgraph、deliverables/files。没有真实源前，release 验收不能把这些 app 当完整业务功能。

### F-09：Market registry listing 当前会产生 N+1 网络请求

严重度：重要，影响 market 首屏和弱网体验。  
位置：`apps/desktop/renderer/src/surfaces/market/market-data.ts:1370` 到 `apps/desktop/renderer/src/surfaces/market/market-data.ts:1389`

证据：先 `searchListings({ per_page: 48 })`，再对每个 summary 调 `getListingDetail`，并可能继续 `getArtifactDownloadInfo`。48 条结果最多约 97 个请求，且由 renderer 聚合。

行业对照：marketplace/listing 页面常规把卡片所需字段包含在 search response，detail/download metadata 延迟到详情或安装动作。TanStack Query 能缓存，但不能消除首屏 N+1。

修复意见：platform search endpoint 返回卡片需要的 creator、rating、latest version、artifact availability summary；detail 页面再拉 full detail；install 触发时再取 download info。

### F-10：`save_deliverable_to_local` 写入边界检查落后于 `project_write_file`

严重度：中等，按“数据写到用户预期位置”而不是安全口径处理；不应压过对话、附件、历史、Workspace 真实度等易用性主线。  
位置：
- `apps/desktop/src-tauri/src/local_paths.rs:479` 到 `apps/desktop/src-tauri/src/local_paths.rs:507`
- 对照：`apps/desktop/src-tauri/src/builtin_tools.rs:535` 到 `apps/desktop/src-tauri/src/builtin_tools.rs:588`

证据：`save_deliverable_to_local` canonicalize `deliverables_dir` 后直接 `fs::write(destination, content)`，写完再 canonicalize destination 并 `ensure_inside`。`project_write_file` 已经实现了 canonical parent + `O_NOFOLLOW` leaf open，注释也说明 post-write check 只能事后发现。

行业对照：Tauri command 本地文件写入应优先走单一受控命令路径，尤其当前项目文档要求 Project workspace 文件浏览/读写走 `project_*` sandbox command。

修复意见：下次触碰本地导出/项目文件写入时，`save_deliverable_to_local` 复用 `project_write_file` 或共享 safe-write helper：create parent、canonical parent、ensure inside、open leaf with no-follow、write、返回相对路径。当前不是用户主流程的最高优先级。

### F-11：Tauri Drizzle proxy 仍有已知 transaction isolation 缺口

严重度：重要，尤其影响 install/materialize 这类跨 repo 写入。  
位置：`apps/desktop/renderer/src/lib/tauri-drizzle.ts:29` 到 `apps/desktop/renderer/src/lib/tauri-drizzle.ts:38`、`apps/desktop/renderer/src/lib/tauri-drizzle.ts:133` 到 `apps/desktop/renderer/src/lib/tauri-drizzle.ts:161`

证据：文件注释明确写了 residual：transaction await 中 concurrent standalone write 会被捕进 active queue；transaction 内 SELECT 看不到自己 queued writes；nested transaction 会 deadlock。

行业对照：Drizzle 官方 transaction API 的预期是 `tx` 对象承载 transaction context，并可用 savepoint 支持 nested transaction。当前 sqlite-proxy webview 方案是实用 workaround，但不能当作完整 transaction abstraction。

修复意见：把 install-core / repo 层迁到显式 `asyncTransact((tx) => ...)`，让 transaction repo 使用 tx-scoped backend；禁止在 transaction callback 里调用会触发 standalone writes 的服务。

### F-12：多个超大模块混合 view-model、IO、mutation、UI，降低理解成本

严重度：重要。  
位置：
- `apps/desktop/renderer/src/surfaces/market/market-data.ts`：1774 行
- `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx`：1060 行
- `apps/desktop/renderer/src/surfaces/studio/StudioSurface.tsx`：987 行
- `apps/desktop/renderer/src/surfaces/settings/settings-data.ts`：945 行
- `apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx`：911 行
- `apps/desktop/renderer/src/data/queries.ts`：759 行

证据：这些文件同时承担类型、fixture、remote client、repo mapping、query hook、mutation、UI state、渲染逻辑。对“零理解成本使用”的产品目标来说，代码理解成本已经偏高，后续改动更容易引入跨面 drift。

行业对照：React 19、TanStack Query、Zustand 本身不要求“小文件崇拜”，但高星项目通常按 feature boundary 拆 view-model、query/mutation、component shell、row/card/detail、adapter。React docs 也强调 memo/useCallback 是针对具体边界优化，而不是把巨大组件靠 hook 堆叠维持。

修复意见：
- `market-data.ts` 拆成 `registry-client-hooks`、`install-hooks`、`publish-hooks`、`fixture-vms`、`vm-mappers`。
- `MessengerApp.tsx` 拆 conversation list、thread runtime、message row、system facet、deliverable export。
- `StudioSurface.tsx` 拆 zone editor、object palette、placement controller、scene adapter。
- `queries.ts` 按 company/project/employee/office/git/cost/deliverables 分 domain。

### F-13：Platform search 对 `%` / `_` wildcard 不可预期，新品排序也不友好

严重度：次要到重要，取决于 market 规模。  
位置：`apps/platform/src/services/search.ts:42` 到 `apps/platform/src/services/search.ts:84`

证据：`const pattern = \`%${filters.q}%\`` 直接进入 `ilike`，用户输入 `%` 或 `_` 会被 SQL LIKE 当 wildcard。默认 relevance 是 `rating_avg * ln(install_count + 1)`，新品/零安装项会天然靠后，即使 title 精确匹配。

行业对照：market/search 常规会转义 LIKE wildcard 或切 full-text search；ranking 通常混合 textual match、recency、rating、install_count，而不是纯 social proof。

修复意见：短期 escape `%/_` 并加 exact/title prefix boost；中期上 PostgreSQL full-text 或 trigram index；默认排序加入 updated/newness floor。

### F-14：Rate limiter 是单进程内存桶，已写明不适合水平扩展

严重度：次要，当前单实例可以接受；二审确认它不属于易用性主线问题。  
位置：`apps/platform/src/middleware/rate-limit.ts:1` 到 `apps/platform/src/middleware/rate-limit.ts:6`

证据：注释已经写 `Sufficient for 1.0 - replace with Redis when horizontal scaling is needed`。实现上 Map store 只在当前 Node 进程内生效。

行业对照：Hono middleware 常规可以从内存起步；生产多实例通常用 Redis/KV/edge durable object 等共享 bucket。

修复意见：在 deploy checklist 里加 gate：如果 platform 多副本或 serverless 多实例，必须替换共享 rate-limit store；单实例阶段保持当前实现即可，不需要提前投入。

### F-15：MCP registry persist 直接 `fs::write`，崩溃时有配置文件损坏风险

严重度：次要，属于配置可靠性，不属于当前易用性主线。  
位置：`apps/desktop/src-tauri/src/mcp_bridge/registry_store.rs:279` 到 `apps/desktop/src-tauri/src/mcp_bridge/registry_store.rs:284`

证据：registry entries 序列化后直接写目标文件。`load_registry_entries` 对 malformed JSON 的处理是忽略整个 registry 并返回空 map。

行业对照：本地配置文件常规用 temp file + fsync + atomic rename，避免进程崩溃/断电写出半截 JSON。

修复意见：下次改 MCP registry 时再处理：写 `mcp-servers.json.tmp`，flush/fsync 后 rename；load malformed 时保留 `.bad.<timestamp>` 并向 Settings surface 展示恢复提示。

## 做得好的地方

- `apps/platform/src/app.ts` middleware 顺序符合 Hono API 常规，`app.onError` 集中处理错误，body/auth/rate/db 注入边界清楚。
- `apps/platform/src/lib/body-limit.ts` 不只信 `content-length`，还按实际 stream byte count enforce cap，和 Hono body-limit 思路一致。
- `apps/platform/src/services/validation.ts` 使用 canonical asset schema + platform-computed artifact hash，external URL 默认禁用，publish artifact 可信度高。
- `apps/platform/src/services/moderation.ts` 的 job claim pattern 是正确方向：guarded pending -> processing update，避免并发 worker 双处理。
- `apps/desktop/src-tauri/src/llm_transport.rs` 把 provider secret 留在 Rust，过滤 credential-shaped header、禁 redirect、限制 chunk/response byte，credential isolation 做得好。
- `apps/desktop/src-tauri/src/builtin_tools.rs` 的 `project_write_file` 已经有 canonical parent + no-follow leaf 写入模式，这应该成为本地写文件的标准 helper。
- `apps/desktop/src-tauri/src/git.rs` 的 subcommand allowlist 和 force/hard/amend/no-verify 阻断，符合“实用但不让用户误伤”的产品目标。
- `apps/desktop/renderer/src/app/providers/AppProviders.tsx` 的 React Query default options、Motion reducedMotion、Tooltip/Toaster provider 集中放置，框架一致性好。
- `apps/desktop/renderer/src/surfaces/activity/activity-data.ts` 的 runtime events 映射、filter、group、collapse 逻辑比较纯，后续易测试。
- `apps/desktop/renderer/src/surfaces/studio/StudioSurface.tsx` 虽然大，但 zone overlap validation、busy guard、confirm delete、drag cleanup 都是实用的产品级处理。

## 框架一致性检查

| 规则 | 结果 | 说明 |
| --- | --- | --- |
| Tauri v2 desktop only | 通过 | apps 只有 desktop/platform；renderer 在 desktop ownership 下。 |
| React 19 + Vite + Tauri renderer | 通过 | `apps/desktop/renderer/package.json` 使用 React 19、Vite、Tauri API。 |
| Tailwind v4 + shadcn/Radix local primitives | 基本通过 | primitives 在 `design-system/primitives`，业务多通过 grammar 使用。 |
| assistant-ui | 部分通过 | assistant-ui primitives/runtime 有使用；不是 `@assistant-ui/react-ai-sdk` runtime。 |
| Vercel AI SDK core | 不适用 / 新目标未通过 | 当前项目文档不要求普通 SDK lane；如果产品改成 SDK-native 目标，才算缺依赖和 runtime。 |
| Motion for React | 通过 | `motion/react` 在 provider 层使用，符合 stack。 |
| TanStack Query for async state | 基本通过 | 主流 query/mutation 已使用；`useDeliverables` 漏 enabled，workspace hooks 仍 fixture。 |
| Zustand for ephemeral UI | 通过 | `ui-state.ts` 和 market store 用于 UI state，不承担 server state。 |
| React Hook Form + Zod forms | 基本通过 | Personnel/Settings/MCP/Market publish 使用；个别小 dialog 仍是 local state，规模可接受。 |
| dnd-kit | 未发现使用 | 当前 drag/drop 是自实现；`Docs/UI_FRAMEWORK_STACK.md:56` 写未来 drag/drop 需先有 approved dependency decision。二审判断：不要为一致性而迁移；只有 drag/drop 要抽成共享框架能力或补键盘可达性时，再补架构记录或迁移。 |

## 代码关联重点

### Assistant / provider

```text
OfficeThread -> useOfficeRuntime -> sendRuntimeProviderMessage -> sendProviderText -> Tauri llm_fetch
MessengerApp -> sendWorkspaceProviderMessage -> sendProviderText -> Tauri llm_fetch
ProviderPane -> handleTestConnection -> sendProviderText -> Tauri llm_fetch
```

影响：任何 provider bridge 修复会同时影响 Office chat、Workspace chat、Settings test connection。建议先抽共享 runtime adapter，再改 transport/usage/attachments。

### Publish / moderation

```text
PublishDialog -> registry-client submitPublishDraft -> platform /v1/publish/submit
publish.ts submit route -> update draft submitted -> insert moderation job -> processModerationJob
processModerationJob -> validate artifact -> db transaction listing/package/tag/draft/job -> persist artifact -> stamp artifact_url
```

影响：submit route 的原子性问题在 platform；moderation service 内部 DB transaction + post-commit artifact compensation 相对完整。

### Workspace fixture seam

```text
WorkspaceSurface/AppRail -> useWsConversations
MessengerApp -> useWsConversations + useWsThread + local drafts
ContactsApp -> useWsConversations + useWsContactDetails
Approvals/Calendar/Meetings -> workspace-data fixtures
```

影响：Workspace app 的视觉完成度高于数据真实度。release 验收必须单独标记哪些是 real runtime，哪些还是 preview fixture。

## 修复优先级

1. 修 `publish.ts` submit transaction，避免 submitted draft 无 moderation job。
2. 拍板 AI runtime 产品口径：保持 Offisim custom runtime，或新增 SDK-native profile。不要同时用两套口径；当前不建议为了“框架纯度”迁移。
3. 抽 shared desktop assistant runtime adapter，合并 Office/Workspace provider send、abort、error、attachment、cost handling。
4. 让附件真正进入模型上下文，或明确禁用“模型已读附件”的 UI 暗示。
5. 让 direct chat transcript 和 llm cost 进入 runtime repo/event log。
6. 修 `useDeliverables` enabled guard。
7. 把 Workspace suite 从 fixture seam 接到真实 conversations/approvals/events，或在 release UI 中标为 preview。
8. 优化 market list API，消除 renderer 首屏 N+1。
9. 拆 `market-data.ts`、`MessengerApp.tsx`、`StudioSurface.tsx`、`settings-data.ts`、`PersonnelSurface.tsx`、`queries.ts`。
10. 修 search wildcard / 新品排序，让 Market 搜索更符合用户直觉。

安全/可靠性 deferred gate：`save_deliverable_to_local` safe write、rate-limit 共享 store、MCP registry atomic write 都成立，但不应挤占当前易用性主线；在触碰对应模块、做多实例部署或发布本地导出能力时再纳入 gate。

## 验收建议

这次没有改业务代码，所以不需要 release `.app` 交互验收。建议对本报告对应修复项建立后续 gate：

- platform 修复后跑：`pnpm --filter @offisim/platform typecheck`、`pnpm platform:auth-harness`、publish/registry harness。
- renderer/runtime 修复后跑：`pnpm --filter @offisim/desktop-renderer typecheck`、`pnpm --filter @offisim/desktop-renderer build`、`pnpm check:ui-hygiene`。
- desktop runtime 或 Tauri command 修复后跑：`pnpm --filter @offisim/desktop build`，再用当前 worktree release `.app` 做 Computer Use 真实交互。
- core runtime 修复后跑：`pnpm harness:deterministic`，必要时补 scenario，不在 `packages/core/src/**/*.test.mjs` 增 product 行为测试。

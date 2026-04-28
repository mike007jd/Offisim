## 1. Pre-flight baseline sampling

- [x] 1.1 `cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim && pnpm install`,确认 install 干净无 peer-dep 警告
- [x] 1.2 `pnpm typecheck` 必须 baseline 全绿 — 任何 pre-existing 红错先 STOP 修绿再开工
- [x] 1.3 `pnpm lint` baseline 必须无错;有 warning 也记下来 (post-RC 不能比 pre-RC 多 warning)
- [x] 1.4 `pnpm harness:contract && pnpm harness:replay` 必须 baseline 全绿
- [x] 1.5 `ls packages/db-local/src/migrations/` 拿真实下一个 migration 编号 (proposal 里写的 `0XX_kanban_cards` 占位 — 实际编号按这步结果)
- [x] 1.6 `grep -n "type RoleSlug\|RoleSlug =" packages/shared-types/src/**/*.ts` 找 RoleSlug union 真实位置,记入笔记
- [x] 1.7 `grep -rn "ConversationBudgetService\b\|prepareRequest" packages/core/src/services` 摸 budget-service 现有边界,确认 micro-compact / rolling-journal 不会被强行 inline 进 barrel
- [x] 1.8 `cat packages/core/src/agents/pm-planner-types.ts` 读 PlanStep 真实字段 (label / rationale / assigneeId / taskRunId 是否真名,实际不一致以这步为准)
- [x] 1.9 `grep -rn "loadLatest\|class CheckpointSaver" packages/core/src/graph/checkpoint-saver.ts` 确认 checkpoint-saver 现有 surface;若缺 `loadLatest` 在 Phase A.5 补
- [x] 1.10 `cat packages/core/src/runtime/hook-registry.ts` 读 HookEvent union 真实形状,记下要扩的 variant
- [x] 1.11 `cat packages/core/src/runtime/runtime-binding.ts` 找 RuntimeContext 注入点,Phase B / C 的 repos / coordinator 要在这里 wire
- [x] 1.12 `cat apps/platform/src/app.ts` 看现有路由挂载与 ctx.set 风格,Phase C 的 kanban / sessions / resume route 照同样模式挂
- [x] 1.13 `grep -rn "KanbanOverlay\b" apps/web/src packages/ui-office/src` 摸 KanbanOverlay 当前 props 形状 (现有 `requestText?` 等),Phase C 只增不改 props
- [x] 1.14 `cat packages/ui-office/src/components/kanban/KanbanOverlay.tsx` `KanbanBoard.tsx` `KanbanColumn.tsx` `KanbanCard.tsx` 通读一遍,记下哪些 props 可复用、哪些样式需要换
- [x] 1.15 把 1.5 / 1.8 / 1.13 / 1.14 的 baseline 观察用一段简短笔记记入 `/tmp/baseline-notes.md` (临时文件,不进 git);后续 task 偏离 plan 时回查

## 2. Phase A — long-running-runtime

### 2.1 micro-compact tool-result truncator

- [x] 2.1.1 新建 `packages/core/src/services/conversation-budget/micro-compact.ts`,导出 `microCompactMessages(messages, opts): MicroCompactResult` 纯函数。签名:
  - `opts.maxToolResultBytes: number` (默认 8000)
  - `opts.snippetBytes: number` (默认 400)
  - `opts.preserveLastN?: number` (默认 1 — 保护最近 N 个 tool result 不裁)
  - return `{ messages, compacted, bytesSaved }`
- [x] 2.1.2 实现:遍历 messages,对每条 `role === 'tool'` 的 message,若 `content.length > maxToolResultBytes` 且不在 `preserveLastN` 范围内,替换为 `head + '\n\n[microcompacted ${origBytes} bytes]\n\n' + tail` (head = `slice(0, snippetBytes)`,tail = `slice(-snippetBytes)`)
- [x] 2.1.3 新建 `packages/core/src/services/conversation-budget/micro-compact.test.mjs` (`node --test` 风格),3 个 case:
  - case A: 大 tool result 被替换,marker 含 origBytes
  - case B: 小 tool result 不变
  - case C:`preserveLastN: 1` 时最近 1 个 tool 不裁
- [x] 2.1.4 `node --test packages/core/src/services/conversation-budget/micro-compact.test.mjs` 全绿
- [x] 2.1.5 把 micro-compact 接进 `ConversationBudgetService.prepareRequest`:在现有 full-compact orchestrator 之前加 micro-compact pass。**不要 inline 实现进 barrel** — 调用 sibling 函数,匹配 `conversation-budget-service-boundaries` 的 ≤180 NBNC 不变量
- [x] 2.1.6 `pnpm typecheck && pnpm lint` 全绿
- [x] 2.1.7 简化审查 (按 design.md 列的 8 条 checklist 走);commit
- [x] 2.1.8 `git commit -m "feat(core): add micro-compact tool-result truncator and wire into budget service"`

### 2.2 rolling journal with anchor user objective

- [x] 2.2.1 新建 `packages/core/src/services/conversation-budget/rolling-journal.ts`,导出 `RollingJournal` 类:
  - `constructor(opts: { everyNTurns: number; write: (text: string) => Promise<void>; summarize: (msgs) => Promise<string> })`
  - `async observeTurn(messages: readonly LlmMessage[]): Promise<void>` — 第一次调用时锁定 anchor (找第一条 `role === 'user'` 的 content);每 `everyNTurns` 触发一次 `summarize → write`
  - `anchorText(): string | null`
  - `currentTurn(): number`
- [x] 2.2.2 新建 `packages/core/src/services/conversation-budget/rolling-journal.test.mjs`,3 个 case:
  - case A: 第 5、10 turn 触发 write,write 收到 summarize output
  - case B: anchor 锁定后不变(后续 user message 不覆盖)
  - case C: anchor 在 first observeTurn 后即可读
- [x] 2.2.3 `node --test ...rolling-journal.test.mjs` 全绿
- [x] 2.2.4 在 `packages/core/src/runtime/runtime-binding.ts` 构造 `RollingJournal` 实例,挂到 `RuntimeContext.runtime.rollingJournal`,`summarize` delegate 到现有 `synopsis-generator.ts`,`write` delegate 到 `repos/orchestration` 持久化为 `ThreadSynopsisRecord` (event `conversation.synopsis.updated` 已有)
- [x] 2.2.5 在 `packages/core/src/agents/employee-turn-runner.ts` 每 turn 结束处调 `await ctx.runtime.rollingJournal?.observeTurn(state.messages)`
- [x] 2.2.6 anchor 在 prompt 注入:`packages/core/src/agents/employee-prompt-assembly.ts` 在 system prompt 之后 prepend 一条 `role: 'system'` 的 anchor pin,`content: '<anchor>${rollingJournal.anchorText()}</anchor>'`,确保它不会被 micro-compact 裁
- [x] 2.2.7 `pnpm typecheck && pnpm lint` 全绿;简化审查;commit
- [x] 2.2.8 `git commit -m "feat(core): rolling journal with stable anchor user objective"`

### 2.3 forkSubContext primitive

- [x] 2.3.1 新建 `packages/core/src/a2a/fork-sub-context.ts`,导出 `forkSubContext(input): Promise<ForkSubContextResult>`。签名:
  - `input.subTask: string`
  - `input.runChild: (childMessages) => Promise<{ summary: string; transcript: LlmMessage[] }>`
  - return `{ summary: string; childTokensUsed?: number }` — **不暴露 transcript**
- [x] 2.3.2 实现:构造 `childMessages = [{ role: 'user', content: subTask }]`,调 `runChild(childMessages)`,return `{ summary: child.summary }`。`transcript` 只用于内部 debug log,不回吐 parent。
- [x] 2.3.3 新建 `fork-sub-context.test.mjs`,2 个 case:
  - case A: parent transcript 不被污染 (child runner 收到的 msg list 长度 = 1)
  - case B: result 只含 summary,无 transcript 字段
- [x] 2.3.4 `node --test` 全绿
- [x] 2.3.5 在 `packages/core/src/a2a/a2a-client.ts` 加 `async fork(peer: A2APeer, subTask: string): Promise<ForkSubContextResult>` 方法,内部调 `forkSubContext`,`runChild` = 调 a2a `sendMessage` 并 join 最终 agent message 的 text parts 作为 summary
- [x] 2.3.6 `pnpm typecheck && pnpm lint` 全绿;简化审查;commit
- [x] 2.3.7 `git commit -m "feat(a2a): forkSubContext primitive for true subagent isolation"`

### 2.4 completion-verifier hook

- [x] 2.4.1 在 `packages/core/src/runtime/hook-registry.ts` 扩 `HookEvent` union,加 `'task.completion.verifying'`
- [x] 2.4.2 在同文件 export `interface TaskCompletionVerifyingPayload`:
  - `taskRunId: string`
  - `employeeId: string`
  - `recentToolResults: ReadonlyArray<{ toolName: string; success: boolean; bytes: number }>`
  - `allow: () => void`
  - `block: (reason: string) => void`
- [x] 2.4.3 新建 `packages/core/src/runtime/completion-verifier.ts`,导出 `verifyCompletion(input, opts): VerifyOutcome`:
  - `opts.evidenceTools: readonly string[]` (默认 `['pnpm-test', 'pnpm-typecheck', 'pnpm-lint', 'harness-contract']`)
  - `opts.windowSize: number` (默认 12)
  - return `{ ok: true } | { ok: false; reason: string }`
- [x] 2.4.4 新建 `completion-verifier.test.mjs`,3 个 case:
  - case A: 无 evidence tool 调用 → blocked
  - case B: pnpm-test success 在 window 内 → allowed
  - case C: pnpm-test failed → blocked
- [x] 2.4.5 `node --test` 全绿
- [x] 2.4.6 在 `packages/core/src/agents/employee-completion.ts` 找到转 `done` 的代码点,在 emit `taskStateChanged({ next: 'completed' })` 之前 emit `task.completion.verifying` hook,默认 hook 跑 `verifyCompletion`,无 evidence 则 `nextState = 'review'` + appendAgentEvent `{ kind: 'completion-blocked', reason }`
- [x] 2.4.7 在 `packages/core/src/agents/employee-tool-round.ts` 每次 tool 调用结束后,把 `{ toolName, success, bytes }` push 到 `state.recentToolResults` (新加 field 到 `OffisimGraphState`,环形 buffer 保留最近 32 条)
- [x] 2.4.8 `packages/core/src/graph/state.ts` 加 `recentToolResults?: ReadonlyArray<{ toolName: string; success: boolean; bytes: number }>` 字段
- [x] 2.4.9 `pnpm typecheck && pnpm lint && pnpm harness:contract` 全绿;简化审查;commit
- [x] 2.4.10 `git commit -m "feat(runtime): require verification evidence before task.completed transition"`

### 2.5 ResumeCoordinator + platform / Tauri resume route

- [x] 2.5.1 新建 `packages/core/src/runtime/resume-coordinator.ts`,导出 `ResumeCoordinator` 类:
  - `constructor(saver: CheckpointSaver)`
  - `async resume(conversationId: string): Promise<{ state: OffisimGraphState; lastCheckpointTs: number } | null>` — 调 `saver.loadLatest`,无则 null
- [x] 2.5.2 若 `CheckpointSaver` 当前没 `loadLatest`,在 `packages/core/src/graph/checkpoint-saver.ts` 加该方法,签名 `loadLatest(conversationId: string): Promise<{ state: OffisimGraphState; lastCheckpointTs: number } | null>`
- [x] 2.5.3 新建 `resume-coordinator.test.mjs`,2 个 case:null / 命中
- [x] 2.5.4 `node --test` 全绿
- [x] 2.5.5 在 `packages/core/src/runtime/runtime-binding.ts` 实例化 `ResumeCoordinator`,挂到 RuntimeContext
- [x] 2.5.6 新建 `apps/platform/src/routes/resume.ts`,实现 `GET /api/conversations/:id/resume` SSE 端点 — 拉 latest checkpoint,first SSE event = `resume.snapshot`,然后 hand off 到现有 stream pump (找 `apps/platform/src/app.ts` 现有 SSE pump 注册点)
- [x] 2.5.7 在 `apps/platform/src/app.ts` 挂载该 route
- [x] 2.5.8 `apps/desktop/src-tauri/src/` 加对应 Tauri command `resume_conversation(id)`,返回 latest checkpoint snapshot;不需要 SSE (Tauri 直接 emit event)
- [x] 2.5.9 在 `apps/web/src/runtime/` 已有 `last-failed-message.ts` — 加 `useResumeOnReconnect()` hook,visibilitychange 或 SSE error 时调 `/api/conversations/:id/resume`,把 snapshot 注回 store
- [x] 2.5.10 `pnpm typecheck && pnpm lint && pnpm --filter @offisim/platform build` 全绿;简化审查;commit
- [x] 2.5.11 `git commit -m "feat(runtime): production ResumeCoordinator with platform + Tauri resume route"`

### 2.6 Phase A harness scenario + checkpoint tag

- [x] 2.6.1 新建 `packages/core/harness/scenarios/long-running-microcompact-triggers.json` — fixture 长 messages array,含 3 个 100KB tool result;invariant: micro-compact pass 后 final non-system tokens ≤ 80k 且 marker 出现 3 次;`manifest.json` 加 entry
- [x] 2.6.2 新建 `packages/core/harness/scenarios/completion-verifier-blocks-without-evidence.json` — invariant: employee-completion 在缺 evidence 时落 `review` 而非 `completed`,且 emit `completion-blocked` event
- [x] 2.6.3 `pnpm harness:contract && pnpm harness:replay` 全绿
- [x] 2.6.4 `pnpm typecheck && pnpm lint` 全绿
- [x] 2.6.5 `git tag -a phase-a-long-running-runtime -m "Phase A: micro-compact, rolling journal, fork-sub-context, completion verifier, resume coordinator"`

## 3. Phase B — interaction-modes

### 3.1 InteractionMode union 扩到 4 值

- [x] 3.1.1 `packages/shared-types/src/interactions.ts` 把 `InteractionMode` 改成 `'boss_proxy' | 'human_in_loop' | 'direct_to_employee' | 'yolo'`
- [x] 3.1.2 同文件加常量 export:
  - `INTERACTION_MODE_LABEL: Record<InteractionMode, string>` (`SOP` / `Human-in-loop` / `Direct` / `YOLO`)
  - `INTERACTION_MODE_DESCRIPTION: Record<InteractionMode, string>`
  - `DEFAULT_INTERACTION_MODE: InteractionMode = 'boss_proxy'`
- [x] 3.1.3 `packages/shared-types/src/index.ts` 确保 re-export 新常量
- [x] 3.1.4 `apps/web/src/runtime/interaction-mode-storage.ts` `loadDefaultInteractionMode` 升级 — `raw` 必须在 4 值 union 内才接受,否则 fallback `'boss_proxy'`;test 4 path
- [x] 3.1.5 新建 `packages/shared-types/src/interactions.test.mjs`,scenario:`DEFAULT === 'boss_proxy'`、`Object.keys(LABEL).length === 4`、`LABEL` 4 项齐
- [x] 3.1.6 `node --test packages/shared-types/src/interactions.test.mjs` 全绿
- [x] 3.1.7 `pnpm typecheck` 全绿 — 任何 union 不匹配的回归在这步暴露,逐个修
- [x] 3.1.8 简化审查;commit `feat(shared-types): expand InteractionMode union to 4 values`

### 3.2 main-graph mode-aware entry router

- [x] 3.2.1 `packages/core/src/graph/state.ts` 加 `interactionMode: InteractionMode` field 到 `OffisimGraphState`,默认 `'boss_proxy'`
- [x] 3.2.2 `packages/core/src/graph/main-graph.ts` 加 `function modeRouter(state): 'boss' | 'pm-planner' | 'yolo-master'` (导出供 test 用):
  - `boss_proxy` / `human_in_loop` → `'boss'`
  - `direct_to_employee` → `'pm-planner'`
  - `yolo` → `'yolo-master'`
- [x] 3.2.3 替换现有 `addEdge(START, 'boss')` 为 `addConditionalEdges(START, modeRouter, { boss: 'boss', 'pm-planner': 'pm-planner', 'yolo-master': 'yolo-master' })`
- [x] 3.2.4 新建 `packages/core/src/graph/main-graph.test.mjs`,scenario:4 mode 各路由到正确节点 (4 path)
- [x] 3.2.5 `node --test` 全绿
- [x] 3.2.6 注意:`yolo-master` 节点在 Task 3.4 才注册,在 Task 3.4 完成前 `pnpm typecheck` 会红 — 容忍,Task 3.4 完成后跑 typecheck
- [x] 3.2.7 `git commit -m "feat(graph): mode-aware entry router for InteractionMode"`

### 3.3 YOLO Master persona + role-slug

- [x] 3.3.1 在 1.6 步找到的 RoleSlug union 文件,union 加 `'yolo_master'`
- [x] 3.3.2 新建 `packages/core/src/agents/yolo-master-persona.ts`,export `YOLO_MASTER_ROLE_SLUG = 'yolo_master' as const` + `YOLO_MASTER_EMPLOYEE: CompanyTemplateEmployee`,persona_json:
  - `expertise`: 自主全栈工程师,适合长程开发任务,TDD 优先,完成前必跑 verification 命令
  - `style`: 直接、简短、行动导向,无 boss/manager 仪式,优先 fork 子上下文
  - `characterConfig`: skinColor `0x9ca3af`、hairColor `0x111827`、hairStyle `'short'`、clothingColor `0x111827`、clothingAccent `0x10b981` (kelp-green,呼应海洋赛博风格)、bodyType `'normal'`、gender `'neutral'`
  - `config_json`:`temperature 0.3`、`maxTokens 8192`
- [x] 3.3.3 `pnpm typecheck` 全绿;commit `feat(agents): YOLO Master persona and role slug`

### 3.4 yolo-master-node graph node

- [x] 3.4.1 新建 `packages/core/src/agents/yolo-master-node.ts`,export `async function yoloMasterNode(state, ctx): Promise<Partial<OffisimGraphState>>`:
  - 调 `ctx.runtime.repos.employees.findByRoleSlug('yolo_master', state.activeCompanyId)`,无则 throw `'YOLO Master employee not found in this company. Ensure templates seed it via ensureYoloMasterForActiveCompanies.'`
  - 复用 `runEmployeeTurn({ state: { ...state, currentEmployeeId: yolo.employee_id }, ctx, options: { skipPlannerHandoff: true, enableSubagentFork: true, enableTodoTool: true } })`
- [x] 3.4.2 在 `main-graph.ts` 注册节点 + edge:`graph.addNode('yolo-master', yoloMasterNode)`,`graph.addEdge('yolo-master', END)`
- [x] 3.4.3 新建 `yolo-master-node.test.mjs`,scenario:无 YOLO 大师时 throw 明确错误
- [x] 3.4.4 `node --test && pnpm typecheck` 全绿;简化审查;commit `feat(agents): YOLO Master node with single-agent harness loop`

### 3.5 Seed YOLO Master into 5 company templates

- [x] 3.5.1 在 `packages/core/src/templates/agency-lite.ts` 末尾 `employees` array append `YOLO_MASTER_EMPLOYEE`
- [x] 3.5.2 同操作 `ai-startup.ts`、`content-studio.ts`、`product-team.ts`、`rd-company.ts`
- [x] 3.5.3 新建 `packages/core/src/templates/templates.test.mjs`,scenario: `listTemplates().every(t => t.employees.find(e => e.role_slug === 'yolo_master'))`
- [x] 3.5.4 `node --test` 全绿;commit `feat(templates): seed YOLO Master in all 5 company templates`

### 3.6 Idempotent ensure for existing companies

- [x] 3.6.1 新建 `packages/core/src/runtime/ensure-yolo-master.ts`,export `async function ensureYoloMasterForActiveCompanies(repos): Promise<void>`:遍历所有 active company,每个 `repos.employees.findByRoleSlug('yolo_master', companyId)` — 缺则 insert 新 employee 行,persona_json / config_json 来自 `YOLO_MASTER_EMPLOYEE`,生成新 `employee_id`(uuid),`is_external = 0`
- [x] 3.6.2 在 `apps/platform/src/startup.ts` 启动 hook 内调一次
- [x] 3.6.3 `apps/desktop/src-tauri/src/main.rs` (或对应初始化点) 调一次
- [x] 3.6.4 新建 `ensure-yolo-master.test.mjs`,scenario:第二次调用是 no-op (idempotent)
- [x] 3.6.5 `node --test` 全绿;commit `feat(runtime): idempotent ensure YOLO Master for existing companies`

### 3.7 todo_* tools (依赖 Phase C 的 KanbanRepo,执行顺序见下)

> **执行顺序提示:** 这一段必须在 Task 5.2 (KanbanRepo) 之后做。Task 3.7.x 暂时跳过,先做完 Phase C 的 5.1 和 5.2,再回头做 3.7。

- [x] 3.7.1 在 `packages/core/src/agents/employee-tool-kit.ts` append `todoCreateTool` / `todoUpdateTool` / `todoListTool`,调 `ctx.runtime.repos.kanban.create` / `transition` / `listByEmployee`
- [x] 3.7.2 工具只在 `state.interactionMode in ('direct_to_employee', 'yolo')` 时注册到 employee turn — `boss_proxy` / `human_in_loop` 模式下 plan 由 pm-planner 出,employee 不自管 TODO
- [x] 3.7.3 新建 `employee-tool-kit.test.mjs`,scenario:
  - case A: yolo 模式下 employee 看到 todo_* 三个工具
  - case B: boss_proxy 模式下 employee 看不到 todo_* 工具
- [x] 3.7.4 `node --test` 全绿
- [x] 3.7.5 简化审查;commit `feat(agents): todo_* tools for direct/yolo mode self-planning`

### 3.8 Platform `/sessions/:id/mode` route + Tauri command

- [x] 3.8.1 新建 `apps/platform/src/routes/sessions.ts`:
  - `PATCH /api/sessions/:id/mode` — body zod `{ mode: 4-value-enum }`,update meeting_sessions row (column `interaction_mode`,Phase B.9 加),return `{ ok: true, mode }`
  - `GET /api/sessions/:id` — return current session row 含 mode
- [x] 3.8.2 在 `apps/platform/src/app.ts` 挂载
- [x] 3.8.3 `apps/desktop/src-tauri/src/` 加 Tauri command `set_session_mode(id, mode)` + `get_session(id)`
- [x] 3.8.4 commit `feat(platform): /sessions/:id/mode route + Tauri command`

### 3.9 Persist interactionMode on meeting_sessions

- [x] 3.9.1 在 1.5 步拿到的 next migration number 之后再 +1,新建 `packages/db-local/src/migrations/0YY_session_interaction_mode.sql`:
  ```sql
  ALTER TABLE meeting_sessions ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy';
  CREATE INDEX idx_meeting_sessions_mode ON meeting_sessions(interaction_mode);
  ```
- [x] 3.9.2 在 `packages/db-local/src/schema.ts` 找 `meetingSessions` 定义,加 `interaction_mode: text('interaction_mode').notNull().default('boss_proxy')`
- [x] 3.9.3 跑 db-local migration (按仓库现有 migration 工具) — 若没有 migrate script,在 `packages/db-local/src/index.ts` 加一段启动时 idempotent ALTER TABLE 检查
- [x] 3.9.4 commit `feat(db-local): persist interaction_mode on meeting_sessions`

### 3.10 SessionModeSwitcher UI

- [x] 3.10.1 新建 `apps/web/src/components/session-mode/SessionModeBadge.tsx`,展示当前 mode + 海洋色 (`boss_proxy`=foam、`human_in_loop`=coral-orange、`direct_to_employee`=sea-blue、`yolo`=kelp-green)
- [x] 3.10.2 新建 `apps/web/src/components/session-mode/SessionModeSwitcher.tsx`,接 `current` + `onChange(mode)`,popover 列 4 项 (label + description),用 `.cyber-button` 风格
- [x] 3.10.3 `apps/web/src/components/app-shell/AppMainShell.tsx` header 加 `<SessionModeSwitcher>` slot,接 `activeConversationId` (从现有 store 取) + 调 `PATCH /api/sessions/:id/mode` (web) 或 Tauri command (desktop)
- [x] 3.10.4 commit `feat(web): SessionModeSwitcher in main shell header`

### 3.11 Phase B harness scenario + checkpoint tag

- [x] 3.11.1 新建 `packages/core/harness/scenarios/yolo-mode-skips-boss-chain.json` — fixture conversation interactionMode='yolo',invariant:trace 中第一个执行节点是 `yolo-master` 而非 `boss`
- [x] 3.11.2 新建 `packages/core/harness/scenarios/direct-mode-skips-boss-chain.json` — interactionMode='direct_to_employee',invariant:trace 中第一个执行节点是 `pm-planner` 而非 `boss`
- [x] 3.11.3 `pnpm harness:contract && pnpm harness:replay` 全绿
- [x] 3.11.4 `git tag -a phase-b-interaction-modes -m "Phase B: 4-value InteractionMode + YOLO Master + mode-aware graph router"`

## 4. (Pause Phase B,Pivot to Phase C 5.1 + 5.2)

> 见 Task 3.7 头部的"执行顺序提示"。

## 5. Phase C — kanban-data-pipeline

### 5.1 kanban_cards table + migration

- [x] 5.1.1 在 1.5 步拿到的 next migration number,新建 `packages/db-local/src/migrations/0XX_kanban_cards.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS kanban_cards (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'todo',
    origin TEXT NOT NULL,
    created_by_employee_id TEXT,
    assigned_employee_id TEXT,
    parent_card_id TEXT,
    blocked_reason TEXT,
    task_run_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_kanban_project_state ON kanban_cards(project_id, state);
  CREATE INDEX IF NOT EXISTS idx_kanban_assignee ON kanban_cards(assigned_employee_id, state);
  CREATE INDEX IF NOT EXISTS idx_kanban_task_run ON kanban_cards(task_run_id);
  ```
- [x] 5.1.2 `packages/db-local/src/schema.ts` 加 `kanbanCards` table 定义,`state` enum / `origin` enum 通过 `text(...)` + 约束在应用层(SQLite 不支持 enum)
- [x] 5.1.3 跑 db-local migration 验证不破坏现有 company / project
- [x] 5.1.4 commit `feat(db-local): kanban_cards table with project FK and state machine`

### 5.2 KanbanRepo + RuntimeContext wiring

- [x] 5.2.1 新建 `packages/core/src/runtime/repos/kanban-repo.ts`,export `class KanbanRepo`:
  - `constructor(db, eventBus?)`
  - `async create(input): Promise<KanbanCardRow>` — emit `{ kind: 'kanban', op: 'created', card }`
  - `async transition(id, next, blockedReason?): Promise<KanbanCardRow | null>` — emit `{ kind: 'kanban', op: 'transitioned', card }`
  - `async transitionByTaskRun(taskRunId, next, blockedReason?): Promise<void>` — for employee-completion
  - `async listByProject(projectId): Promise<KanbanCardRow[]>`
  - `async listByEmployee(employeeId, state?): Promise<KanbanCardRow[]>`
  - `async assign(id, employeeId): Promise<void>`
- [x] 5.2.2 在 `packages/core/src/runtime/repositories.ts` 注入,`RuntimeContext.runtime.repos.kanban = new KanbanRepo(db, eventBus)`
- [x] 5.2.3 新建 `kanban-repo.test.mjs`,scenario:create / transition / listByProject / blockedReason 持久 / event 发布
- [x] 5.2.4 `node --test && pnpm typecheck && pnpm lint` 全绿
- [x] 5.2.5 commit `feat(core): KanbanRepo with state machine and event emission`

> **回到 Phase B Task 3.7 (todo_* tools)** — 现在 KanbanRepo 已可用,做完 3.7 全部子项再回来继续 Phase C 5.3。

### 5.3 pm-planner-node writes cards on plan

- [x] 5.3.1 `packages/core/src/agents/pm-planner-node.ts` 在 plan finalised 之后(具体 hook 点见 1.8 步读到的代码),loop plan steps,每个 step 调 `ctx.runtime.repos.kanban.create({ projectId, companyId, conversationId, title: step.label, note: step.rationale, origin: 'pm-planner', assignedEmployeeId: step.assigneeId, taskRunId: step.taskRunId, state: 'todo' })`
- [x] 5.3.2 新建 `pm-planner-kanban.test.mjs` (用现有 fake-gateway + scenario-runner),scenario:plan 含 3 step → kanban 表插入 3 行,origin='pm-planner'
- [x] 5.3.3 `node --test && pnpm harness:contract` 全绿
- [x] 5.3.4 commit `feat(planner): persist plan steps as kanban cards`

### 5.4 employee-completion updates card on transition

- [x] 5.4.1 `packages/core/src/agents/employee-completion.ts` 在 verifier 决定 nextState 之后,若 `state.currentTaskRunId` 存在,调 `ctx.runtime.repos.kanban.transitionByTaskRun(taskRunId, nextState === 'completed' ? 'done' : 'review', verdict.reason)`
- [x] 5.4.2 在 `kanban-repo.test.mjs` 加 case: `transitionByTaskRun` 找到对应 card 并改状态
- [x] 5.4.3 commit `feat(kanban): employee completion transitions card to done|review`

### 5.5 Platform / Tauri kanban CRUD + SSE

- [x] 5.5.1 新建 `apps/platform/src/routes/kanban.ts`:
  - `GET /api/projects/:projectId/kanban` — return `{ cards: KanbanCardRow[] }`
  - `POST /api/projects/:projectId/kanban` — body zod (title / note / origin / assignedEmployeeId),return `{ card }`
  - `PATCH /api/kanban/:id` — body zod (state / blockedReason),return `{ card }`
  - `GET /api/projects/:projectId/kanban/stream` — SSE,subscribe eventBus,filter `kind === 'kanban' && card.projectId === param`
  - `GET /api/employees/:employeeId/kanban-count` — return `{ count }` 用于员工头顶徽标
- [x] 5.5.2 在 `apps/platform/src/app.ts` 挂载
- [x] 5.5.3 `apps/desktop/src-tauri/src/` 加 Tauri command:`list_kanban_cards(projectId)` / `create_kanban_card(input)` / `transition_kanban_card(id, next, reason?)` / `count_kanban_for_employee(employeeId)`;Tauri event channel `kanban://updates/:projectId` 替代 SSE
- [x] 5.5.4 smoke test:`pnpm dev:all`,curl `POST /api/projects/<id>/kanban` 创建一张卡,`GET` 看到,`PATCH` 改 state,SSE 收到 update 事件
- [x] 5.5.5 commit `feat(platform): kanban CRUD + SSE + employee count`

### 5.6 useKanbanStream hook (web + desktop)

- [x] 5.6.1 新建 `apps/web/src/runtime/useKanbanStream.ts`:
  - `useKanbanStream(projectId): { cards: KanbanCard[]; move(id, next): Promise<void>; create(input): Promise<void> }`
  - 初始 `fetch('/api/projects/:id/kanban')`,然后 `EventSource('/api/projects/:id/kanban/stream')` 增量更新
  - hook 内部用 reducer 维护 cards array
- [x] 5.6.2 desktop 等价 hook 在 `apps/desktop/src-tauri-binding/` (或现有 binding 位置) 用 `invoke()` + `listen('kanban://updates/:projectId')`,API 形状与 web 一致
- [x] 5.6.3 `apps/web/src/components/workspaces/kanban/types.ts` (新建) 导出 `KanbanCard` type,从 shared-types 或本地定义
- [x] 5.6.4 commit `feat(web,desktop): useKanbanStream hook`

### 5.7 KanbanOverlay 接数据 + 视觉对齐海洋赛博风

- [ ] 5.7.1 `packages/ui-office/src/components/kanban/KanbanOverlay.tsx` props 加(只增不改):
  - `cards?: KanbanCard[]` (旧 caller 不传时 fallback 到 stub,保持向后兼容)
  - `onMove?: (id: string, next: KanbanState) => Promise<void>`
  - `onCreate?: (input: { title: string; note?: string }) => Promise<void>`
- [ ] 5.7.2 `KanbanBoard.tsx` 接 `cards` + `onMove` + `onCreate`,5 列布局 (todo / doing / blocked / review / done)
- [ ] 5.7.3 视觉对齐:
  - overlay container 用 `.glass-panel` + bottom-corners-only border-radius;height 65%,from top(below nav)
  - top seam: 2px linear-gradient `var(--color-sea-blue) → var(--color-kelp-green) → var(--color-sea-blue)` + box-shadow 蓝光晕
  - close button: `.cyber-button`,小变体
  - column header: `text-[color:var(--color-text-primary)]`,column body: `var(--color-glass-bg)` 透明
  - card: `.glass-panel-sm`,origin pill 颜色:
    - `pm-planner` → `var(--color-sea-blue)`
    - `employee` → `var(--color-kelp-green)`
    - `manager` → `var(--color-coral-orange)`
    - `human` → `var(--color-foam)`
  - blocked banner: `var(--color-warning)` + 表情符号 ⛔
  - 间距全部用 `--sp-*` token (`p-sp-lg`、`gap-sp-md` 等),禁用 raw `p-3` / `gap-2`
- [ ] 5.7.4 `apps/web/src/components/app-shell/AppOverlayHost.tsx` 当前已 lazy load `KanbanOverlay`,改成接 `useKanbanStream(activeProjectId)` 的 cards / onMove / onCreate
- [ ] 5.7.5 desktop 同样改在对应 overlay host
- [ ] 5.7.6 简化审查;commit `feat(ui-office): KanbanOverlay accepts cards/onMove/onCreate; visual alignment to ocean cyber DNA`

### 5.8 OfficeSceneSurface paused prop 性能保护

- [ ] 5.8.1 `apps/web/src/components/office-shell/OfficeSceneSurface.tsx` 加 `paused?: boolean` prop
- [ ] 5.8.2 在 SceneCanvas 渲染处,若 `paused === true`,SceneCanvas 收到 `active={false}` 或调 `setTargetFps(12)` (取决于 `@offisim/ui-office/scene` 真实 surface,见 1.14 笔记);若两者都没,`paused` 暂时 no-op,加 TODO comment
- [ ] 5.8.3 `AppMainShell.tsx` 把 `kanbanOpen` 透传到 `OfficeSceneSurface paused={kanbanOpen}`
- [ ] 5.8.4 commit `perf(scene): pause/throttle 3D scene while kanban overlay open`

### 5.9 Employee 头顶 cards-in-progress 徽标

- [ ] 5.9.1 新建 `apps/web/src/components/office-shell/EmployeeBadgeOverlay.tsx`,接 `employeeId`,内部 fetch `/api/employees/:id/kanban-count` (web) / Tauri command (desktop),count > 0 时渲染圆形徽章 (kelp-green 背景,white text)
- [ ] 5.9.2 `OfficeSceneSurface.tsx` 在每个员工 3D label 渲染处挂 `<EmployeeBadgeOverlay employeeId={...} />`
- [ ] 5.9.3 commit `feat(web): per-employee kanban-count badge in office`

### 5.10 Phase C harness scenario + checkpoint tag

- [ ] 5.10.1 新建 `packages/core/harness/scenarios/kanban-card-state-transitions.json` — invariant:`pm-planner` 写 5 张卡,employee 完成 3 张,余下 2 张依然 `todo`;event sequence 按时序匹配
- [ ] 5.10.2 `pnpm harness:contract && pnpm harness:replay` 全绿
- [ ] 5.10.3 `git tag -a phase-c-kanban-data-pipeline -m "Phase C: kanban_cards table, repo, planner/employee writes, KanbanOverlay live"`

## 6. Phase D — Integration / RC / Live runtime closure

### 6.1 80-turn YOLO soak

- [ ] 6.1.1 新建 `packages/core/harness/scenarios/yolo-80-turn-multi-file-refactor.json` — 80 turn fixture,multi-file refactor 任务,fake/replay LLM gateway
- [ ] 6.1.2 `pnpm harness:soak` 跑此 scenario
- [ ] 6.1.3 invariant:
  - `result.outcome === 'completed'`
  - final non-system tokens < 120k
  - micro-compact pass count >= 3
  - rolling-journal write count >= 9 (every 8 turns × 80 turns ≈ 10)
  - completion-verifier triggered at least once with allow,zero block-final-state(任务最终走 done)
- [ ] 6.1.4 commit `test(harness): 80-turn YOLO soak scenario`

### 6.2 Cross-mode × kanban matrix

- [ ] 6.2.1 新建 `packages/core/harness/scenarios/mode-kanban-matrix.json` — 3 mode × "build a counter component" task,invariant:每种 mode 都至少创建 1 张卡且最终至少 1 张 `done`
- [ ] 6.2.2 `pnpm harness:contract && pnpm harness:replay` 全绿
- [ ] 6.2.3 commit `test(harness): cross-mode × kanban matrix scenario`

### 6.3 Product live runtime closure (web 浏览器)

每项必须用 `pnpm dev` + 真实浏览器手测,不依赖任何自动化测试。观察符合预期才打勾。

- [ ] 6.3.1 全新 install:`rm -rf node_modules dist && pnpm install && pnpm dev` 启动干净,无 console 错误
- [ ] 6.3.2 创建新 company (用 ai-startup template),company 创建后 employee 列表中可见 YOLO Master 头像 (机械风,kelp-green clothing accent)
- [ ] 6.3.3 切到 SOP (boss_proxy) 模式,提"build a counter component with tests",观察 boss → manager → planner → employee 链路全走完;kanban (⌘J) 打开,看到 ≥3 张 `pm-planner` origin 卡片,执行后转 `done`,观察 chat 中 employee 在 `done` 之前跑过 `pnpm test` 并通过
- [ ] 6.3.4 切到 Direct (direct_to_employee) 模式,在员工面板点一个 employee,提同样需求,观察 boss/manager/HR 节点不出现,直接 employee 自己拆 todo 卡 (origin=`employee`)
- [ ] 6.3.5 切到 YOLO 模式,提同样需求,观察 yolo-master 节点接管,无其他角色出现;long-running 任务跑过 30+ turn 仍稳定,context 大小波动不超过限制
- [ ] 6.3.6 浏览器开 DevTools Network,模拟掉线 (offline mode),等 5 秒,恢复,观察 SSE 重连后最后一条 agent message 与当前 task 状态可见 (来自 `/api/conversations/:id/resume`)
- [ ] 6.3.7 ⌘J 打开看板,深海荧光抽屉从顶部滑下,3D 办公室在底层依然可见(被 abyss 35% 半透明 scrim 罩住),3D scene 帧率明显降低
- [ ] 6.3.8 看板点 ✕ 关闭,3D 帧率恢复
- [ ] 6.3.9 ESC 在不同 overlay 上分别测,关闭顺序与 `unified-shell-routing` spec 锁定的行为一致(无 regression)
- [ ] 6.3.10 用 `todo_update` 把一张卡转 `blocked` 加 reason,观察看板上该卡显示 ⛔ + reason 文本

### 6.4 Product live runtime closure (Tauri release `.app`)

按 AGENTS.md "Desktop / Computer Use 验收"约束,必须测 release `.app`,不能停在 dev webview。

- [ ] 6.4.1 `pnpm --filter @offisim/desktop build` 构建 release,`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` 启动
- [ ] 6.4.2 重复 6.3.2–6.3.10 全部步骤
- [ ] 6.4.3 关注桌面侧 SQLite 数据持久化:重启 app 后看板卡片仍在;mode 切换持久化(下次开启同 conversation 仍是上次 mode)

### 6.5 Hygiene + repository cleanup

按 CLAUDE.md "Repository Hygiene":

- [ ] 6.5.1 `git status` 确认 `output/`、`screenshots/`、`.playwright-mcp/`、tmp 文件不在版本库
- [ ] 6.5.2 `grep -rn "TODO\|FIXME\|XXX" packages/core/src apps/web/src apps/platform/src apps/desktop/src` 看本 change 引入的 TODO,每条要么解决要么转成 follow-up issue 并在 commit message 里 reference
- [ ] 6.5.3 删除任何 placeholder / stub 实现 (本 change 没引 fallback / legacy prefix / 隐藏兼容分支,确认这点)

### 6.6 CHANGELOG + RC tag

- [ ] 6.6.1 `CHANGELOG.md` append 1.1.0-rc.1 段落:
  ```
  ## 1.1.0-rc.1

  ### Long-Running Harness, Interaction Modes, Kanban Data Pipeline

  - long-running-runtime: micro-compact, rolling journal with anchor objective, fork-sub-context primitive, completion-verifier hook, ResumeCoordinator with platform/Tauri resume routes
  - interaction-modes: InteractionMode union expanded to 4 values (boss_proxy / human_in_loop / direct_to_employee / yolo); YOLO Master employee seeded into all 5 templates with idempotent ensure for existing companies; mode-aware main-graph router; SessionModeSwitcher UI
  - kanban-data-pipeline: kanban_cards table on db-local, KanbanRepo with state machine, pm-planner persists plan steps as cards, employee-completion transitions cards on done/review, platform + Tauri CRUD + SSE, KanbanOverlay live with ocean-cyber visual alignment, per-employee kanban-count badge
  ```
- [ ] 6.6.2 `pnpm typecheck && pnpm lint && pnpm harness:contract && pnpm harness:replay && pnpm harness:soak` 全部绿色
- [ ] 6.6.3 `git tag -a v1.1.0-rc.1 -m "Long-running harness + interaction modes + kanban data pipeline"`
- [ ] 6.6.4 `git push origin main --tags` (用户授权后)

## 7. Execution Report

- [ ] 7.1 把 6.3 + 6.4 的 closure checklist 全部勾完后,新建 `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md`,内容:
  - 每个 phase 的 commit count + key commit hashes + tag
  - 新增 / 修改的文件总数
  - harness scenario 数量 + 全绿截图(若有)
  - soak 数字:final tokens / micro-compact passes / rolling-journal writes / completion-verifier triggers
  - 简化审查总结:每 task 发现的问题清单(无问题写 "clean")
  - 偏离 plan 的清单:每条说明 (a) plan 写了什么 (b) 真实代码是什么 (c) 怎么处理
  - 6.3 + 6.4 manual closure checklist 逐项结果
  - 已知问题 / follow-up
- [ ] 7.2 commit `docs(runtime): execution report for 1.1.0-rc.1`

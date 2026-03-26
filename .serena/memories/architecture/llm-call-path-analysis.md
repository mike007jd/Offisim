# LLM 调用路径与图执行流深度分析

## 一、用户消息入口流（What happens from user message → first LLM call）

### 1.1 消息入口点
```
OrchestrationService.execute()
  ↓
fullInput = { threadId, companyId, entryMode, messages: [BaseMessage], ... }
  ↓
config.configurable = { runtimeCtx: RuntimeContext, signal: AbortSignal }
  ↓
graph.stream(fullInput, config)
```

### 1.2 路由决策（routeFromStart → Boss or Direct or Meeting）
- **entryMode='boss_chat'** → Boss node（标准用户聊天）
- **entryMode='direct_chat' + targetEmployeeId** → employee_direct_setup → employee_node
- **entryMode='meeting' + meetingId + meetingInterrupt** → meeting_resume or meeting_end
- **entryMode='heartbeat'** → pm_heartbeat → END
- **entryMode='background_sync'** → Boss node

### 1.3 Boss Node（第一个LLM调用）
**文件**: `packages/core/src/agents/boss-node.ts`

```typescript
// 1. 获取最近N个人类消息（默认last 3）
const recentHumanMessages = state.messages
  .filter((m) => m._getType() === 'human')
  .slice(-3);

// 2. 调用 recordedLlmCall（已应用消息修剪）
const llmResponse = await recordedLlmCall(runtimeCtx, {
  messages: [
    { role: 'system', content: BOSS_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ],
  model: resolved.model,
  temperature: resolved.temperature,
  maxTokens: resolved.maxTokens,
  signal: getConfigSignal(config),
}, { 
  nodeName: 'boss', 
  provider: resolved.provider, 
  model: resolved.model 
});

// 3. 解析Boss决策 (action = 'delegate' | 'direct_reply' | 'meeting' | 'hire_or_assess')
const decision = parseBossDecision(llmResponse.content);

// 4. 映射到路由决策
routeDecision = mapActionToRoute(decision.action)  // 生成 'delegate_manager' | 'direct_reply' | 'start_meeting'
```

**关键特征**:
- Boss 使用**记录的LLM调用**（见下文）
- 自动检测项目创建（isNewProject=true）
- direct_reply 消息加 [Boss]: 前缀

---

## 二、跨层级关切的处理（Cross-cutting concerns）

### 2.1 消息修剪管道（Message Pruning Pipeline）

**位置**: `recordedLlmCall()` → `ConversationBudgetService.prepareRequest()`

```
LlmRequest（含所有历史消息）
  ↓ recordedLlmCall()
  ↓ conversationBudgetService.prepareRequest()
  ↓ 1. 分离 system vs non-system messages
  ↓ 2. 如果 nonSystem > maxNonSystemMessages:
       - 检查现有 synopsis（如果线程已总结过）
       - 决定是否生成新 synopsis（触发条件：消息数>80 AND 令牌数>60k）
       - 插入 synopsis 作为 system message
  ↓ 3. pruneLlmMessages() 保留最近50条非system消息
  ↓ 返回修剪后的 LlmRequest
  ↓ gateway.chat() 调用LLM
```

**配置来源**: `RuntimeContext.runtimePolicy?.summarization`
- **enabled**: 默认 true
- **keepRecentMessages**: 默认50
- **triggerTokens**: 默认60000
- **triggerMessages**: 默认80

**重要**: 
- 修剪发生在**LLM调用层**，不影响图状态（graph state 保留完整历史）
- Graph state.messages 始终保存完整对话，用于检查点恢复
- 每个 recordedLlmCall 都应用修剪

### 2.2 记录的LLM调用（recordedLlmCall）

**位置**: `packages/core/src/llm/recorded-call.ts`

**执行流程**:
```typescript
// 1. 生成 llmCallId，记录开始时间
const llmCallId = generateId('lc');
const startedAt = Date.now();

// 2. 发出 llmCallStarted 事件
ctx.eventBus.emit(llmCallStarted(...));

// 3. **应用消息修剪** ← 关键！
const prunedRequest = await conversationBudgetService.prepareRequest(ctx, request);

// 4. 调用网关
const response = await ctx.llmGateway.chat(prunedRequest);

// 5. 记录到数据库 (llmCalls 表)
await ctx.repos.llmCalls.create({
  llm_call_id: llmCallId,
  thread_id: ctx.threadId,
  task_run_id: meta.taskRunId,  // 可选（仅当在任务上下文时）
  node_name: meta.nodeName,
  provider: meta.provider,
  model: meta.model,
  input_tokens: response.usage.inputTokens,
  output_tokens: response.usage.outputTokens,
  latency_ms: latencyMs,
  error_code: null,
  created_at: ...
});

// 6. 发出 llmCallCompleted 和 llmUsageRecorded 事件
ctx.eventBus.emit(llmCallCompleted(...));
ctx.eventBus.emit(llmUsageRecorded(...));

// 7. 返回 response
return response;
```

**所有的LLM调用都必须使用 recordedLlmCall()**（除了一个例外见下文）

### 2.3 LLM调用的两个变体

1. **recordedLlmCall()** - 一次性调用，返回完整响应
   - 用途: Boss, Manager, PM, HR, Employee 的初始 LLM 调用
   - 每次调用都应用消息修剪

2. **recordedLlmStream()** - 流式响应
   - 用途: Employee 多轮工具调用时的后续请求
   - 使用 teeStream 累积 chunks，最后收集 usage

**异常**: ConversationBudgetService 自己调用 `gateway.chat()` 来生成 synopsis（不通过 recordedLlmCall）

---

## 三、Boss 的路由决策（routeFromBoss）

**文件**: `packages/core/src/graph/main-graph.ts`

```typescript
export function routeFromBoss(state: AicsGraphState): string {
  // 中断优先级最高
  if (state.interruptReason) return 'error_handler';
  
  // 基于Boss决策路由
  switch (state.routeDecision) {
    case 'delegate_manager':      // Boss 说"需要工作"或"招聘"
      return 'manager';           // → Manager决定分配
    case 'direct_reply':          // Boss 说"我直接回答"
      return 'boss_summary';      // → 准备最终消息并返回
    case 'start_meeting':         // Boss 说"开会"
      return 'meeting_start';     // → 会议启动
    default:
      return 'manager';           // 默认到Manager
  }
}
```

**关键发现**:
- 没有"跳过"路由 — 消息**必须**通过某个节点处理
- `direct_reply` **不** 调用额外的LLM（Boss的回复已生成）
- routeDecision 值的完整列表：`'direct_reply' | 'delegate_manager' | 'start_meeting' | null`

---

## 四、完整的图拓扑与LLM调用分布

**所有进行LLM调用的节点** (使用 recordedLlmCall):
1. **boss** ✓ - 用户意图分类
2. **manager** ✓ - 员工分配（如果>1个员工，否则快路径）
3. **pm_planner** ✓ - 计划生成（如果不匹配SOP）
4. **employee** ✓ - 任务执行（+ 工具调用）
5. **error_handler** ✓ - 错误恢复诊断
6. **boss_summary** ✗ - 仅从现有消息构建总结（不调用LLM）
7. **hr** ✓ - 招聘/评估（如果 managerDirective.constraints='hire'|'assess_team'）
8. **pm_heartbeat** ✗ - 无操作（只检查进度）
9. **step_dispatcher** ✗ - 内联节点，仅创建任务运行
10. **step_advance** ✗ - 内联节点，仅管理步骤状态
11. **pm_replan** ✓ - 重新计划（当员工输出包含 [SIGNAL:REPLAN_NEEDED]）
12. **meeting_*** ✓ - 会议参与者 LLM 调用（participantTurnNode）

**LLM调用总数**: 典型执行链有 **3-5 个 recordedLlmCall()** 调用：
- boss (始终)
- manager (如果 >1 员工或SOP不匹配)
- pm_planner (如果没有SOP匹配)
- employee (并行，每个任务一个)
- 可选: hr, pm_replan, recovery

---

## 五、状态字段详解（AicsGraphState）

**routeDecision**: 
- Boss输出的决策，影响 routeFromBoss() 行为
- 值: `'direct_reply' | 'delegate_manager' | 'start_meeting' | null`
- 仅由 bossNode 写入

**entryMode**:
- 执行入口类型，影响 routeFromStart()
- 值: `'boss_chat' | 'meeting' | 'install_flow' | 'background_sync' | 'direct_chat' | 'heartbeat'`
- 由 OrchestrationService.execute() 设置

**pendingAssignments**:
- 由 Manager/PM 创建，由 Employee 逐个弹出
- 结构: `{ taskType, employeeId, inputJson }`
- 当员工完成一个分配后，它从队列中移除

**currentStepOutputs**:
- 当前步骤中所有员工响应的积累列表
- 当 stepAdvanceNode 运行时被清空
- 每条记录包含: `{ employeeId, employeeName, content, taskRunId, citations? }`

**completedStepIndices** vs **dispatchedStepIndices**:
- dispatchedStepIndices: 已创建任务运行但可能还在运行
- completedStepIndices: 所有任务都完成
- stepAdvanceNode 计算差集来确定哪些步骤已完成

---

## 六、内存和权限检查

### 6.1 内存注入（Employee Node）
```typescript
// 在 employeeNode 中，构建系统提示之前：
if (memoryService && taskDescription && (memoryPolicy?.injectionEnabled ?? true)) {
  const relevantMemories = await memoryService.getRelevantMemories(
    employee.employee_id,
    companyId,
    taskDescription,  // 用于语义搜索
    memoryPolicy?.maxFacts ?? 10
  );
  systemPrompt += formatMemoriesSection(relevantMemories);
}
```
- **位置**: Employee node 系统提示构建
- **时机**: 在LLM调用之前
- **数据来源**: MemoryService（实现见 packages/core/src/services/）

### 6.2 库文档注入（Employee Node）
```typescript
if (taskDescription && repos.libraryDocuments) {
  const libraryService = new LibraryService(repos.libraryDocuments, eventBus);
  const { text, citations } = await libraryService.getRelevantSnippetsWithCitations(
    companyId,
    taskDescription
  );
  if (text) {
    citationMap = citations;  // 用于提取已使用的引用
    systemPrompt += `\n\n## Relevant company documents\n${text}\n\nWhen referencing these documents, cite them using [N] notation.`;
  }
}
```

### 6.3 工作站工具访问控制（PRD 2.3）
```typescript
// Employee node 中：
const mcpTools = workstationToolResolver
  ? await workstationToolResolver.resolveForEmployee(companyId, employee.employee_id)
  : await toolExecutor.listAvailable(companyId);

// 后来，当员工调用工具时：
if (workstationToolResolver && !allowedMcpToolNames.has(toolCall.name)) {
  return {
    success: false,
    error: `[WORKSTATION_ACCESS_DENIED] Employee '${employee.name}' is not assigned to a workstation with access to tool '${toolCall.name}'.`
  };
}
```

### 6.4 权限检查（其他）
- **Handoff限制**: `state.handoffCount < MAX_HANDOFF_COUNT` (最多3个)
- **直接聊天限制**: handoff 在 `entryMode='direct_chat'` 时禁用
- **消息上下文限制**: Employee 多轮对话保留 `MAX_CONTEXT_MESSAGES=20`
- **会话限制**: `useSceneOrchestrator` 保留 ≤5 公司，≤200 句柄（前端优化）

---

## 七、Fast Path 优化

### 7.1 Manager Node Fast Path
当满足所有条件时跳过LLM调用：
```typescript
const nonManagerEmployees = employees.filter(e => !GRAPH_ONLY_ROLES.has(e.role_slug));
const HIRE_KEYWORDS = /\b(hire|recruit|assess|staffing)\b/i;

if (nonManagerEmployees.length === 1 && !HIRE_KEYWORDS.test(userContent)) {
  // 直接分配给唯一员工，无LLM调用
  return {
    managerDirective: {
      intent: userContent,
      recommendedEmployees: [soleEmployee.employee_id]
    }
  };
}
```

### 7.2 PM Planner Fast Path
当SOP模板匹配时跳过LLM：
```typescript
const matched = matchSopTemplate(templates, directive.intent);
if (matched) {
  // 从SOP定义生成计划
  const plan = sopBatchesToLlmPlan(sopDef, batches, employees);
  // 无LLM调用
}
```

---

## 八、错误恢复流（Recovery Agent）

**位置**: `packages/core/src/agents/employee-node.ts` 中的 `attemptLocalRecovery()`

当 Employee LLM 调用失败时：
```
error thrown
  ↓ attemptLocalRecovery()
    ├─ 诊断: diagnoseAndRecover() 查询恢复知识库
    └─ 策略选择:
       ├─ retry_with_backoff (2s, 4s 延迟) → recordedLlmCall() 重试
       ├─ switch_model → 切换到默认模型，重试
       ├─ skip_and_continue → 返回跳过消息（非关键任务）
       └─ replan_step or escalate → 返回 null，升级到 error_handler
  ↓ 如果恢复成功: 继续执行，完成任务
  ↓ 如果失败: 返回 interruptReason，路由到 error_handler
```

**重要**: 恢复尝试最多 `MAX_RECOVERY_RETRIES=2` 次

---

## 九、Event Bus 与事件流

**核心事件类型**:
```
llmCallStarted (nodeName, provider, model, threadId)
  ↓ [LLM执行中]
llmCallCompleted (latencyMs, inputTokens, outputTokens)
llmUsageRecorded (provider, model, inputTokens, outputTokens)

graphNodeEntered (companyId, threadId, nodeName)
  ↓ [节点执行]
graphNodeExited (companyId, threadId, nodeName)

taskStateChanged (taskRunId, oldStatus, newStatus)
taskAssignmentChanged (taskRunId, employeeId)
taskSubtaskProgress (employeeId, progress, totalAssignments)

memoryAccessed (memoryId, query)
handoffInitiated (handoffId, fromEmployeeId, toEmployeeId)

planCreated (planId, summary, stepCount)
planStepCompleted (planId, stepIndex, outputCount)
```

**发出方式**:
- 所有事件通过 `runtimeCtx.eventBus.emit()` 
- 订阅者使用 `eventBus.on(prefix, handler)` 或 `.once()`
- 前缀匹配支持树形导航（e.g., `'task.state.changed'`）

---

## 十、关键发现与设计决策

### ✓ 不在 Boss 中有"直接回复快路径"吗？
**YES，有的。** `routeDecision='direct_reply'` 就是它。Boss LLM 调用后，如果决策是 direct_reply，则：
1. LLM 已经生成了回复文本
2. 直接路由到 boss_summary（跳过所有下游节点）
3 boss_summary 不调用任何LLM，仅将消息格式化

### ✓ 消息修剪在哪里发生？
**两个地方**：
1. **recordedLlmCall 内部** → ConversationBudgetService → pruneLlmMessages()
2. **每次 LLM 调用时**应用（不是全局一次）

### ✓ 权限检查的集中点
**分散的**：
- 工作站工具：workstationToolResolver（工具执行层）
- Handoff：MAX_HANDOFF_COUNT + entryMode 检查
- 记忆访问：memoryService 本身（无明确授权检查，基于 scope）

---

## 总结：典型执行链（Happy Path）

```
用户消息 "请编写一个登录页面"
  ↓
OrchestrationService.execute()
  entryMode='boss_chat'
  messages=[HumanMessage("...")]
  
  ↓ routeFromStart() → 'boss'
  
  ├─ Boss Node (recordedLlmCall #1)
  │   ├─ 应用消息修剪
  │   ├─ LLM: "analyze intent → delegate"
  │   └─ routeDecision = 'delegate_manager'
  │
  ├─ routeFromBoss() → 'manager'
  │
  ├─ Manager Node (recordedLlmCall #2 if >1 emp)
  │   ├─ Fast path if only 1 employee
  │   ├─ LLM: "assign to frontend designer"
  │   └─ managerDirective: { recommendedEmployees: [emp1] }
  │
  ├─ routeFromManager() → 'pm_planner'
  │
  ├─ PM Planner Node (recordedLlmCall #3 if no SOP)
  │   ├─ Check SOP templates
  │   ├─ LLM: "create plan: wireframe → design → code"
  │   └─ taskPlan with 3 steps, task_run records created
  │
  ├─ routeFromPm() → 'step_dispatcher'
  │
  ├─ Step Dispatcher Node (inline, no LLM)
  │   ├─ Find first ready steps
  │   └─ Create pendingAssignments queue
  │
  ├─ Edge → 'employee'
  │
  ├─ Employee Node #1 (recordedLlmCall #4)
  │   ├─ Pop assignment
  │   ├─ Inject memories + library docs
  │   ├─ LLM + multi-round tools
  │   └─ Output: "Created login page wireframe..."
  │
  ├─ routeFromEmployee() → 'step_advance' (if no pending)
  │
  ├─ Step Advance Node (inline, no LLM)
  │   ├─ Mark steps complete
  │   └─ Emit planStepCompleted
  │
  ├─ routeFromStepAdvance() → 'step_dispatcher'
  │
  ├─ [Loop back to Employee for step 2, 3...]
  │
  ├─ Eventually: routeFromEmployee() → 'boss_summary'
  │
  └─ Boss Summary Node (inline, no LLM)
      ├─ Format all messages
      └─ Return final AicsGraphState
```

总LLM调用: **4次** (Boss + Manager + PM + Employee 在step1)

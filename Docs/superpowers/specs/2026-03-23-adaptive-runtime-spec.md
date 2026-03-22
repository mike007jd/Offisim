# Adaptive Runtime — Self-Healing, Event Sourcing, Heartbeat, Dynamic Re-Planning

**Date:** 2026-03-23
**Inspired by:** OpenClaw architecture (4-tier self-healing, hybrid orchestration, persistent learning)
**Status:** Design spec, implementation not started

---

## 0. Design Philosophy

> 小问题自愈、大问题找 AI 医生、致命问题叫醒人类。
> Agent 不是等指令的工具，是有主动觉察能力的协作者。
> 每次失败都是学习机会——Recovery Agent 越用越聪明。

**核心原则：**
- AI 驱动的决策，不是硬编码流程
- 不可变事件日志是一切高级功能的基础
- 本地优先：SQLite WAL 够用，但查询接口要支持未来分布式升级
- 渐进式：每个模块独立可用，组合后效果倍增

---

## A. Event Sourcing — Agent 决策持久化

### Problem

EventBus 是内存同步的，事件发完即丢。无法：
- 回放项目历史（审计）
- 分析 agent 决策模式（学习）
- 跨重启恢复上下文（auto-resume 当前只有 LangGraph checkpoint，无业务事件）

### Decision

新增 `agent_events` 表，每个 agent 决策写一条不可变记录。EventBus 保持内存同步（UI 实时性），持久化是 **附加层** 而非替代。

### Data Model

Migration 012:

```sql
CREATE TABLE IF NOT EXISTS agent_events (
  event_id     TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  thread_id    TEXT NOT NULL,
  company_id   TEXT NOT NULL,
  agent_name   TEXT NOT NULL,   -- 'boss', 'manager', 'pm', 'employee:e-dev-1', 'error', 'recovery'
  event_type   TEXT NOT NULL,   -- 'decision', 'action', 'error', 'recovery', 'heartbeat', 'replan'
  payload_json TEXT NOT NULL,   -- structured event data (immutable)
  parent_event_id TEXT,         -- causal chain: this event was caused by which event
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_agent_events_project ON agent_events(project_id, created_at);
CREATE INDEX idx_agent_events_thread ON agent_events(thread_id, event_type);
CREATE INDEX idx_agent_events_agent ON agent_events(agent_name, event_type);
```

### Event Types

| event_type | agent_name | payload example |
|------------|------------|-----------------|
| `decision` | boss | `{action: "delegate", isNewProject: true, projectName: "电商平台"}` |
| `decision` | pm | `{planId: "...", stepCount: 5, phases: ["研究","开发","测试"]}` |
| `action` | employee:e-dev-1 | `{taskRunId: "...", toolCalls: 3, outputLength: 1200}` |
| `error` | error | `{errorCode: "LLM_TIMEOUT", node: "employee", threadId: "..."}` |
| `recovery` | recovery | `{symptom: "LLM_TIMEOUT", cause: "rate_limit", fix: "retry_with_backoff", prevented: false}` |
| `heartbeat` | pm | `{projectId: "...", progress: "3/5 steps", blockers: []}` |
| `replan` | pm | `{planId: "...", version: 2, reason: "employee reported infeasible", diffs: [...]}` |

### Integration Points

1. **Graph nodes** — 每个 node 退出时写一条 `decision` 或 `action` event
2. **Error handler** — 写 `error` event（已有 EventBus emit，加 DB persist）
3. **Auto-resume** — 启动时查询最近 `decision` events 恢复上下文（补充 LangGraph checkpoint）
4. **UI** — 项目详情页显示事件时间线（代替当前的 messages-only 视图）

### Repository Interface

```typescript
interface AgentEventRepository {
  append(event: NewAgentEvent): Promise<AgentEventRow>;
  findByProject(projectId: string, opts?: { limit?: number; eventType?: string }): Promise<AgentEventRow[]>;
  findByThread(threadId: string, opts?: { limit?: number }): Promise<AgentEventRow[]>;
  findByAgent(agentName: string, opts?: { limit?: number; eventType?: string }): Promise<AgentEventRow[]>;
  findCausalChain(eventId: string): Promise<AgentEventRow[]>;  // recursive parent chain
}
```

### Write Pattern

```typescript
// In each graph node, after the main logic:
if (runtimeCtx.repos.agentEvents) {
  await runtimeCtx.repos.agentEvents.append({
    event_id: generateId('evt'),
    project_id: state.projectId,
    thread_id: state.threadId,
    company_id: state.companyId,
    agent_name: 'boss',
    event_type: 'decision',
    payload_json: JSON.stringify({ action, reason, isNewProject }),
    parent_event_id: null,  // or the event that triggered this decision
  });
}
```

### Backward Compatibility

- `agentEvents` is optional on RuntimeRepositories (repos that don't have it skip persistence)
- Memory repos return a no-op implementation
- Existing EventBus behavior unchanged

---

## B. Recovery Agent — 从报错到自愈

### Problem

Error handler node 只做路由（标记 failed、取消 pending tasks）。不能：
- 分析历史错误模式
- 尝试自动修复
- 学习预防策略

### Decision

升级 error-handler-node 为 Recovery Agent。两阶段：
1. **诊断** — 读 `agent_events` 中的历史 error/recovery 记录，找相似症状
2. **修复** — 如果有匹配的修复方案，自动执行；否则升级到用户

### Recovery Knowledge Base

```sql
-- Migration 013
CREATE TABLE IF NOT EXISTS recovery_knowledge (
  knowledge_id TEXT PRIMARY KEY,
  symptom      TEXT NOT NULL,    -- 'LLM_TIMEOUT', 'TOOL_CALL_FAILED:read_file', 'PARSE_ERROR:json'
  cause        TEXT NOT NULL,    -- 'rate_limit', 'file_not_found', 'malformed_llm_output'
  fix_strategy TEXT NOT NULL,    -- 'retry_with_backoff', 'skip_and_continue', 'replan_step', 'escalate'
  fix_config   TEXT,             -- JSON config for the strategy: {"maxRetries": 3, "backoffMs": 5000}
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_recovery_symptom ON recovery_knowledge(symptom, cause);
```

### Recovery Strategies

| fix_strategy | 行为 | 自动 or 人工 |
|-------------|------|-------------|
| `retry_with_backoff` | 指数退避重试（已有 withRetry，但 Recovery 可以调整参数） | 自动 |
| `switch_model` | 当前模型 rate limit → 切到 fallback 模型 | 自动 |
| `skip_and_continue` | 跳过当前 task，继续下一个（适合非关键步骤） | 自动 |
| `replan_step` | 告诉 PM "这步失败了"，PM 重新规划 | 自动 |
| `escalate` | 创建通知，让用户决定 | 人工 |

### Recovery Flow

```
error_handler_node 收到错误
  ↓
1. 写 error event 到 agent_events
2. 查 recovery_knowledge: 有匹配 symptom?
   ├── YES → 执行 fix_strategy
   │   ├── 成功 → 写 recovery event, success_count++
   │   └── 失败 → failure_count++, 降级到下一个策略
   └── NO → 调用 LLM 分析错误 + 上下文
       ├── LLM 建议修复 → 执行并记录到 recovery_knowledge (新条目)
       └── LLM 无方案 → escalate
```

### LLM 诊断 Prompt

```
You are a Recovery Agent. An error occurred during project execution.

Error: {errorCode}
Node: {nodeName}
Context: {recent agent_events for this thread}
Similar past errors: {matching recovery_knowledge entries}

Decide:
1. Is this a known pattern? → Apply the matching fix
2. Is this a new pattern? → Propose a fix strategy from: retry_with_backoff, switch_model, skip_and_continue, replan_step, escalate
3. What's the root cause? (for learning)

Respond as JSON: { "fix_strategy": "...", "cause": "...", "confidence": 0.0-1.0 }
If confidence < 0.5, set fix_strategy = "escalate".
```

### Persistent Learning

每次 Recovery 执行后，更新 `recovery_knowledge`:
- 新症状 → 新条目
- 已有症状 → 更新 success/failure count
- success_count / (success + failure) < 0.3 → 自动降级或废弃策略

---

## C. Heartbeat — 主动觉察

### Problem

Agent 只在收到指令时行动。PM 不会主动检查员工进度，Manager 不会主动评估项目健康。

### Decision

Heartbeat 是一个定时触发的 graph 重入，用 `heartbeat` entryMode。

### Heartbeat Frequency

| Agent | 触发条件 | 频率 | 行为 |
|-------|---------|------|------|
| PM | 项目处于 `active` 状态 | 每 10 分钟（可配置） | 检查各 step 进度，识别卡住的 task |
| Manager | 有 >1 个 active 项目 | 每 30 分钟 | 评估资源分配，识别冲突 |
| Boss | 任何 active 项目 | 每 60 分钟 | 生成进度摘要（如果有变化） |

### Implementation

```typescript
// state.ts — add entryMode:
'heartbeat'

// main-graph.ts — routeFromStart:
if (state.entryMode === 'heartbeat') {
  return 'pm_heartbeat';  // new node
}

// New node: pm_heartbeat_node
// 1. Query project progress from DB (steps completed, tasks running)
// 2. If no change since last heartbeat → return early (无事则沉默)
// 3. If stuck task detected (>5min no progress) → emit alert event
// 4. If all steps complete → route to boss_summary
```

### Trigger Mechanism

In `AicsRuntimeProvider.tsx`, add a timer:

```typescript
useEffect(() => {
  if (!runtime?.orch) return;

  const interval = setInterval(async () => {
    const activeProjects = await runtime.repos.projects.findActiveByCompany(companyId);
    for (const project of activeProjects) {
      if (project.status === 'active' && project.thread_id) {
        await runtime.orch.execute({
          entryMode: 'heartbeat',
          messages: [],
          threadId: project.thread_id,
        });
      }
    }
  }, 10 * 60 * 1000); // 10 minutes

  return () => clearInterval(interval);
}, [runtime, companyId]);
```

### Heartbeat Event

```typescript
// agent_events entry:
{
  agent_name: 'pm',
  event_type: 'heartbeat',
  payload_json: {
    projectId: '...',
    progress: '3/5 steps completed',
    stuckTasks: [],           // tasks with no progress for >5min
    blockers: [],             // identified blockers
    recommendation: 'on track' // or 'needs attention'
  }
}
```

### No-Op Detection

**关键原则：无事则沉默。** Heartbeat 必须检查是否有变化，没有变化不写 event、不通知、不消耗 LLM tokens。

```typescript
const lastHeartbeat = await repos.agentEvents.findByAgent('pm', {
  eventType: 'heartbeat',
  limit: 1,
});

const currentProgress = computeProgress(project, stepResults);
if (lastHeartbeat && lastHeartbeat.payload.progress === currentProgress) {
  return {}; // No change, no event, no LLM call
}
```

---

## D. Dynamic Re-Planning — PM 执行中修改 DAG

### Problem

PM 创建的 DAG 是静态的。如果 Employee 报告"方案行不通"，当前系统继续走原计划或直接报错。

### Decision

允许 PM 在执行中途修改剩余 DAG。已完成的 step 不变，未执行的 step 可以替换。

### Re-Plan Trigger

```
Employee 返回结果包含 "infeasible" / "blocked" / "need alternative" 信号
  ↓
step_advance 检测到 employee output 包含 replan flag
  ↓
路由到 pm_replan_node (新 node)
  ↓
PM 读原 plan + 已完成 steps + employee 反馈
  ↓
PM 生成修改后的 remaining steps
  ↓
更新 state.taskPlan (保留 completedStepIndices, 替换未执行 steps)
  ↓
写 replan event 到 agent_events
  ↓
继续 step_dispatcher
```

### PM Re-Plan Prompt

```
You are the PM AI. The current plan has been partially executed, but a problem was reported.

Original plan: {taskPlan}
Completed steps: {completedStepIndices}
Employee feedback: "{output that triggered replan}"

Revise the remaining steps. You may:
- Replace steps that are no longer feasible
- Add new steps to address the problem
- Remove steps that are no longer needed
- Keep step indices sequential from {nextStepIndex}

Respond with JSON:
{
  "reason": "why the plan changed",
  "revisedSteps": [{ stepIndex, description, tasks, phase, dependsOnSteps }]
}
```

### State Changes

```typescript
// state.ts — add:
replanCount: Annotation<number>({
  reducer: (_prev, next) => next,
  default: () => 0,
}),

// step_advance logic:
if (employeeOutput.includes('REPLAN_NEEDED') && state.replanCount < 3) {
  return 'pm_replan';  // route to re-planning
}
```

### Replan Limit

最多 3 次重规划。超过 → escalate 到用户。防止无限循环。

### DAG Versioning

不需要复杂的版本系统。每次 replan 写一条 `replan` event，payload 包含 diff：

```typescript
{
  event_type: 'replan',
  payload_json: {
    planId: '...',
    version: 2,
    reason: 'Employee reported API endpoint deprecated',
    removedSteps: [3, 4],
    addedSteps: [{ stepIndex: 3, description: '...', ... }, { stepIndex: 4, ... }],
    completedBefore: [0, 1, 2],
  }
}
```

---

## Implementation Order

```
Phase 1 — Event Sourcing (基础设施，其他模块依赖)
  Migration 012, AgentEventRepository, graph nodes 写 events

Phase 2 — Recovery Agent (依赖 event sourcing 的历史数据)
  Migration 013, recovery_knowledge, error-handler 升级

Phase 3 — Heartbeat (依赖 event sourcing 的 no-op 检测)
  pm_heartbeat_node, timer trigger, heartbeat events

Phase 4 — Dynamic Re-Planning (依赖一切)
  pm_replan_node, employee replan flag, DAG 替换逻辑
```

---

## Files Changed (estimated)

| Phase | New | Modified |
|-------|-----|----------|
| A | migration 012, agent-event repos, agent-event types | all graph nodes (append event), memory-repos |
| B | migration 013, recovery-knowledge repo, recovery-agent | error-handler-node, orchestration-service |
| C | pm-heartbeat-node | main-graph (new node + routing), AicsRuntimeProvider (timer), state.ts |
| D | pm-replan-node | step-advance (replan detection), state.ts (replanCount), step-dispatcher |

---

## Non-Goals (this spec does NOT cover)

- Multi-device sync (OpenClaw 的 device node 概念)
- 消息渠道集成 (WhatsApp/Slack — Offisim 是办公室 runtime 不是通讯工具)
- SOUL.md 声明式 agent 配置（Offisim 用 manifest + 公司模板，不需要单独的 SOUL 文件）

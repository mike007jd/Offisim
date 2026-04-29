import type { KanbanOrigin, KanbanState, RuntimeEvent } from '@offisim/shared-types';
import type { OffisimGraphState } from '../graph/state.js';
import type { RuntimeRepositories } from '../runtime/repositories.js';
import type { ScenarioAssertionReport } from './trace-recorder.js';

export type ScenarioAssertion =
  | {
      readonly kind: 'stepContainsOnly';
      readonly stepIndex: number;
      readonly contains: readonly string[];
    }
  | { readonly kind: 'noDuplicateStepOutputs' }
  | { readonly kind: 'threadStatusIs'; readonly status: string }
  | { readonly kind: 'taskRunStatusIs'; readonly taskRunId: string; readonly status: string }
  | { readonly kind: 'taskStateEvent'; readonly taskRunId: string; readonly next: string }
  | {
      readonly kind: 'interactionHistoryContains';
      readonly interactionKind: string;
      readonly selectedOptionId?: string;
      readonly status?: string;
      readonly payloadType?: string;
    }
  | { readonly kind: 'noEmployeeAfterCancel' }
  | {
      readonly kind: 'mcpAuditContains';
      readonly toolName: string;
      readonly approvedBy?: string;
      readonly errorIncludes?: string;
    }
  | { readonly kind: 'toolExecutions'; readonly count: number }
  | { readonly kind: 'llmCalls'; readonly count: number }
  | { readonly kind: 'firstGraphNodeIs'; readonly nodeName: string }
  | {
      readonly kind: 'kanbanCards';
      readonly projectId: string;
      readonly count: number;
      readonly origin?: KanbanOrigin;
      readonly states?: Partial<Record<KanbanState, number>>;
    }
  | {
      readonly kind: 'kanbanEventSequence';
      readonly sequence: readonly string[];
    }
  | { readonly kind: 'toolPermissionApprovalConsumed'; readonly scope: 'once' | 'thread' }
  | { readonly kind: 'finalOutputContains'; readonly contains: string }
  | { readonly kind: 'interruptReasonIncludes'; readonly contains: string };

export interface ScenarioAssertionContext {
  readonly scenarioId: string;
  readonly finalState: Partial<OffisimGraphState>;
  readonly repos: RuntimeRepositories & { snapshot?: () => unknown };
  readonly threadId: string;
  readonly toolExecutions: readonly unknown[];
  readonly events: readonly RuntimeEvent[];
}

export async function evaluateScenarioAssertions(
  assertions: readonly ScenarioAssertion[],
  ctx: ScenarioAssertionContext,
): Promise<ScenarioAssertionReport[]> {
  const reports: ScenarioAssertionReport[] = [];
  for (const assertion of assertions) {
    try {
      await evaluateAssertion(assertion, ctx);
      reports.push({ kind: assertion.kind, passed: true });
    } catch (error) {
      reports.push({
        kind: assertion.kind,
        passed: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return reports;
}

async function evaluateAssertion(
  assertion: ScenarioAssertion,
  ctx: ScenarioAssertionContext,
): Promise<void> {
  switch (assertion.kind) {
    case 'stepContainsOnly':
      return assertStepContainsOnly(assertion, ctx.finalState);
    case 'noDuplicateStepOutputs':
      return assertNoDuplicateStepOutputs(ctx.finalState);
    case 'threadStatusIs':
      return assertThreadStatus(ctx.repos, ctx.threadId, assertion.status);
    case 'taskRunStatusIs':
      return assertTaskRunStatus(ctx.repos, assertion.taskRunId, assertion.status);
    case 'taskStateEvent':
      return assertTaskStateEvent(ctx.events, assertion);
    case 'interactionHistoryContains':
      return assertInteractionHistory(ctx.repos, ctx.threadId, assertion);
    case 'noEmployeeAfterCancel':
      return assertNoEmployeeAfterCancel(ctx);
    case 'mcpAuditContains':
      return assertMcpAudit(ctx.repos, ctx.threadId, assertion);
    case 'toolExecutions':
      return assertToolExecutions(ctx.toolExecutions, assertion.count);
    case 'llmCalls':
      return assertLlmCalls(ctx.repos, ctx.threadId, assertion.count);
    case 'firstGraphNodeIs':
      return assertFirstGraphNode(ctx.events, assertion.nodeName);
    case 'kanbanCards':
      return assertKanbanCards(ctx.repos, assertion);
    case 'kanbanEventSequence':
      return assertKanbanEventSequence(ctx.events, assertion.sequence);
    case 'toolPermissionApprovalConsumed':
      return assertToolPermissionApprovalConsumed(ctx.repos, ctx.threadId, assertion.scope);
    case 'finalOutputContains':
      return assertFinalOutputContains(ctx.finalState, assertion.contains);
    case 'interruptReasonIncludes':
      return assertInterruptReasonIncludes(ctx.finalState, assertion.contains);
  }
}

async function assertKanbanCards(
  repos: RuntimeRepositories,
  assertion: Extract<ScenarioAssertion, { kind: 'kanbanCards' }>,
): Promise<void> {
  const cards = (await repos.kanban.listByProject(assertion.projectId)).filter((card) =>
    assertion.origin ? card.origin === assertion.origin : true,
  );
  if (cards.length !== assertion.count) {
    throw new Error(
      `Expected ${assertion.count} kanban cards for ${assertion.projectId}, got ${cards.length}`,
    );
  }
  for (const [state, expected] of Object.entries(assertion.states ?? {})) {
    const actual = cards.filter((card) => card.state === state).length;
    if (actual !== expected) {
      throw new Error(`Expected ${expected} kanban cards in ${state}, got ${actual}`);
    }
  }
}

function assertKanbanEventSequence(
  events: readonly RuntimeEvent[],
  expected: readonly string[],
): void {
  const actual = events
    .map((event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== 'object') return null;
      const record = payload as {
        kind?: unknown;
        op?: unknown;
        card?: { state?: unknown };
      };
      if (record.kind !== 'kanban' || typeof record.op !== 'string') return null;
      return `${record.op}:${String(record.card?.state ?? '<missing>')}`;
    })
    .filter((entry): entry is string => entry !== null);
  if (
    actual.length !== expected.length ||
    expected.some((entry, index) => actual[index] !== entry)
  ) {
    throw new Error(
      `Kanban event sequence mismatch. expected=${expected.join(',')} actual=${actual.join(',')}`,
    );
  }
}

function assertFirstGraphNode(events: readonly RuntimeEvent[], expected: string): void {
  const first = events.find((event) => event.type === 'graph.node.entered');
  const actual =
    first?.payload && typeof first.payload === 'object'
      ? (first.payload as Record<string, unknown>).nodeName
      : undefined;
  if (actual !== expected) {
    throw new Error(`Expected first graph node ${expected}, got ${String(actual ?? '<none>')}`);
  }
}

function assertStepContainsOnly(
  assertion: Extract<ScenarioAssertion, { kind: 'stepContainsOnly' }>,
  finalState: Partial<OffisimGraphState>,
): void {
  const result = finalState.stepResults?.find((step) => step.stepIndex === assertion.stepIndex);
  if (!result) throw new Error(`Missing step result ${assertion.stepIndex}`);
  const contents = result.outputs.map((output) => output.content);
  const expected = [...assertion.contains].sort();
  const actual = [...contents].sort();
  if (
    expected.length !== actual.length ||
    expected.some((value, index) => value !== actual[index])
  ) {
    throw new Error(
      `Step ${assertion.stepIndex} outputs mismatch. expected=${expected.join(',')} actual=${actual.join(',')}`,
    );
  }
}

function assertNoDuplicateStepOutputs(finalState: Partial<OffisimGraphState>): void {
  const seen = new Map<string, number>();
  for (const result of finalState.stepResults ?? []) {
    for (const output of result.outputs) {
      const key = `${output.taskRunId}:${output.content}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        throw new Error(
          `Output "${output.content}" appears in both step ${previous} and ${result.stepIndex}`,
        );
      }
      seen.set(key, result.stepIndex);
    }
  }
}

async function assertThreadStatus(
  repos: RuntimeRepositories,
  threadId: string,
  expected: string,
): Promise<void> {
  const thread = await repos.threads.findById(threadId);
  if (thread?.status !== expected) {
    throw new Error(`Expected thread status ${expected}, got ${thread?.status ?? '<missing>'}`);
  }
}

async function assertTaskRunStatus(
  repos: RuntimeRepositories,
  taskRunId: string,
  expected: string,
): Promise<void> {
  const taskRun = await repos.taskRuns.findById(taskRunId);
  if (taskRun?.status !== expected) {
    throw new Error(
      `Expected task run ${taskRunId} status ${expected}, got ${taskRun?.status ?? '<missing>'}`,
    );
  }
}

function assertTaskStateEvent(
  events: readonly RuntimeEvent[],
  assertion: Extract<ScenarioAssertion, { kind: 'taskStateEvent' }>,
): void {
  const found = events.find((event) => {
    if (event.type !== 'task.state.changed') return false;
    const payload = event.payload as Record<string, unknown> | undefined;
    return payload?.taskRunId === assertion.taskRunId && payload?.next === assertion.next;
  });
  if (!found) {
    throw new Error(`Missing task.state.changed for ${assertion.taskRunId} → ${assertion.next}`);
  }
}

async function assertInteractionHistory(
  repos: RuntimeRepositories,
  threadId: string,
  assertion: Extract<ScenarioAssertion, { kind: 'interactionHistoryContains' }>,
): Promise<void> {
  const rows = await repos.interactionHistory.listByThread(threadId);
  const found = rows.find((row) => {
    if (row.kind !== assertion.interactionKind) return false;
    if (assertion.selectedOptionId && row.selected_option_id !== assertion.selectedOptionId)
      return false;
    if (assertion.status && row.status !== assertion.status) return false;
    if (assertion.payloadType) {
      const payloadType = extractInteractionPayloadType(row);
      if (payloadType !== assertion.payloadType) return false;
    }
    return true;
  });
  if (!found) throw new Error(`Missing interaction history row for ${assertion.interactionKind}`);
}

async function assertNoEmployeeAfterCancel(ctx: ScenarioAssertionContext): Promise<void> {
  const rows = await ctx.repos.taskRuns.findByThread(ctx.threadId);
  const nonCancelled = rows.filter((row) => row.status !== 'cancelled');
  if (nonCancelled.length > 0) {
    throw new Error(`Expected no task runs after cancel, got ${nonCancelled.length}`);
  }
}

async function assertMcpAudit(
  repos: RuntimeRepositories,
  threadId: string,
  assertion: Extract<ScenarioAssertion, { kind: 'mcpAuditContains' }>,
): Promise<void> {
  const rows = await repos.mcpAudit.listByThread(threadId);
  const found = rows.find((row) => {
    if (row.tool_name !== assertion.toolName) return false;
    if (assertion.approvedBy && row.approved_by !== assertion.approvedBy) return false;
    if (assertion.errorIncludes && !row.error?.includes(assertion.errorIncludes)) return false;
    return true;
  });
  if (!found) throw new Error(`Missing MCP audit for ${assertion.toolName}`);
}

function assertToolExecutions(toolExecutions: readonly unknown[], expected: number): void {
  if (toolExecutions.length !== expected) {
    throw new Error(`Expected ${expected} tool executions, got ${toolExecutions.length}`);
  }
}

async function assertLlmCalls(
  repos: RuntimeRepositories,
  threadId: string,
  expected: number,
): Promise<void> {
  const calls = await repos.llmCalls.findByThread(threadId);
  if (calls.length !== expected) {
    throw new Error(`Expected ${expected} LLM calls, got ${calls.length}`);
  }
}

function assertToolPermissionApprovalConsumed(
  repos: RuntimeRepositories & { snapshot?: () => unknown },
  threadId: string,
  scope: 'once' | 'thread',
): void {
  const snapshot = repos.snapshot?.() as { toolPermissionApprovals?: unknown } | undefined;
  const rows = Array.isArray(snapshot?.toolPermissionApprovals)
    ? (snapshot.toolPermissionApprovals as Array<Record<string, unknown>>)
    : [];
  const found = rows.find((row) => row.thread_id === threadId && row.scope === scope);
  if (!found) throw new Error(`Missing ${scope} tool permission approval`);
  if (scope === 'once' && !found.consumed_at) throw new Error('Once approval was not consumed');
}

function assertFinalOutputContains(finalState: Partial<OffisimGraphState>, contains: string): void {
  const contents = (finalState.currentStepOutputs ?? [])
    .map((output) => output.content)
    .concat(
      (finalState.stepResults ?? []).flatMap((step) =>
        step.outputs.map((output) => output.content),
      ),
    );
  if (!contents.some((content) => content.includes(contains))) {
    throw new Error(`Final outputs do not contain "${contains}"`);
  }
}

function assertInterruptReasonIncludes(
  finalState: Partial<OffisimGraphState>,
  contains: string,
): void {
  if (!finalState.interruptReason?.includes(contains)) {
    throw new Error(`Interrupt reason does not contain "${contains}"`);
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractInteractionPayloadType(row: {
  payload_json: string | null;
  request_json: string | null;
}): unknown {
  const payload = parseJson(row.payload_json);
  if (payload && typeof payload === 'object') {
    return (payload as { type?: unknown }).type;
  }
  const request = parseJson(row.request_json);
  if (!request || typeof request !== 'object') return undefined;
  const context = (request as { context?: unknown }).context;
  if (!context || typeof context !== 'object') return undefined;
  return (context as { type?: unknown }).type;
}

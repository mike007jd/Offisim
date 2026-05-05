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
  | { readonly kind: 'taskRunsExcludeEmployee'; readonly employeeId: string }
  | { readonly kind: 'taskStateEvent'; readonly taskRunId: string; readonly next: string }
  | {
      readonly kind: 'interactionHistoryContains';
      readonly interactionKind: string;
      readonly selectedOptionId?: string;
      readonly status?: string;
      readonly payloadType?: string;
    }
  | {
      readonly kind: 'interactionHistoryCount';
      readonly interactionKind: string;
      readonly count: number;
    }
  | {
      readonly kind: 'skillFrontmatterInteraction';
      readonly reason: string;
      readonly count?: number;
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
      readonly sequence: readonly KanbanEventExpectation[];
    }
  | {
      readonly kind: 'kanbanRejectsTransition';
      readonly cardId: string;
      readonly next: KanbanState;
      readonly errorIncludes?: string;
    }
  | {
      readonly kind: 'kanbanRejectsStaleTransition';
      readonly cardId: string;
      readonly projectId: string;
      readonly firstNext: KanbanState;
      readonly secondNext: KanbanState;
      readonly errorIncludes?: string;
    }
  | { readonly kind: 'toolPermissionApprovalConsumed'; readonly scope: 'once' | 'thread' }
  | { readonly kind: 'finalOutputContains'; readonly contains: string }
  | { readonly kind: 'finalOutputNotContains'; readonly contains: string }
  | {
      readonly kind: 'graphStateArrayEquals';
      readonly field:
        | 'recentToolResults'
        | 'pendingAssignments'
        | 'dispatchedStepIndices'
        | 'completedStepIndices'
        | 'blockedStepIndices';
      readonly value: readonly unknown[];
    }
  | {
      readonly kind: 'graphStateArrayIncludes';
      readonly field: 'dispatchedStepIndices' | 'completedStepIndices' | 'blockedStepIndices';
      readonly value: number;
    }
  | {
      readonly kind: 'graphStateArrayExcludes';
      readonly field: 'dispatchedStepIndices' | 'completedStepIndices' | 'blockedStepIndices';
      readonly value: number;
    }
  | { readonly kind: 'agentEventPayloadContains'; readonly contains: string }
  | { readonly kind: 'interruptReasonIncludes'; readonly contains: string }
  | {
      /**
       * Assert at least `count` events of `eventType` exist in the runtime
       * trace, optionally with each matching event payload satisfying the
       * `payloadEquals` shallow shape. `count` defaults to 1; pass an exact
       * integer to assert "exactly N" (the assertion fails if more/fewer fire).
       */
      readonly kind: 'eventEmitted';
      readonly eventType: string;
      readonly payloadEquals?: Readonly<Record<string, unknown>>;
      readonly count?: number;
    }
  | {
      /** Inverse of `eventEmitted` — fails if any event of `eventType` exists. */
      readonly kind: 'eventNotEmitted';
      readonly eventType: string;
    }
  | {
      /**
       * Assert a top-level field on the final OffisimGraphState matches via
       * deep equality. Currently scoped to the `taskToolIntent` field, which
       * is the only structured-record field new scenarios need to inspect.
       */
      readonly kind: 'taskToolIntentEquals';
      readonly value: Readonly<Record<string, unknown>>;
    };

export interface ScenarioAssertionContext {
  readonly scenarioId: string;
  readonly finalState: Partial<OffisimGraphState>;
  readonly repos: RuntimeRepositories & { snapshot?: () => unknown };
  readonly threadId: string;
  readonly toolExecutions: readonly unknown[];
  readonly events: readonly RuntimeEvent[];
}

type KanbanEventExpectation =
  | string
  | {
      readonly op: string;
      readonly state: KanbanState;
      readonly cardId?: string;
      readonly blockedReason?: string | null;
    };

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
    case 'taskRunsExcludeEmployee':
      return assertTaskRunsExcludeEmployee(ctx.repos, ctx.threadId, assertion.employeeId);
    case 'taskStateEvent':
      return assertTaskStateEvent(ctx.events, assertion);
    case 'interactionHistoryContains':
      return assertInteractionHistory(ctx.repos, ctx.threadId, assertion);
    case 'interactionHistoryCount':
      return assertInteractionHistoryCount(ctx.repos, ctx.threadId, assertion);
    case 'skillFrontmatterInteraction':
      return assertSkillFrontmatterInteraction(ctx.repos, ctx.threadId, assertion);
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
    case 'kanbanRejectsTransition':
      return assertKanbanRejectsTransition(ctx.repos, assertion);
    case 'kanbanRejectsStaleTransition':
      return assertKanbanRejectsStaleTransition(ctx.repos, assertion);
    case 'toolPermissionApprovalConsumed':
      return assertToolPermissionApprovalConsumed(ctx.repos, ctx.threadId, assertion.scope);
    case 'finalOutputContains':
      return assertFinalOutputContains(ctx.finalState, assertion.contains);
    case 'finalOutputNotContains':
      return assertFinalOutputNotContains(ctx.finalState, assertion.contains);
    case 'graphStateArrayEquals':
      return assertGraphStateArrayEquals(ctx.finalState, assertion.field, assertion.value);
    case 'graphStateArrayIncludes':
      return assertGraphStateArrayIncludes(ctx.finalState, assertion.field, assertion.value);
    case 'graphStateArrayExcludes':
      return assertGraphStateArrayExcludes(ctx.finalState, assertion.field, assertion.value);
    case 'agentEventPayloadContains':
      return assertAgentEventPayloadContains(ctx.repos, ctx.threadId, assertion.contains);
    case 'interruptReasonIncludes':
      return assertInterruptReasonIncludes(ctx.finalState, assertion.contains);
    case 'eventEmitted':
      return assertEventEmitted(ctx.events, assertion);
    case 'eventNotEmitted':
      return assertEventNotEmitted(ctx.events, assertion.eventType);
    case 'taskToolIntentEquals':
      return assertTaskToolIntentEquals(ctx.finalState, assertion.value);
  }
}

function payloadShallowMatches(
  payload: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (record[key] !== value) return false;
  }
  return true;
}

function assertEventEmitted(
  events: readonly RuntimeEvent[],
  assertion: Extract<ScenarioAssertion, { kind: 'eventEmitted' }>,
): void {
  const matches = events.filter((event) => {
    if (event.type !== assertion.eventType) return false;
    if (!assertion.payloadEquals) return true;
    return payloadShallowMatches(event.payload, assertion.payloadEquals);
  });
  if (assertion.count !== undefined) {
    if (matches.length !== assertion.count) {
      throw new Error(
        `Expected exactly ${assertion.count} ${assertion.eventType} event(s)${
          assertion.payloadEquals ? ` with payload ${JSON.stringify(assertion.payloadEquals)}` : ''
        }, got ${matches.length}`,
      );
    }
    return;
  }
  if (matches.length === 0) {
    throw new Error(
      `Expected at least one ${assertion.eventType} event${
        assertion.payloadEquals ? ` with payload ${JSON.stringify(assertion.payloadEquals)}` : ''
      }, found none`,
    );
  }
}

function assertEventNotEmitted(events: readonly RuntimeEvent[], eventType: string): void {
  const found = events.some((event) => event.type === eventType);
  if (found) {
    throw new Error(`Expected no ${eventType} events; got at least one`);
  }
}

function assertTaskToolIntentEquals(
  finalState: Partial<OffisimGraphState>,
  expected: Readonly<Record<string, unknown>>,
): void {
  const actual = finalState.taskToolIntent;
  if (!actual) {
    throw new Error(`Expected taskToolIntent to equal ${JSON.stringify(expected)}, got null`);
  }
  const actualRecord = actual as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (actualRecord[key] !== value) {
      throw new Error(
        `Expected taskToolIntent.${key}=${JSON.stringify(value)}, got ${JSON.stringify(actualRecord[key])}`,
      );
    }
  }
}

async function assertKanbanRejectsTransition(
  repos: RuntimeRepositories,
  assertion: Extract<ScenarioAssertion, { kind: 'kanbanRejectsTransition' }>,
): Promise<void> {
  try {
    await repos.kanban.transition(assertion.cardId, assertion.next, 'illegal transition scenario');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (assertion.errorIncludes && !message.includes(assertion.errorIncludes)) {
      throw new Error(
        `Expected kanban error to include ${assertion.errorIncludes}, got ${message}`,
      );
    }
    return;
  }
  throw new Error(`Expected kanban transition to ${assertion.next} to throw`);
}

async function assertKanbanRejectsStaleTransition(
  repos: RuntimeRepositories,
  assertion: Extract<ScenarioAssertion, { kind: 'kanbanRejectsStaleTransition' }>,
): Promise<void> {
  const results = await Promise.allSettled([
    repos.kanban.transition(assertion.cardId, assertion.firstNext, 'first stale transition'),
    repos.kanban.transition(assertion.cardId, assertion.secondNext, 'second stale transition'),
  ]);
  const successes = results.filter(
    (
      result,
    ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof repos.kanban.transition>>> =>
      result.status === 'fulfilled' && result.value !== null,
  );
  const staleFailures = results.filter((result) => {
    if (result.status !== 'rejected') return false;
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return assertion.errorIncludes
      ? message.includes(assertion.errorIncludes)
      : message.includes('Kanban transition stale');
  });
  if (successes.length !== 1 || staleFailures.length !== 1) {
    throw new Error(
      `Expected one successful transition and one stale rejection, got ${results
        .map((result) =>
          result.status === 'fulfilled'
            ? `fulfilled:${result.value?.state ?? '<null>'}`
            : `rejected:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        )
        .join(', ')}`,
    );
  }

  const cards = await repos.kanban.listByProject(assertion.projectId);
  const card = cards.find((candidate) => candidate.id === assertion.cardId);
  if (!card) throw new Error(`Expected kanban card ${assertion.cardId} to still exist`);
  if (card.state === 'todo') throw new Error('Expected stale transition race to move out of todo');
  if (card.state !== assertion.firstNext && card.state !== assertion.secondNext) {
    throw new Error(
      `Expected final state to be ${assertion.firstNext} or ${assertion.secondNext}, got ${card.state}`,
    );
  }
}

function assertGraphStateArrayEquals(
  finalState: Partial<OffisimGraphState>,
  field: Extract<ScenarioAssertion, { kind: 'graphStateArrayEquals' }>['field'],
  expected: readonly unknown[],
): void {
  const actual = finalState[field] ?? [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertGraphStateArrayIncludes(
  finalState: Partial<OffisimGraphState>,
  field: Extract<ScenarioAssertion, { kind: 'graphStateArrayIncludes' }>['field'],
  expected: number,
): void {
  const actual = finalState[field] ?? [];
  if (!actual.includes(expected)) {
    throw new Error(`Expected ${field} to include ${expected}, got ${JSON.stringify(actual)}`);
  }
}

function assertGraphStateArrayExcludes(
  finalState: Partial<OffisimGraphState>,
  field: Extract<ScenarioAssertion, { kind: 'graphStateArrayExcludes' }>['field'],
  expected: number,
): void {
  const actual = finalState[field] ?? [];
  if (actual.includes(expected)) {
    throw new Error(`Expected ${field} to exclude ${expected}, got ${JSON.stringify(actual)}`);
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
  expected: readonly KanbanEventExpectation[],
): void {
  const actual = events
    .map((event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== 'object') return null;
      const record = payload as {
        kind?: unknown;
        op?: unknown;
        card?: { id?: unknown; state?: unknown; blocked_reason?: unknown };
      };
      if (record.kind !== 'kanban' || typeof record.op !== 'string') return null;
      return {
        op: record.op,
        state: String(record.card?.state ?? '<missing>'),
        cardId: typeof record.card?.id === 'string' ? record.card.id : undefined,
        blockedReason:
          typeof record.card?.blocked_reason === 'string' || record.card?.blocked_reason === null
            ? record.card.blocked_reason
            : undefined,
      };
    })
    .filter((entry): entry is NormalizedKanbanEvent => entry !== null);
  if (
    actual.length !== expected.length ||
    expected.some((entry, index) => !matchesKanbanEventExpectation(actual[index], entry))
  ) {
    throw new Error(
      `Kanban event sequence mismatch. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
}

interface NormalizedKanbanEvent {
  readonly op: string;
  readonly state: string;
  readonly cardId: string | undefined;
  readonly blockedReason: string | null | undefined;
}

function matchesKanbanEventExpectation(
  actual: NormalizedKanbanEvent | undefined,
  expected: KanbanEventExpectation,
): boolean {
  if (!actual) return false;
  if (typeof expected === 'string') {
    return `${actual.op}:${actual.state}` === expected;
  }
  if (actual.op !== expected.op || actual.state !== expected.state) return false;
  if (expected.cardId !== undefined && actual.cardId !== expected.cardId) return false;
  if (expected.blockedReason !== undefined && actual.blockedReason !== expected.blockedReason) {
    return false;
  }
  return true;
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

async function assertTaskRunsExcludeEmployee(
  repos: RuntimeRepositories,
  threadId: string,
  employeeId: string,
): Promise<void> {
  const taskRuns = await repos.taskRuns.findByThread(threadId);
  const matching = taskRuns.filter((taskRun) => taskRun.employee_id === employeeId);
  if (matching.length > 0) {
    throw new Error(
      `Expected no task runs for employee ${employeeId}, found ${matching
        .map((taskRun) => taskRun.task_run_id)
        .join(', ')}`,
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

async function assertInteractionHistoryCount(
  repos: RuntimeRepositories,
  threadId: string,
  assertion: Extract<ScenarioAssertion, { kind: 'interactionHistoryCount' }>,
): Promise<void> {
  const rows = await repos.interactionHistory.listByThread(threadId);
  const count = rows.filter((row) => row.kind === assertion.interactionKind).length;
  if (count !== assertion.count) {
    throw new Error(
      `Expected ${assertion.count} interaction history row(s) for ${assertion.interactionKind}, got ${count}`,
    );
  }
}

async function assertSkillFrontmatterInteraction(
  repos: RuntimeRepositories,
  threadId: string,
  assertion: Extract<ScenarioAssertion, { kind: 'skillFrontmatterInteraction' }>,
): Promise<void> {
  const rows = await repos.interactionHistory.listByThread(threadId);
  const matches = rows.filter((row) => {
    if (row.kind !== 'skill_install_confirm') return false;
    const request = parseJson(row.request_json);
    if (!request || typeof request !== 'object') return false;
    const context = (request as { context?: unknown }).context;
    if (!context || typeof context !== 'object') return false;
    const frontmatterError = (context as { frontmatterError?: unknown }).frontmatterError;
    if (!frontmatterError || typeof frontmatterError !== 'object') return false;
    return (frontmatterError as { reason?: unknown }).reason === assertion.reason;
  });
  const expected = assertion.count ?? 1;
  if (matches.length !== expected) {
    throw new Error(
      `Expected ${expected} skill frontmatter interaction(s) with reason ${assertion.reason}, got ${matches.length}`,
    );
  }
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
  const contents = finalTextContents(finalState);
  if (!contents.some((content) => content.includes(contains))) {
    throw new Error(`Final outputs do not contain "${contains}"`);
  }
}

function assertFinalOutputNotContains(
  finalState: Partial<OffisimGraphState>,
  contains: string,
): void {
  const contents = finalTextContents(finalState);
  if (contents.some((content) => content.includes(contains))) {
    throw new Error(`Final outputs unexpectedly contain "${contains}"`);
  }
}

async function assertAgentEventPayloadContains(
  repos: RuntimeRepositories,
  threadId: string,
  contains: string,
): Promise<void> {
  const rows = (await repos.agentEvents?.findByThread(threadId, { limit: 100 })) ?? [];
  const found = rows.some((row) => row.payload_json?.includes(contains));
  if (!found) throw new Error(`Agent event payloads do not contain "${contains}"`);
}

function assertInterruptReasonIncludes(
  finalState: Partial<OffisimGraphState>,
  contains: string,
): void {
  if (!finalState.interruptReason?.includes(contains)) {
    throw new Error(`Interrupt reason does not contain "${contains}"`);
  }
}

function finalTextContents(finalState: Partial<OffisimGraphState>): string[] {
  const messageContents = (finalState.messages ?? [])
    .map((message) => (typeof message.content === 'string' ? message.content : null))
    .filter((content): content is string => content !== null);
  return (finalState.currentStepOutputs ?? [])
    .map((output) => output.content)
    .concat(
      (finalState.stepResults ?? []).flatMap((step) =>
        step.outputs.map((output) => output.content),
      ),
    )
    .concat(messageContents);
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

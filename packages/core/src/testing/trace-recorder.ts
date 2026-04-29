import type { RuntimeEvent } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { OffisimGraphState } from '../graph/state.js';
import type { RuntimeRepositories } from '../runtime/repositories.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Text } from './hash.js';

const STABLE_ENTITY_ID = /^(scenario-|thread-|company-|emp-|task-|tr-)/u;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const GENERATED_ID_PATTERN = /\b(plan|tr|ma|ix|ixh|del|ae)-<uuid>\b/gu;
const ZEROED_NUMBER_KEY = /timestamp|createdAt|respondedAt|latency|duration/i;
const GENERATED_ID_KEY = /(^|_)(id|Id)$/u;
const TIME_KEYS = new Set([
  'created_at',
  'updated_at',
  'started_at',
  'finished_at',
  'completed_at',
  'resolved_at',
  'responded_at',
  'consumed_at',
  'expires_at',
  'createdAt',
  'updatedAt',
  'startedAt',
  'finishedAt',
  'completedAt',
  'resolvedAt',
  'respondedAt',
]);

export interface ScenarioAssertionReport {
  readonly kind: string;
  readonly passed: boolean;
  readonly message?: string;
}

export interface ScenarioTraceReport {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly traceHash: string;
  readonly assertions: readonly ScenarioAssertionReport[];
  readonly trace: {
    readonly events: readonly unknown[];
    readonly db: Record<string, unknown>;
    readonly finalState: Record<string, unknown>;
  };
}

export class TraceRecorder {
  readonly events: RuntimeEvent[] = [];
  private readonly unsubscribe?: () => void;

  constructor(eventBus?: EventBus) {
    this.unsubscribe = eventBus?.on('', (event) => {
      this.events.push(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  async hash(): Promise<string> {
    return sha256Text(canonicalJson(this.events.map(normalizeRuntimeEvent)));
  }

  async snapshotRepos(
    repos: RuntimeRepositories & { snapshot?: () => unknown },
    threadId: string,
  ): Promise<Record<string, unknown>> {
    const snapshot = repos.snapshot?.() as
      | {
          taskRuns?: unknown;
          kanbanCards?: unknown;
          activeInteractions?: unknown;
          toolPermissionApprovals?: unknown;
        }
      | undefined;
    return {
      taskRuns: normalizeRows(filterByThread(snapshot?.taskRuns, threadId)),
      kanbanCards: normalizeRows(snapshotRows(snapshot?.kanbanCards)),
      llmCalls: normalizeRows(await repos.llmCalls.findByThread(threadId)),
      mcpAudit: normalizeRows(await repos.mcpAudit.listByThread(threadId)),
      activeInteractions: normalizeRows(filterByThread(snapshot?.activeInteractions, threadId)),
      interactionHistory: normalizeRows(await repos.interactionHistory.listByThread(threadId)),
      toolPermissionApprovals: normalizeRows(
        filterByThread(snapshot?.toolPermissionApprovals, threadId),
      ),
    };
  }

  async report(params: {
    readonly scenarioId: string;
    readonly passed: boolean;
    readonly assertions: readonly ScenarioAssertionReport[];
    readonly repos: RuntimeRepositories & { snapshot?: () => unknown };
    readonly threadId: string;
    readonly finalState: Partial<OffisimGraphState>;
  }): Promise<ScenarioTraceReport> {
    const trace = {
      events: this.events.map(normalizeRuntimeEvent),
      db: await this.snapshotRepos(params.repos, params.threadId),
      finalState: normalizeFinalState(params.finalState),
    };
    return {
      scenarioId: params.scenarioId,
      passed: params.passed,
      traceHash: await sha256Text(canonicalJson(trace)),
      assertions: params.assertions,
      trace,
    };
  }
}

function normalizeRuntimeEvent(event: RuntimeEvent): unknown {
  return normalizeDynamicValues({
    type: event.type,
    companyId: event.companyId,
    threadId: event.threadId ?? null,
    payload: event.payload,
  });
}

function normalizeFinalState(state: Partial<OffisimGraphState>): Record<string, unknown> {
  return normalizeDynamicValues({
    completed: state.completed ?? false,
    interruptReason: state.interruptReason ?? null,
    taskPlan: state.taskPlan ?? null,
    pendingAssignments: state.pendingAssignments ?? [],
    stepResults: state.stepResults ?? [],
    completedStepIndices: state.completedStepIndices ?? [],
    blockedStepIndices: state.blockedStepIndices ?? [],
    currentStepOutputs: state.currentStepOutputs ?? [],
  }) as Record<string, unknown>;
}

function snapshotRows(rows: unknown): unknown[] {
  return Array.isArray(rows) ? rows : [];
}

function filterByThread(rows: unknown, threadId: string): unknown[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const candidate = row as Record<string, unknown>;
    return candidate.thread_id === threadId || candidate.threadId === threadId;
  });
}

function normalizeRows(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => normalizeDynamicValues(row));
}

function normalizeDynamicValues(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeDynamicValues(item, key));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'number' && ZEROED_NUMBER_KEY.test(key)) {
      return 0;
    }
    if (typeof value === 'string') return normalizeString(value, key);
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (isTimeKey(childKey)) {
      normalized[childKey] = '<time>';
      continue;
    }
    if (/^(latency_ms|durationMs|timestamp)$/u.test(childKey)) {
      normalized[childKey] = 0;
      continue;
    }
    normalized[childKey] = normalizeDynamicValues(childValue, childKey);
  }
  return normalized;
}

function normalizeString(value: string, key: string): string {
  if (key.endsWith('_json')) {
    try {
      return canonicalJson(normalizeDynamicValues(JSON.parse(value), key));
    } catch {
      // Fall through for non-JSON strings.
    }
  }
  if (/^(companyId|company_id|threadId|thread_id|employeeId|employee_id)$/u.test(key)) {
    return value;
  }
  if (/_hash$/iu.test(key) && value.startsWith('sha256:')) {
    return '<hash>';
  }
  if (GENERATED_ID_KEY.test(key) && !STABLE_ENTITY_ID.test(value)) {
    return '<id>';
  }
  return value.replace(UUID_PATTERN, '<uuid>').replace(GENERATED_ID_PATTERN, '$1-<id>');
}

function isTimeKey(key: string): boolean {
  return TIME_KEYS.has(key);
}

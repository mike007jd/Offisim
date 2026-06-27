/**
 * Pure reconstruction of a run's semantic state from its {@link AgentRunEvent}
 * stream — the reference projection for the neutral event contract.
 *
 * Given an ordered event stream this rebuilds, with no out-of-band ordering and
 * no renderer/animation concepts:
 *  - the run tree (parent/child via `runId` / `parentRunId`),
 *  - each run's status, objective, work kind, and result summary,
 *  - the currently-active employee states (working / waiting),
 *  - the tool/activity timeline (with a tool-fact-derived {@link ActivityKind}),
 *  - artifacts, approval requests, and the terminal status.
 *
 * Team-conversation roots stay invisible: a run with no `employeeId` is a
 * director/control process and never appears as an actor in `employeeStates`.
 */
import {
  type ActivityKind,
  type AgentRunAccess,
  type AgentRunEvent,
  type AgentRunRelation,
  type AgentRunStatus,
  type WorkKind,
  classifyToolActivity,
} from './agent-run.js';

export interface AgentRunNode {
  // Scope is set once at first sight; the rest accumulates as events arrive.
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly rootRunId: string;
  readonly employeeId: string | null;
  readonly relation: AgentRunRelation | null;
  readonly workKind: WorkKind | null;
  objective: string | null;
  access: AgentRunAccess | null;
  status: AgentRunStatus;
  summary: string | null;
  /** Whether an approval is currently outstanding on this run. */
  awaitingApproval: boolean;
  readonly childRunIds: string[];
}

/** An active actor's state. Idle employees are simply absent (not enumerated). */
export interface EmployeeStateEntry {
  readonly employeeId: string;
  readonly state: 'working' | 'waiting';
  readonly runId: string;
}

export interface ActivityEntry {
  /** Stream position — preserves timeline order without per-event timestamps. */
  readonly index: number;
  readonly runId: string;
  readonly employeeId: string | null;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly activityKind: ActivityKind;
  readonly status: 'started' | 'completed' | 'failed';
}

export interface ArtifactEntry {
  readonly runId: string;
  readonly employeeId: string | null;
  readonly title: string;
  readonly ref: string | null;
}

export interface ApprovalEntry {
  readonly runId: string;
  readonly employeeId: string | null;
  readonly uiRequestId: string;
  readonly title: string;
  readonly message: string | null;
}

export interface AgentRunProjection {
  readonly threadId: string | null;
  readonly rootRunId: string | null;
  readonly runs: readonly AgentRunNode[];
  readonly runsById: Record<string, AgentRunNode>;
  /** Top-of-forest runs: no parent, or a parent not present in the stream. */
  readonly rootRunIds: readonly string[];
  readonly employeeStates: readonly EmployeeStateEntry[];
  readonly activity: readonly ActivityEntry[];
  readonly artifacts: readonly ArtifactEntry[];
  readonly approvals: readonly ApprovalEntry[];
  /** Terminal status of the run identified by `rootRunId`, or null if unknown / still running. */
  readonly terminalStatus: AgentRunStatus | null;
}

function ensureNode(
  runsById: Map<string, AgentRunNode>,
  order: string[],
  event: AgentRunEvent,
): AgentRunNode {
  const existing = runsById.get(event.runId);
  if (existing) return existing;
  const node: AgentRunNode = {
    runId: event.runId,
    parentRunId: event.parentRunId ?? null,
    rootRunId: event.rootRunId,
    employeeId: event.employeeId ?? null,
    relation: event.relation ?? null,
    workKind: event.workKind ?? null,
    objective: null,
    access: null,
    status: 'running',
    summary: null,
    awaitingApproval: false,
    childRunIds: [],
  };
  runsById.set(node.runId, node);
  order.push(node.runId);
  return node;
}

export function projectAgentRun(events: readonly AgentRunEvent[]): AgentRunProjection {
  const runsById = new Map<string, AgentRunNode>();
  const order: string[] = [];
  const activity: ActivityEntry[] = [];
  const artifacts: ArtifactEntry[] = [];
  const approvals: ApprovalEntry[] = [];
  let threadId: string | null = null;
  let rootRunId: string | null = null;

  for (const event of events) {
    threadId ??= event.threadId;
    rootRunId ??= event.rootRunId;
    const node = ensureNode(runsById, order, event);

    switch (event.type) {
      case 'run.started': {
        // `ensureNode` seeds scope; fill the started-only payload fields in place.
        node.objective = event.payload.objective;
        node.access = event.payload.access;
        break;
      }
      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled': {
        node.status = event.payload.status;
        node.summary = event.payload.summary ?? node.summary;
        node.awaitingApproval = false;
        break;
      }
      case 'tool.started':
      case 'tool.completed': {
        activity.push({
          index: activity.length,
          runId: node.runId,
          employeeId: node.employeeId,
          toolCallId: event.payload.toolCallId,
          toolName: event.payload.toolName,
          activityKind: event.payload.activityKind ?? classifyToolActivity(event.payload.toolName),
          status: event.payload.status,
        });
        break;
      }
      case 'artifact.created': {
        artifacts.push({
          runId: node.runId,
          employeeId: node.employeeId,
          title: event.payload.title,
          ref: event.payload.ref ?? null,
        });
        break;
      }
      case 'approval.requested': {
        node.awaitingApproval = true;
        approvals.push({
          runId: node.runId,
          employeeId: node.employeeId,
          uiRequestId: event.payload.uiRequestId,
          title: event.payload.title,
          message: event.payload.message ?? null,
        });
        break;
      }
      case 'run.delta':
        break;
    }
  }

  // Single post-pass over the stable insertion order: link children to parents,
  // collect forest roots, gather the runs list, and enumerate active actors —
  // a director root (no employeeId) is never an actor.
  const rootRunIds: string[] = [];
  const runs: AgentRunNode[] = [];
  const employeeStates: EmployeeStateEntry[] = [];
  for (const runId of order) {
    const node = runsById.get(runId);
    if (!node) continue;
    runs.push(node);
    const parent = node.parentRunId ? runsById.get(node.parentRunId) : undefined;
    if (parent) parent.childRunIds.push(runId);
    else rootRunIds.push(runId);
    if (node.status === 'running' && node.employeeId) {
      employeeStates.push({
        employeeId: node.employeeId,
        state: node.awaitingApproval ? 'waiting' : 'working',
        runId: node.runId,
      });
    }
  }

  const rootNode = rootRunId ? runsById.get(rootRunId) : undefined;
  const terminalStatus = rootNode && rootNode.status !== 'running' ? rootNode.status : null;

  return {
    threadId,
    rootRunId,
    runs,
    runsById: Object.fromEntries(runsById),
    rootRunIds,
    employeeStates,
    activity,
    artifacts,
    approvals,
    terminalStatus,
  };
}

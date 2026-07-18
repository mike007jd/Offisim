// Pi runtime driver boundary — the ONLY place in the renderer that knows Pi wire
// shapes. The agent-agnostic gateway (DesktopAgentRuntime in
// desktop-agent-runtime.ts) is now runtime-neutral: it invokes the generic
// `agent_runtime_*` Tauri commands and consumes the typed events declared here.
// Pi-specific event/response/model shapes live behind this module so the gateway
// never names a backend. (RD-004 type confinement.)
// Adapter-private diagnostics may still expose Pi wire details, but ordinary
// product surfaces consume only the neutral AI Accounts / Models / Usage / Cost
// contracts and never use Pi as the product identity.

import type { TaskWorkspaceBindingClaim } from '@/lib/tauri-commands.js';
import type { AgentRunUsage, WorkspaceUnavailableProvenance } from '@offisim/shared-types';
import type { TurnExecutionProvenance } from './execution-provenance.js';

interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  catalogId?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

type PiExecutionProvenance = TurnExecutionProvenance;

export interface PiAgentHostResponse {
  text: string;
  reasoning?: string;
  sessionId?: string;
  sessionFile?: string;
  model?: PiAgentModelSummary;
  provenance?: PiExecutionProvenance;
  /** Root Pi session's own rolled-up usage; folded into the root agent_runs row
   *  by reconcileRoot (the solo path otherwise records no root usage). */
  usage?: AgentRunUsage;
  /** Root + delegated-tree usage for Mission budget enforcement. Not persisted
   *  as root usage because child rows are already rolled up separately. */
  budgetUsage?: AgentRunUsage;
}

export interface WorkspaceUnavailableEvent {
  kind: 'workspaceUnavailable';
  projectId: string;
  threadId: string;
  turnId: string;
  requestId: string;
  source: WorkspaceUnavailableProvenance['source'];
  reasonCode: WorkspaceUnavailableProvenance['reasonCode'];
}

export type PiAgentHostEvent =
  | {
      kind: 'executionPrepared';
      prepareId: string;
      runId: string;
      identity: TurnExecutionProvenance;
      targetDigest: string;
      adapter: { id: string; version: string };
    }
  | {
      kind: 'started';
      sessionId?: string;
      sessionFile?: string;
      model?: PiAgentModelSummary;
      modelFallbackMessage?: string;
    }
  | ({ kind: 'workspaceBound' } & TaskWorkspaceBindingClaim)
  | WorkspaceUnavailableEvent
  | { kind: 'messageDelta'; delta: string; channel?: 'content' | 'reasoning' }
  | { kind: 'messageEnd'; text: string; stopReason?: string; errorMessage?: string }
  | {
      kind: 'tool';
      status: 'started' | 'running' | 'completed' | 'failed';
      toolCallId: string;
      toolName: string;
      detail?: string;
      artifactPaths?: string[];
      durationMs?: number;
    }
  | {
      kind: 'uiRequest';
      id: string;
      method: string;
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      prefill?: string;
      params?: unknown;
    }
  | {
      kind: 'uiRequestResolved';
      id: string;
      resolution: 'answered' | 'cancelled' | 'timeout' | 'native';
    }
  | { kind: 'lifecycle'; event: string; payload: unknown }
  | {
      kind: 'agentRun';
      threadId: string;
      rootRunId: string;
      runId: string;
      parentRunId?: string;
      employeeId?: string;
      relation?: string;
      workKind?: string;
      runType: string;
      payload: unknown;
    }
  | { kind: 'result'; response: PiAgentHostResponse }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'streamCursor'; cursor: number };

// Wire-contract typecheck guard. These canonical events must stay assignable to
// PiAgentHostEvent; `satisfies` makes tsc fail here if the renderer union drifts
// from the camelCase wire contract shared with the Rust host (pi_agent_host/)
// and the Node emitter (scripts/pi-agent-host-wire.mjs). The runtime round-trip is
// gated by check:pi-wire-contract and the cargo fixture test.
void ([
  {
    kind: 'executionPrepared',
    prepareId: 'prepare-1',
    runId: 'run-1',
    identity: {
      engineId: 'api',
      accountId: 'api:provider:fingerprint',
      billingMode: 'api',
      modelId: 'maker/model',
      modelSource: {
        kind: 'official-api',
        sourceUrl: 'https://provider.example/models/maker/model',
        checkedAt: '2026-07-14T00:00:00Z',
      },
      runId: 'run-1',
      adapter: { id: 'pi-agent', version: '0.80.9' },
    },
    targetDigest: 'digest',
    adapter: { id: 'pi-agent', version: '0.80.9' },
  },
  { kind: 'started', sessionId: 's', sessionFile: '/f', modelFallbackMessage: 'm' },
  {
    kind: 'workspaceBound',
    workspaceRef: 'workspace-ref',
    historyId: 'workspace-history',
    companyId: 'company-1',
    projectId: 'project-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    access: 'write',
    source: 'project_catalog',
    confidence: 1,
    reasonCode: 'current_project_folder',
    issuedAtUnixMs: 1,
    expiresAtUnixMs: 2,
    displayPath: '~/project',
  },
  {
    kind: 'workspaceUnavailable',
    projectId: 'project-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    source: 'workspace_recovery',
    reasonCode: 'none',
  },
  { kind: 'messageDelta', delta: 'x', channel: 'content' },
  { kind: 'messageDelta', delta: 'r', channel: 'reasoning' },
  { kind: 'messageEnd', text: 't', stopReason: 'end_turn', errorMessage: 'e' },
  {
    kind: 'tool',
    status: 'completed',
    toolCallId: 'c',
    toolName: 'bash',
    detail: 'd',
    durationMs: 1,
  },
  {
    kind: 'uiRequest',
    id: 'ui-1',
    method: 'confirm',
    title: 'Approve command?',
    message: 'force-push\n\ngit push --force',
  },
  {
    kind: 'agentRun',
    threadId: 'th',
    rootRunId: 'attempt-1',
    runId: 'run-1',
    parentRunId: 'attempt-1',
    employeeId: 'emp-1',
    relation: 'delegate',
    workKind: 'research',
    runType: 'run.started',
    payload: { objective: 'scout', access: 'read' },
  },
  { kind: 'result', response: { text: 't', reasoning: 'r', sessionId: 's', sessionFile: '/f' } },
  { kind: 'error', code: 'upstream', message: 'm' },
  { kind: 'streamCursor', cursor: 1 },
] satisfies PiAgentHostEvent[]);

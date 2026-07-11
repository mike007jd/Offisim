// Pi runtime driver boundary — the ONLY place in the renderer that knows Pi wire
// shapes. The agent-agnostic gateway (DesktopAgentRuntime in
// desktop-agent-runtime.ts) is now runtime-neutral: it invokes the generic
// `agent_runtime_*` Tauri commands and consumes the typed events declared here.
// Pi-specific event/response/model shapes live behind this module so the gateway
// never names a backend. (RD-004 type confinement.)
//
// Note: the Settings > Pi Agent pane (PiAgentPane.tsx, usePiAgentModels.ts) stays
// intentionally Pi-specific — config-folder path and models.json are inherently
// Pi adapter concerns, so those surfaces keep calling the `pi_agent_*` commands
// directly and are NOT routed through this gateway boundary.

import type { AgentRunUsage } from '@offisim/shared-types';

interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

export interface PiAgentHostResponse {
  text: string;
  reasoning?: string;
  sessionId?: string;
  sessionFile?: string;
  model?: PiAgentModelSummary;
  /** Root Pi session's own rolled-up usage; folded into the root agent_runs row
   *  by reconcileRoot (the solo path otherwise records no root usage). */
  usage?: AgentRunUsage;
}

export type PiAgentHostEvent =
  | {
      kind: 'started';
      sessionId?: string;
      sessionFile?: string;
      model?: PiAgentModelSummary;
      modelFallbackMessage?: string;
    }
  | { kind: 'messageDelta'; delta: string; channel?: 'content' | 'reasoning' }
  | { kind: 'messageEnd'; text: string; stopReason?: string; errorMessage?: string }
  | {
      kind: 'tool';
      status: 'started' | 'running' | 'completed' | 'failed';
      toolCallId: string;
      toolName: string;
      detail?: string;
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
    }
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
  { kind: 'started', sessionId: 's', sessionFile: '/f', modelFallbackMessage: 'm' },
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

import type { RuntimeEvent } from '@offisim/shared-types';
import {
  WORKSPACE_DIAGNOSTICS_UPDATED_EVENT,
  type WorkspaceDiagnostic,
  type WorkspaceDiagnosticsUpdatedPayload,
} from '@offisim/shared-types';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from './mission/mission-events.js';

export const AGENT_LIFECYCLE_EVENT = 'agent.lifecycle';

export interface AgentLifecyclePayload {
  requestId: string;
  runId: string;
  event: string;
  data: Record<string, unknown>;
}

/** Event name for the agent's mid-run "ask the user something" bridge — shared by
 *  the producer (here) and the ConversationRunController consumer so the two
 *  can't drift on a typo. Backend-neutral on purpose: any agent that pauses to
 *  prompt the user (Pi today via `ctx.ui`, others later) routes through this. */
export const AGENT_UI_REQUEST_EVENT = 'agent.ui.request';
export const AGENT_UI_REQUEST_RESOLVED_EVENT = 'agent.ui.request.resolved';

/** Payload shape for the `agent.ui.request` renderer event. An agent paused
 *  mid-run and asked the user something (confirm / select / input / editor). The
 *  renderer needs `requestId` to route the answer back to the run's host and `id`
 *  to match the specific prompt. Mirrors a Pi extension-UI request, but the shape
 *  is generic so it isn't tied to any one backend. */
export interface AgentUiRequestPayload {
  engineId: string;
  requestId: string;
  runId: string;
  id: string;
  method: string;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  params?: unknown;
}

export interface AgentUiRequestResolvedPayload {
  engineId: string;
  requestId: string;
  runId: string;
  id: string;
  resolution: 'answered' | 'cancelled' | 'timeout' | 'native';
}

/** Build an `agent.ui.request` RuntimeEvent inline (no core event factory — this
 *  is a renderer-only host→UI bridge). Matches the envelope shape the core
 *  factories return so `runtimeEventBus.emit` typechecks against RuntimeEvent. */
export function agentUiRequestEvent(
  companyId: string,
  threadId: string,
  payload: AgentUiRequestPayload,
): RuntimeEvent<AgentUiRequestPayload> {
  return {
    type: AGENT_UI_REQUEST_EVENT,
    entityId: payload.id,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

export function agentUiRequestResolvedEvent(
  companyId: string,
  threadId: string,
  payload: AgentUiRequestResolvedPayload,
): RuntimeEvent<AgentUiRequestResolvedPayload> {
  return {
    type: AGENT_UI_REQUEST_RESOLVED_EVENT,
    entityId: payload.id,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

export function agentLifecycleEvent(
  companyId: string,
  threadId: string,
  payload: AgentLifecyclePayload,
): RuntimeEvent<AgentLifecyclePayload> {
  return {
    type: AGENT_LIFECYCLE_EVENT,
    entityId: payload.runId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

export function parseWorkspaceDiagnosticsPayload(
  value: unknown,
): Omit<WorkspaceDiagnosticsUpdatedPayload, 'requestId' | 'runId' | 'childRunId'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    return null;
  }
  if (
    typeof raw.languageId !== 'string' ||
    typeof raw.serverId !== 'string' ||
    raw.source !== 'lsp' ||
    !Number.isSafeInteger(raw.version) ||
    Number(raw.version) < 1 ||
    !Array.isArray(raw.diagnostics) ||
    raw.diagnostics.length > 50 ||
    typeof raw.message !== 'string' ||
    typeof raw.capturedAt !== 'string'
  ) {
    return null;
  }
  const diagnostics: WorkspaceDiagnostic[] = [];
  for (const candidate of raw.diagnostics) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const diagnostic = candidate as Record<string, unknown>;
    const severity = diagnostic.severity;
    const range = diagnostic.range;
    if (
      (severity !== 'error' &&
        severity !== 'warning' &&
        severity !== 'information' &&
        severity !== 'hint') ||
      typeof diagnostic.message !== 'string' ||
      !range ||
      typeof range !== 'object' ||
      Array.isArray(range)
    ) {
      return null;
    }
    const typedRange = range as Record<string, unknown>;
    const start = typedRange.start as Record<string, unknown> | undefined;
    const end = typedRange.end as Record<string, unknown> | undefined;
    if (
      !start ||
      !end ||
      !Number.isSafeInteger(start.line) ||
      !Number.isSafeInteger(start.column) ||
      !Number.isSafeInteger(end.line) ||
      !Number.isSafeInteger(end.column)
    ) {
      return null;
    }
    diagnostics.push({
      severity,
      message: diagnostic.message.slice(0, 1_200),
      ...(typeof diagnostic.code === 'string' ? { code: diagnostic.code.slice(0, 120) } : {}),
      ...(typeof diagnostic.source === 'string' ? { source: diagnostic.source.slice(0, 80) } : {}),
      range: {
        start: { line: Number(start.line), column: Number(start.column) },
        end: { line: Number(end.line), column: Number(end.column) },
      },
    });
  }
  const counts = { error: 0, warning: 0, information: 0, hint: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1;
  return {
    path,
    languageId: raw.languageId.slice(0, 80),
    serverId: raw.serverId.slice(0, 80),
    source: 'lsp',
    version: Number(raw.version),
    diagnostics,
    counts,
    message: raw.message.slice(0, 1_200),
    capturedAt: raw.capturedAt,
  };
}

export function workspaceDiagnosticsUpdatedEvent(
  companyId: string,
  threadId: string,
  payload: WorkspaceDiagnosticsUpdatedPayload,
): RuntimeEvent<WorkspaceDiagnosticsUpdatedPayload> {
  return {
    type: WORKSPACE_DIAGNOSTICS_UPDATED_EVENT,
    entityId: `${payload.runId}:${payload.path}`,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

/** Build a `mission.evaluation.submitted` RuntimeEvent inline (renderer-only
 *  host→controller bridge — no core factory), mirroring agentUiRequestEvent. */
export function missionEvaluationSubmittedEvent(
  companyId: string,
  threadId: string,
  payload: MissionEvaluationSubmittedPayload,
): RuntimeEvent<MissionEvaluationSubmittedPayload> {
  return {
    type: MISSION_EVALUATION_SUBMITTED_EVENT,
    entityId: payload.criterionId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

import { persistChatMessageWithRepositories } from '@/data/chat-message-events.js';
import type { ChatMessage } from '@/data/types.js';
import {
  type TaskWorkspaceBindingProjection,
  parseTaskWorkspaceBindingProjection,
} from '@/lib/tauri-commands.js';
import type { RuntimeRepositories } from '@offisim/core/browser';
import { isResettableNativeSessionPrestartCode } from '@offisim/core/browser';
import type { AiExecutionTarget, WorkspaceProvenance } from '@offisim/shared-types';
import type { PiAgentHostEvent } from './pi-runtime-driver.js';
import {
  validateExecutionTarget,
  type TurnExecutionProvenance,
} from './execution-provenance.js';
import { hostModelRef } from './execution-selection.js';
import { parseWorkspaceProvenance } from './workspace-provenance.js';
import type {
  CompetitiveDraftContext,
  ConversationRunProjectionRef,
  WorkspaceRequirement,
} from './desktop-agent-runtime.js';

export interface ConversationStreamCheckpoint {
  companyId: string;
  projectId: string | null;
  message: ChatMessage;
}

export interface PersistedRunContext {
  requestId?: string | null;
  streamCursor?: number | null;
  inFlightToolCallIds?: string[];
  workspaceBinding: TaskWorkspaceBindingProjection | null;
  workspaceRequirement: WorkspaceRequirement;
  workspaceAvailability: 'pending' | 'bound' | 'unavailable';
  workspaceProvenance?: WorkspaceProvenance;
  runtime: 'agent-runtime';
  executionTarget: AiExecutionTarget | null;
  piSdkVersion?: string;
  wireProtocolVersion?: number;
  nativeRuntimeVersion?: string;
  nativeProtocolVersion?: number;
  model: string | null;
  nativeSessionId?: string;
  nativeSessionPrestartErrorCode?: string;
  /** Reload recovery may reconstruct only an exact plain Conversation Turn. */
  recoveryLane?: 'conversation' | 'direct-delegation' | 'competitive-draft' | 'mission';
  competitiveDraft?: CompetitiveDraftContext;
  provenance: TurnExecutionProvenance | null;
  permissionMode: string;
  thinkingLevel: string | null;
  projectId: string | null;
  conversationProjection: ConversationRunProjectionRef | null;
  createdAt: string;
}

export function parseRunContext(
  raw: string | null | undefined,
): Partial<PersistedRunContext> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const workspaceBinding = parseTaskWorkspaceBindingProjection(parsed.workspaceBinding);
    const workspaceProvenance = parseWorkspaceProvenance(parsed.workspaceProvenance);
    const workspaceAvailability =
      parsed.workspaceAvailability === 'bound' && workspaceBinding
        ? 'bound'
        : parsed.workspaceAvailability === 'unavailable' &&
            workspaceProvenance?.availability === 'unavailable'
          ? 'unavailable'
          : 'pending';
    return {
      requestId: typeof parsed.requestId === 'string' ? parsed.requestId : null,
      streamCursor: typeof parsed.streamCursor === 'number' ? parsed.streamCursor : null,
      inFlightToolCallIds: Array.isArray(parsed.inFlightToolCallIds)
        ? parsed.inFlightToolCallIds.filter(
            (toolCallId): toolCallId is string =>
              typeof toolCallId === 'string' && Boolean(toolCallId.trim()),
          )
        : [],
      workspaceBinding,
      workspaceRequirement: parsed.workspaceRequirement === 'optional' ? 'optional' : 'required',
      workspaceAvailability,
      workspaceProvenance: workspaceProvenance ?? undefined,
      runtime: parsed.runtime === 'agent-runtime' ? 'agent-runtime' : undefined,
      executionTarget: validateExecutionTarget(parsed.executionTarget),
      piSdkVersion: typeof parsed.piSdkVersion === 'string' ? parsed.piSdkVersion : undefined,
      wireProtocolVersion:
        typeof parsed.wireProtocolVersion === 'number' ? parsed.wireProtocolVersion : undefined,
      nativeRuntimeVersion:
        typeof parsed.nativeRuntimeVersion === 'string' ? parsed.nativeRuntimeVersion : undefined,
      nativeProtocolVersion:
        typeof parsed.nativeProtocolVersion === 'number' ? parsed.nativeProtocolVersion : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : null,
      nativeSessionId:
        typeof parsed.nativeSessionId === 'string' && parsed.nativeSessionId.trim()
          ? parsed.nativeSessionId.trim()
          : undefined,
      nativeSessionPrestartErrorCode:
        typeof parsed.nativeSessionPrestartErrorCode === 'string' &&
        parsed.nativeSessionPrestartErrorCode.trim()
          ? parsed.nativeSessionPrestartErrorCode.trim()
          : undefined,
      recoveryLane:
        parsed.recoveryLane === 'conversation' ||
        parsed.recoveryLane === 'direct-delegation' ||
        parsed.recoveryLane === 'competitive-draft' ||
        parsed.recoveryLane === 'mission'
          ? parsed.recoveryLane
          : undefined,
      competitiveDraft:
        parsed.competitiveDraft && typeof parsed.competitiveDraft === 'object'
          ? (parsed.competitiveDraft as CompetitiveDraftContext)
          : undefined,
      provenance:
        parsed.provenance && typeof parsed.provenance === 'object'
          ? (parsed.provenance as TurnExecutionProvenance)
          : null,
      permissionMode: typeof parsed.permissionMode === 'string' ? parsed.permissionMode : undefined,
      thinkingLevel: typeof parsed.thinkingLevel === 'string' ? parsed.thinkingLevel : null,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      conversationProjection:
        parsed.conversationProjection &&
        typeof parsed.conversationProjection === 'object' &&
        typeof (parsed.conversationProjection as Record<string, unknown>).userMessageId ===
          'string' &&
        typeof (parsed.conversationProjection as Record<string, unknown>).assistantMessageId ===
          'string' &&
        ((parsed.conversationProjection as Record<string, unknown>).source === 'office' ||
          (parsed.conversationProjection as Record<string, unknown>).source === 'workspace')
          ? (parsed.conversationProjection as ConversationRunProjectionRef)
          : null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
    };
  } catch {
    return null;
  }
}

function runContextRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function mergeRunContextPreservingNativeIdentity(
  currentRaw: string | null | undefined,
  patch: Partial<PersistedRunContext>,
): Record<string, unknown> {
  const current = runContextRecord(currentRaw);
  const currentNativeSessionId = nonEmptyString(current.nativeSessionId);
  const patchNativeSessionId = nonEmptyString(patch.nativeSessionId);
  if (
    currentNativeSessionId &&
    patchNativeSessionId &&
    currentNativeSessionId !== patchNativeSessionId
  ) {
    throw new Error('Native Conversation session identity changed during durable persistence.');
  }
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  return { ...current, ...definedPatch };
}

class AgentHostCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentHostCommandError';
  }
}

/** Extract only the structured Tauri error prefix. Free-text provider messages
 * cannot authorize a native-session reset. */
export function nativeSessionPrestartCode(error: unknown): string | null {
  // Channel events are presentation telemetry and never authorize reset. Only
  // the final Tauri command rejection reaches this parser as a plain IPC error.
  if (error instanceof AgentHostCommandError) return null;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const separator = message.indexOf(':');
  if (separator <= 0) return null;
  const code = message.slice(0, separator).trim();
  return isResettableNativeSessionPrestartCode(code) ? code : null;
}

/** Host stream errors are untrusted provider/sidecar telemetry. Branding them
 * keeps forged reserved prefixes out of the Fresh-session authority path. */
export function nonAuthorizingAgentHostError(message: string): Error {
  return new AgentHostCommandError('channel', message);
}

export function trustedNativeSessionPrestartCode(
  error: unknown,
  nativeSessionStarted: boolean,
): string | null {
  return nativeSessionStarted ? null : nativeSessionPrestartCode(error);
}

export async function persistRunContextPatchWithRepositories(
  repos: RuntimeRepositories,
  runId: string,
  patch: Partial<PersistedRunContext>,
  options: {
    sessionFile?: string;
    conversationCheckpoint?: ConversationStreamCheckpoint;
  } = {},
): Promise<void> {
  let expectedContextJson: string | null = null;
  let expectedSessionFile: string | null = null;
  await repos.asyncTransact(async (transactionRepos) => {
    const tx = transactionRepos ?? repos;
    const current = await tx.agentRuns.findById(runId);
    if (!current) throw new Error(`Cannot update missing agent run ${runId}.`);
    const nextContext = mergeRunContextPreservingNativeIdentity(
      current.runtime_context_json,
      patch,
    );
    const nextContextJson = JSON.stringify(nextContext);
    const sessionFile = options.sessionFile?.trim();
    if (sessionFile && current.session_file?.trim() && current.session_file !== sessionFile) {
      throw new Error('Native Conversation session file changed during durable persistence.');
    }
    await Promise.all([
      tx.agentRuns.updateRuntimeContext(runId, nextContextJson),
      ...(sessionFile ? [tx.agentRuns.updateStatus(runId, 'running', { sessionFile })] : []),
      ...(options.conversationCheckpoint
        ? [
            persistChatMessageWithRepositories({
              message: options.conversationCheckpoint.message,
              companyId: options.conversationCheckpoint.companyId,
              projectId: options.conversationCheckpoint.projectId,
              repos: tx,
            }),
          ]
        : []),
    ]);
    expectedContextJson = nextContextJson;
    expectedSessionFile = sessionFile || null;
  });
  // Tauri's queued transaction adapter does not expose read-your-writes through
  // SELECT inside the callback. Read from the main repository only after the
  // transaction returned, which is the durable commit boundary.
  const readback = await repos.agentRuns.findById(runId);
  if (!readback || !expectedContextJson || readback.runtime_context_json !== expectedContextJson) {
    throw new Error('Agent run context durable readback did not match the committed update.');
  }
  if (expectedSessionFile && readback.session_file !== expectedSessionFile) {
    throw new Error('Native Conversation session file durable readback did not match.');
  }
  if (expectedSessionFile && readback.status !== 'running') {
    throw new Error('Native Conversation session checkpoint did not remain running.');
  }
  const expectedNativeSessionId = nonEmptyString(patch.nativeSessionId);
  if (
    expectedNativeSessionId &&
    nonEmptyString(runContextRecord(readback.runtime_context_json).nativeSessionId) !==
      expectedNativeSessionId
  ) {
    throw new Error('Native Conversation session id durable readback did not match.');
  }
}

/** Production Started checkpoint. File-backed engines persist an exact native
 * file/id pair; opaque engines persist only the native id. Native home paths
 * never cross this product boundary. */
export async function persistStartedNativeSessionIdentity(input: {
  repos: RuntimeRepositories;
  runId: string;
  runtimeContext: Partial<PersistedRunContext>;
  event: Extract<PiAgentHostEvent, { kind: 'started' }>;
  engineId?: string;
}): Promise<void> {
  const engineId = input.engineId ?? 'api';
  const sessionId = input.event.sessionId?.trim();
  const sessionFile = input.event.sessionFile?.trim();
  if (!sessionId || (engineId === 'api' && !sessionFile)) {
    throw new AgentHostCommandError(
      'protocol',
      'Agent runtime Started event did not include its required native session identity.',
    );
  }
  if (engineId !== 'api' && sessionFile) {
    throw new AgentHostCommandError(
      'protocol',
      'Opaque native runtime exposed a session file outside its Agent Home boundary.',
    );
  }
  const actualModel = hostModelRef(input.event.model);
  const nextContext: Partial<PersistedRunContext> = {
    ...input.runtimeContext,
    nativeSessionId: sessionId,
    ...(actualModel ? { model: actualModel } : {}),
  };
  await persistRunContextPatchWithRepositories(
    input.repos,
    input.runId,
    nextContext,
    sessionFile ? { sessionFile } : {},
  );
  // The object is shared with cursor and terminal checkpoints. Do not expose a
  // native identity until its engine-specific checkpoint passed durable readback.
  input.runtimeContext.nativeSessionId = sessionId;
  if (actualModel) input.runtimeContext.model = actualModel;
}

export function normalizeStreamCursor(cursor: unknown): number {
  return Number.isSafeInteger(cursor) && Number(cursor) > 0 ? Number(cursor) : 0;
}

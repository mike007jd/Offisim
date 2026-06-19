import type { ChatAttachment, ChatToolCall, RunError, StagedAttachment } from '@/data/types.js';
import type { PiPermissionRequestPayload } from '@/runtime/desktop-agent-runtime.js';
import type { AppendMessage } from '@assistant-ui/react';
import type { EventBus } from '@offisim/core/browser';
import { sha256Hex } from '@offisim/install-core';
import {
  type AttachmentKind,
  type AttachmentMeta,
  CURRENT_PARSED_REV,
  type ToolExecutionTelemetryPayload,
  type VaultRef,
} from '@offisim/shared-types';

const INLINE_ATTACHMENT_MAX_CHARS = 48_000;

/**
 * Upsert a streamed tool-call into a per-run accumulator (replace-by-id, never
 * mutate an entry in place) and return a fresh snapshot array. Shared by both
 * chat runtimes so a working agent's inline tool steps accumulate identically.
 */
export function upsertChatToolCall(list: ChatToolCall[], call: ChatToolCall): ChatToolCall[] {
  const index = list.findIndex((entry) => entry.id === call.id);
  if (index === -1) list.push(call);
  else list[index] = { ...list[index], ...call };
  return [...list];
}

export function appendText(message: AppendMessage): string {
  return message.content
    .map((part) => ('text' in part ? part.text : ''))
    .join('')
    .trim();
}

export function newDraftId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function buildRunError(message: string): RunError {
  return {
    id: newDraftId('run-error'),
    message: 'Pi Agent run failed.',
    technicalDetail: message,
  };
}

export function displayAttachmentsFromStaged(
  staged: readonly StagedAttachment[],
): ChatAttachment[] {
  return staged
    .filter((attachment) => attachment.status === 'attached')
    .map((attachment) => ({
      id: attachment.attachmentId ?? attachment.id,
      name: attachment.name,
      sizeLabel: attachment.sizeLabel,
      ext: attachment.ext,
      mimeType: attachment.mimeType,
      byteLength: attachment.byteLength,
      kind: attachment.kind,
      summary: attachment.summary,
    }));
}

export interface MaterializedChatTurn {
  promptText: string;
  attachments: ChatAttachment[];
}

export async function materializeChatTurn({
  text,
  companyId,
  threadId,
  staged,
}: {
  text: string;
  companyId: string | null;
  threadId: string;
  staged: readonly StagedAttachment[];
}): Promise<MaterializedChatTurn> {
  const attached = staged.filter((attachment) => attachment.status === 'attached');
  if (attached.length === 0) return { promptText: text, attachments: [] };
  const { invoke } = await import('@tauri-apps/api/core');
  const attachments: ChatAttachment[] = [];
  const promptLines: string[] = [
    text,
    '',
    '## Current turn attachments',
    'The user attached files to this turn. Text/data excerpts below are readable context. Binary or metadata-only attachments are not readable in this Pi Agent turn; do not claim to have inspected their contents.',
  ];

  for (const attachment of attached) {
    const materialized = await persistAttachment({ invoke, companyId, threadId, attachment });
    attachments.push(materialized.chatAttachment);
    promptLines.push(
      ...attachmentPromptLines(materialized.chatAttachment, attachment, materialized.bytes),
    );
  }

  return { promptText: promptLines.join('\n'), attachments };
}

async function persistAttachment({
  invoke,
  companyId,
  threadId,
  attachment,
}: {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  companyId: string | null;
  threadId: string;
  attachment: StagedAttachment;
}): Promise<{ chatAttachment: ChatAttachment; bytes?: Uint8Array }> {
  const materialized = await materializeAttachmentBytes(attachment);
  const chatAttachment: ChatAttachment = {
    id: attachment.attachmentId ?? attachment.id,
    name: attachment.name,
    sizeLabel: attachment.sizeLabel,
    ext: attachment.ext,
    mimeType: attachment.mimeType,
    byteLength: attachment.byteLength ?? materialized?.bytes.byteLength,
    kind: attachment.kind,
    summary: attachment.summary,
  };
  if (!companyId || !materialized) {
    return { chatAttachment, bytes: materialized?.bytes };
  }
  const meta: AttachmentMeta = {
    attachmentId: materialized.attachmentId,
    companyId,
    threadId,
    filename: attachment.name,
    mimeType: attachment.mimeType ?? 'application/octet-stream',
    byteLength: attachment.byteLength ?? materialized.bytes.byteLength,
    sha256: materialized.sha256,
    createdAt: new Date().toISOString(),
    parsedRev: CURRENT_PARSED_REV,
    kind: attachment.kind ?? 'other',
  };
  const vaultRef = await invoke<string>('attachment_write', {
    meta,
    bytes: Array.from(materialized.bytes),
  });
  return {
    bytes: materialized.bytes,
    chatAttachment: {
      ...chatAttachment,
      id: materialized.attachmentId,
      vaultRef: vaultRef as VaultRef,
      byteLength: meta.byteLength,
      mimeType: meta.mimeType,
      kind: meta.kind as AttachmentKind,
    },
  };
}

function attachmentPromptLines(
  chatAttachment: ChatAttachment,
  staged: StagedAttachment,
  bytes: Uint8Array | undefined,
): string[] {
  const mime = chatAttachment.mimeType ?? 'application/octet-stream';
  const kind = chatAttachment.kind ?? 'other';
  const ref = chatAttachment.vaultRef ? `, ref=${chatAttachment.vaultRef}` : '';
  const header = `[attachment ${chatAttachment.name}, ${mime}, ${chatAttachment.byteLength ?? 0} bytes, kind=${kind}${ref}]`;
  const inline = inlineAttachmentText(staged, bytes);
  if (!inline) return [header, 'Readable content: unavailable in this Pi Agent turn.'];
  return [header, 'Readable content:', '```', inline, '```'];
}

function inlineAttachmentText(
  attachment: StagedAttachment,
  bytes: Uint8Array | undefined,
): string | null {
  if (!bytes) return null;
  const kind = attachment.kind ?? 'other';
  const mime = attachment.mimeType ?? '';
  const textLike =
    kind === 'code' ||
    kind === 'data' ||
    kind === 'document' ||
    mime.startsWith('text/') ||
    /application\/(json|xml|yaml|x-yaml|javascript|typescript|toml|x-ndjson|ld\+json)/i.test(mime);
  if (!textLike) return null;
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const trimmed = decoded.trim();
  if (!trimmed) return null;
  return trimmed.length > INLINE_ATTACHMENT_MAX_CHARS
    ? `${trimmed.slice(0, INLINE_ATTACHMENT_MAX_CHARS)}\n[truncated]`
    : trimmed;
}

async function materializeAttachmentBytes(
  attachment: StagedAttachment,
): Promise<{ bytes: Uint8Array; sha256: string; attachmentId: string } | null> {
  if (attachment.bytes && attachment.sha256 && attachment.attachmentId) {
    return {
      bytes: attachment.bytes,
      sha256: attachment.sha256,
      attachmentId: attachment.attachmentId,
    };
  }
  if (!attachment.file || !attachment.attachmentId) return null;
  const bytes = new Uint8Array(await attachment.file.arrayBuffer());
  return {
    bytes,
    sha256: await sha256Hex(bytes),
    attachmentId: attachment.attachmentId,
  };
}

/**
 * Subscribe to Pi Agent visible text chunks for one chat thread. Pi Agent is
 * now the protocol boundary, so the UI consumes `message_update` projection
 * directly instead of guessing which graph node is the final assistant reply.
 */
export function subscribeReplyStream(
  eventBus: EventBus,
  threadId: string,
  onContentChunk: (chunk: string) => void,
  onReasoningChunk?: (chunk: string) => void,
): () => void {
  return eventBus.on('llm.stream.chunk', (event) => {
    const payload = event.payload as {
      nodeName?: string;
      content?: string;
      channel?: 'content' | 'reasoning';
      chatThreadId?: string;
    };
    if ((payload.chatThreadId || event.threadId) !== threadId) return;
    if (payload.nodeName !== 'pi_agent') return;
    if (!payload.content) return;
    if (payload.channel === 'reasoning') {
      onReasoningChunk?.(payload.content);
      return;
    }
    if (payload.channel !== 'content') return;
    onContentChunk(payload.content);
  });
}

/**
 * Subscribe to the graph's tool-call lifecycle. `tool.execution.telemetry` is
 * the shared start/completion stream for builtin, workstation, runtime-profile,
 * and MCP tools; `mcp.tool.result` is retained as a legacy completion fallback.
 * Returns a combined unsubscribe; callers MUST release it (InMemoryEventBus has
 * no auto-cleanup). Not thread-scoped: desktop runs one chat at a time and the
 * run store is already bound to the active thread, so activity is attributed to
 * the live run exactly like the pipeline pill.
 */
export function subscribeRunActivity(
  eventBus: EventBus,
  handlers: {
    threadId: string;
    onCalled: (tool: string, detail?: string) => void;
    onResult: (tool: string, success: boolean, detail?: string, durationMs?: number) => void;
  },
): () => void {
  const detailFromTelemetry = (payload: ToolExecutionTelemetryPayload): string | undefined => {
    if (payload.errorType) return payload.errorType;
    const parts = [payload.serverName, payload.nodeName, payload.toolType].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : undefined;
  };
  const offTelemetry = eventBus.on('tool.execution.telemetry', (event) => {
    const payload = event.payload as ToolExecutionTelemetryPayload | undefined;
    if (!payload?.toolName) return;
    if (payload.threadId !== handlers.threadId && event.threadId !== handlers.threadId) return;
    if (payload.status === 'started') {
      handlers.onCalled(payload.toolName, detailFromTelemetry(payload));
      return;
    }
    handlers.onResult(
      payload.toolName,
      payload.status === 'completed',
      detailFromTelemetry(payload),
      payload.durationMs,
    );
  });
  const offResult = eventBus.on('mcp.tool.result', (event) => {
    const payload = event.payload as
      | { toolName?: string; success?: boolean; error?: string; latencyMs?: number }
      | undefined;
    if (event.threadId !== handlers.threadId) return;
    if (payload?.toolName)
      handlers.onResult(
        payload.toolName,
        payload.success !== false,
        payload.error,
        payload.latencyMs,
      );
  });
  return () => {
    offTelemetry();
    offResult();
  };
}

/**
 * Subscribe to the per-tool-call lifecycle for one thread and project each
 * transition as a `ChatToolCall` so the surface can accumulate tool steps into
 * the streaming assistant draft and render them as native assistant-ui
 * `tool-call` content parts. Keyed on `toolCallId` so the caller can upsert
 * started → completed/failed. Returns an unsubscribe the caller MUST release.
 */
export function subscribeToolCalls(
  eventBus: EventBus,
  threadId: string,
  onToolCall: (call: {
    id: string;
    name: string;
    status: 'running' | 'completed' | 'failed';
    durationMs?: number;
  }) => void,
): () => void {
  return eventBus.on('tool.execution.telemetry', (event) => {
    const payload = event.payload as ToolExecutionTelemetryPayload | undefined;
    if (!payload?.toolName || !payload.toolCallId) return;
    if (payload.threadId !== threadId && event.threadId !== threadId) return;
    const status =
      payload.status === 'started'
        ? 'running'
        : payload.status === 'completed'
          ? 'completed'
          : 'failed';
    onToolCall({
      id: payload.toolCallId,
      name: payload.toolName,
      status,
      durationMs: payload.durationMs,
    });
  });
}

/**
 * Subscribe to host permission prompts (Ask mode) for one thread. The host
 * pauses a destructive tool and the runtime re-emits it as `pi.permission.request`
 * carrying this run's `requestId`; the surface routes that into the run store so
 * the approval bar can render and answer the verdict. Returns an unsubscribe the
 * caller MUST release (InMemoryEventBus has no auto-cleanup).
 */
export function subscribePermissionRequests(
  eventBus: EventBus,
  handlers: {
    threadId: string;
    onRequest: (request: PiPermissionRequestPayload) => void;
  },
): () => void {
  return eventBus.on('pi.permission.request', (event) => {
    if (event.threadId !== handlers.threadId) return;
    const payload = event.payload as PiPermissionRequestPayload | undefined;
    if (!payload?.requestId || !payload.toolCallId) return;
    handlers.onRequest(payload);
  });
}

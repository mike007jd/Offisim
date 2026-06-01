import { reposOrNull } from '@/data/adapters.js';
import type { ChatAttachment, RunError, StagedAttachment } from '@/data/types.js';
import {
  type ProviderSendResult,
  type RuntimeProviderProfile,
  findDefaultChatProviderProfile,
  loadRuntimeProviderProfiles,
  safeErrorMessage,
  sendProviderTextDetailed,
} from '@/lib/provider-bridge.js';
import type { AppendMessage } from '@assistant-ui/react';
import type { RuntimeRepositories } from '@offisim/core/browser';
import {
  type AttachmentKind,
  type AttachmentMeta,
  CURRENT_PARSED_REV,
  type VaultRef,
} from '@offisim/shared-types';

const INLINE_ATTACHMENT_MAX_CHARS = 48_000;

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
    message: 'Provider send failed.',
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
    'The user attached files to this turn. Text/data excerpts below are readable context. Binary or metadata-only attachments are not readable in this direct provider turn; do not claim to have inspected their contents.',
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
  if (!inline) return [header, 'Readable content: unavailable in this direct provider call.'];
  return [header, 'Readable content:', '```', inline, '```'];
}

function inlineAttachmentText(attachment: StagedAttachment, bytes: Uint8Array | undefined): string | null {
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
    sha256: await sha256BytesHex(bytes),
    attachmentId: attachment.attachmentId,
  };
}

export async function sendDesktopProviderMessage({
  text,
  requestId,
  maxOutputTokens,
  threadId,
  companyId,
  projectId,
  signal,
}: {
  text: string;
  requestId: string;
  maxOutputTokens: number;
  threadId: string;
  companyId: string | null;
  projectId: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const profiles = await loadRuntimeProviderProfiles();
  const profile = findDefaultChatProviderProfile(profiles);
  if (!profile) {
    throw new Error('Runtime provider profile is not configured.');
  }
  const repos = await reposOrNull();
  const started = performance.now();
  let result: ProviderSendResult | null = null;
  let caught: unknown;
  try {
    result = await sendProviderTextDetailed({
      profile,
      text,
      requestId,
      maxOutputTokens,
      signal,
    });
  } catch (error) {
    caught = error;
  }
  await recordDirectProviderCall({
    repos,
    profile,
    text,
    requestId,
    threadId,
    companyId,
    projectId,
    result,
    error: caught,
    latencyMs: Math.max(0, Math.round(performance.now() - started)),
  });
  if (caught) throw caught;
  return result?.text ?? '';
}

async function recordDirectProviderCall({
  repos,
  profile,
  text,
  requestId,
  threadId,
  companyId,
  projectId,
  result,
  error,
  latencyMs,
}: {
  repos: RuntimeRepositories | null;
  profile: RuntimeProviderProfile;
  text: string;
  requestId: string;
  threadId: string;
  companyId: string | null;
  projectId: string | null;
  result: ProviderSendResult | null;
  error: unknown;
  latencyMs: number;
}): Promise<void> {
  if (!repos) return;
  const usage = result?.usage ?? null;
  await repos.llmCalls.create({
    llm_call_id: `llm-${crypto.randomUUID()}`,
    thread_id: threadId,
    task_run_id: null,
    node_name: 'desktop.direct_provider_chat',
    provider: profile.provider,
    model: profile.model,
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cache_read_input_tokens: usage?.cacheReadInputTokens ?? 0,
    cache_creation_input_tokens: usage?.cacheCreationInputTokens ?? 0,
    usage_raw_json: usage ? JSON.stringify(usage.raw) : null,
    request_json: JSON.stringify({ requestId, companyId, projectId, prompt: text }),
    response_json: result?.raw ?? null,
    tool_calls_json: null,
    prompt_hash: await sha256TextOrNull(text),
    tools_hash: null,
    response_hash: result?.raw ? await sha256TextOrNull(result.raw) : null,
    recording_mode: usage ? 'provider-usage' : 'usage-unknown',
    latency_ms: latencyMs,
    error_code: error ? safeErrorMessage(error) : null,
    created_at: new Date().toISOString(),
  });
}

async function sha256TextOrNull(value: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(value);
    return await sha256BytesHex(bytes);
  } catch {
    return null;
  }
}

async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

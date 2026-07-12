import type { ChatAttachment, ChatToolCall, RunError, StagedAttachment } from '@/data/types.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import type { AppendMessage } from '@assistant-ui/react';
import { sha256Hex } from '@offisim/install-core';
import {
  type AttachmentKind,
  type AttachmentMeta,
  CURRENT_PARSED_REV,
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
    message: 'Agent runtime run failed.',
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
  const attachments: ChatAttachment[] = [];
  const promptLines: string[] = [
    text,
    '',
    '## Current turn attachments',
    'The user attached files to this turn. Text/data excerpts below are readable context. Binary or metadata-only attachments are not readable in this Agent runtime turn; do not claim to have inspected their contents.',
  ];

  for (const attachment of attached) {
    const materialized = await persistAttachment({ companyId, threadId, attachment });
    attachments.push(materialized.chatAttachment);
    promptLines.push(
      ...attachmentPromptLines(materialized.chatAttachment, attachment, materialized.bytes),
    );
  }

  return { promptText: promptLines.join('\n'), attachments };
}

async function persistAttachment({
  companyId,
  threadId,
  attachment,
}: {
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
  const vaultRef = await invokeCommand('attachment_write', {
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
  if (!inline) return [header, 'Readable content: unavailable in this Agent runtime turn.'];
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

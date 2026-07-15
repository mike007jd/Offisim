import type { ChatAttachment, ChatToolCall, RunError, StagedAttachment } from '@/data/types.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import type { AppendMessage } from '@assistant-ui/react';
import { bytesToBase64, parseAttachment } from '@offisim/doc-engine';
import { sha256Hex } from '@offisim/install-core';
import {
  type AttachmentKind,
  type AttachmentMeta,
  CHAT_ATTACHMENT_MAX_BYTES,
  CURRENT_PARSED_REV,
  type ParsedAttachment,
  type VaultRef,
} from '@offisim/shared-types';

const INLINE_ATTACHMENT_MAX_CHARS = 48_000;
const TRUNCATION_MARKER = '\n[truncated]';
const NATIVE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

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
  images: Array<{ data: string; mimeType: string }>;
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
  if (attached.length === 0) return { promptText: text, attachments: [], images: [] };
  const attachments: ChatAttachment[] = [];
  const images: Array<{ data: string; mimeType: string }> = [];
  const promptLines: string[] = [
    text,
    '',
    '## Current turn attachments',
    'The user attached files to this turn. Parsed document and text content appears below. Native images are supplied separately in the model input; inspect them directly when the selected model supports image input.',
  ];

  for (const attachment of attached) {
    const materialized = await persistAttachment({ companyId, threadId, attachment });
    attachments.push(materialized.chatAttachment);
    const imageMime = nativeImageMime(materialized.chatAttachment.mimeType);
    if (imageMime) {
      promptLines.push(attachmentHeader(materialized.chatAttachment));
      if (materialized.bytes) {
        images.push({ data: bytesToBase64(materialized.bytes), mimeType: imageMime });
        promptLines.push('Native image input: attached separately for direct visual inspection.');
      } else {
        promptLines.push(
          'Native image input: unavailable because the attachment bytes were not materialized.',
        );
      }
      continue;
    }
    promptLines.push(
      ...(await attachmentPromptLines(materialized.chatAttachment, attachment, materialized.bytes)),
    );
  }

  return { promptText: promptLines.join('\n'), attachments, images };
}

/** Rebuild the exact Pi-facing attachment packet from the durable vault after a
 * renderer reload. Chat rows keep only display metadata + VaultRef; bytes remain
 * single-copy in the attachment store and are parsed again on adoption. */
export async function rehydratePersistedChatTurn({
  text,
  attachments,
}: {
  text: string;
  attachments: readonly ChatAttachment[];
}): Promise<MaterializedChatTurn> {
  if (attachments.length === 0) return { promptText: text, attachments: [], images: [] };
  const images: Array<{ data: string; mimeType: string }> = [];
  const promptLines = [
    text,
    '',
    '## Current turn attachments',
    'The user attached files to this turn. Parsed document and text content appears below. Native images are supplied separately in the model input; inspect them directly when the selected model supports image input.',
  ];

  for (const attachment of attachments) {
    let bytes: Uint8Array | undefined;
    if (attachment.vaultRef) {
      try {
        const payload = await invokeCommand('attachment_read', {
          vaultRef: attachment.vaultRef,
          maxBytes: CHAT_ATTACHMENT_MAX_BYTES,
        });
        bytes = new Uint8Array(payload.bytes);
      } catch (error) {
        console.warn('[desktop-chat-runtime] persisted attachment rehydrate failed', {
          attachmentId: attachment.id,
          error,
        });
      }
    }
    const imageMime = nativeImageMime(attachment.mimeType);
    if (imageMime) {
      promptLines.push(attachmentHeader(attachment));
      if (bytes) {
        images.push({ data: bytesToBase64(bytes), mimeType: imageMime });
        promptLines.push('Native image input: attached separately for direct visual inspection.');
      } else {
        promptLines.push(
          'Native image input: unavailable because the attachment bytes were not materialized.',
        );
      }
      continue;
    }
    const inline = bytes
      ? await inlineAttachmentBytes(bytes, attachment.mimeType, attachment.name)
      : null;
    promptLines.push(
      attachmentHeader(attachment),
      inline
        ? `Parsed readable content:\n\`\`\`\n${inline}\n\`\`\``
        : 'Readable content: unavailable for this attachment type or parsing failed.',
    );
  }

  return { promptText: promptLines.join('\n'), attachments: [...attachments], images };
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

async function attachmentPromptLines(
  chatAttachment: ChatAttachment,
  staged: StagedAttachment,
  bytes: Uint8Array | undefined,
): Promise<string[]> {
  const header = attachmentHeader(chatAttachment);
  const inline = await inlineAttachmentText(staged, bytes);
  if (!inline)
    return [header, 'Readable content: unavailable for this attachment type or parsing failed.'];
  return [header, 'Parsed readable content:', '```', inline, '```'];
}

async function inlineAttachmentText(
  attachment: StagedAttachment,
  bytes: Uint8Array | undefined,
): Promise<string | null> {
  if (!bytes) return null;
  return inlineAttachmentBytes(bytes, attachment.mimeType, attachment.name);
}

async function inlineAttachmentBytes(
  bytes: Uint8Array,
  mimeType: string | undefined,
  name: string,
): Promise<string | null> {
  const parsed = await parseAttachment(bytes, mimeType ?? 'application/octet-stream', name);
  const trimmed = parsedAttachmentText(parsed)?.trim();
  if (!trimmed) return null;
  return trimmed.length > INLINE_ATTACHMENT_MAX_CHARS
    ? `${trimmed.slice(0, INLINE_ATTACHMENT_MAX_CHARS - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`
    : trimmed;
}

function parsedAttachmentText(parsed: ParsedAttachment): string | null {
  switch (parsed.kind) {
    case 'text':
    case 'pdf':
    case 'docx':
    case 'pptx':
      return parsed.text;
    case 'xlsx':
      return parsed.sheets
        .map((sheet: { name: string; csv: string }) =>
          [`## Sheet: ${sheet.name}`, sheet.csv].filter(Boolean).join('\n'),
        )
        .join('\n\n');
    case 'image':
    case 'binary':
    case 'unsupported':
      return null;
  }
  return null;
}

function attachmentHeader(chatAttachment: ChatAttachment): string {
  const mime = chatAttachment.mimeType ?? 'application/octet-stream';
  const kind = chatAttachment.kind ?? 'other';
  const ref = chatAttachment.vaultRef ? `, ref=${chatAttachment.vaultRef}` : '';
  return `[attachment ${chatAttachment.name}, ${mime}, ${chatAttachment.byteLength ?? 0} bytes, kind=${kind}${ref}]`;
}

function nativeImageMime(mimeType: string | undefined): string | null {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  const canonical = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  return canonical && NATIVE_IMAGE_MIMES.has(canonical) ? canonical : null;
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

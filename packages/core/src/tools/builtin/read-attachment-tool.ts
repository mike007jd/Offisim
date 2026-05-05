import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_READ,
  type AttachmentMeta,
  type ChatAttachmentReadPayload,
  type ParsedAttachment,
  type VaultRef,
  chatAttachmentEvent,
  kindFromMime,
  parseVaultRef,
} from '@offisim/shared-types';
import { bytesToBase64, parseAttachment, parseText } from '@offisim/doc-engine';
import type { EventBus } from '../../events/event-bus.js';
import type { ToolDef } from '../../llm/gateway.js';
import type { AttachmentStoreBridge } from '../../runtime/attachment-store-bridge.js';
import type { BuiltinTool, BuiltinToolExecutionContext } from './types.js';

const TOOL_NAME = 'read_attachment';
const MAX_BYTES_HARD_CAP = CHAT_ATTACHMENT_MAX_BYTES;
const TEXT_LIKE_RE = /^(text\/|application\/(json|xml|yaml|x-yaml|x-sh|x-shellscript|javascript|typescript|ld\+json|x-ndjson|toml)$)/i;

type Mode = 'auto' | 'text' | 'binary' | 'structured';

interface ReadAttachmentToolOptions {
  companyId?: string;
}

const READ_ATTACHMENT_DEF: ToolDef = {
  name: TOOL_NAME,
  description:
    'Read a chat attachment by vaultRef. Returns text for text-like mimes, structured pages/sheets/slides for known doc types, base64 for binary or unknown. mode="structured" works for PDF/DOCX/XLSX/PPTX/image; mode="text" for code / json / yaml / markdown / log files.',
  parameters: {
    type: 'object',
    properties: {
      vaultRef: {
        type: 'string',
        description:
          'The attachment ref shown in the system preface (`attachment://<companyId>/<threadId>/<attachmentId>`).',
      },
      max_bytes: {
        type: 'number',
        description: 'Optional read cap. Hard ceiling is 8 MB.',
      },
      mode: {
        type: 'string',
        enum: ['auto', 'text', 'binary', 'structured'],
        description: 'Resolution mode. "auto" picks shape from mime.',
      },
    },
    required: ['vaultRef'],
  },
};

function resolveAuto(mime: string): Mode {
  const k = kindFromMime(mime);
  if (k === 'pdf' || k === 'docx' || k === 'xlsx' || k === 'pptx' || k === 'image') return 'structured';
  if (TEXT_LIKE_RE.test(mime) || k === 'code' || k === 'data' || k === 'document') return 'text';
  return 'binary';
}

interface BaseResult {
  filename: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
  truncated: boolean;
}

function toBase(meta: AttachmentMeta, truncated: boolean): BaseResult {
  return {
    filename: meta.filename,
    mimeType: meta.mimeType,
    byteLength: meta.byteLength,
    sha256: meta.sha256,
    truncated,
  };
}

function parserFailed(
  vaultRef: string,
  meta: AttachmentMeta,
  base: BaseResult,
  bytes: Uint8Array,
  reason: string,
) {
  return {
    kind: 'parser-failed',
    vaultRef,
    parserKind: kindFromMime(meta.mimeType),
    reason,
    ...base,
    content: bytesToBase64(bytes),
  };
}

const MODE_HANDLERS: Record<
  Mode,
  (meta: AttachmentMeta, bytes: Uint8Array, base: BaseResult, vaultRef: string) => Promise<unknown> | unknown
> = {
  binary: (_m, bytes, base) => ({ ...base, content: bytesToBase64(bytes) }),
  text: (_m, bytes, base) => {
    const parsed = parseText(bytes);
    return { ...base, content: parsed.kind === 'text' ? parsed.text : '' };
  },
  auto: () => {
    throw new Error('auto must be resolved before dispatch');
  },
  structured: async (meta, bytes, base, vaultRef) => {
    let parsedDoc: ParsedAttachment;
    try {
      parsedDoc = await parseAttachment(bytes, meta.mimeType, meta.filename);
    } catch (err) {
      return parserFailed(vaultRef, meta, base, bytes, err instanceof Error ? err.message : String(err));
    }
    if (parsedDoc.kind === 'unsupported') {
      return parserFailed(vaultRef, meta, base, bytes, parsedDoc.reason);
    }
    return { ...base, content: JSON.stringify(parsedDoc), structured: parsedDoc };
  },
};

function resolveAuthorizedScope(
  opts: ReadAttachmentToolOptions,
  context?: BuiltinToolExecutionContext,
): { companyId: string; threadId: string } | null {
  const companyId = context?.companyId ?? opts.companyId;
  const threadId = context?.runScope?.threadId;
  if (!companyId || !threadId) return null;
  return { companyId, threadId };
}

function forbidden(vaultRef: string, reason: string) {
  return { kind: 'attachment-forbidden', vaultRef, reason };
}

export function createReadAttachmentTool(
  bridge: AttachmentStoreBridge,
  eventBus?: EventBus,
  opts: ReadAttachmentToolOptions = {},
): BuiltinTool {
  return {
    def: READ_ATTACHMENT_DEF,
    async execute(args: Record<string, unknown>, context?: BuiltinToolExecutionContext) {
      const rawRef = typeof args.vaultRef === 'string' ? args.vaultRef : '';
      const reqMode = typeof args.mode === 'string' ? (args.mode as Mode) : undefined;
      const reqMax = typeof args.max_bytes === 'number' ? (args.max_bytes as number) : undefined;
      const parsed = parseVaultRef(rawRef);
      if (parsed.kind === 'invalid') {
        return { kind: 'invalid-vault-ref', reason: parsed.reason };
      }
      const scope = resolveAuthorizedScope(opts, context);
      if (!scope) {
        return forbidden(parsed.ref, 'missing-run-scope');
      }
      if (parsed.companyId !== scope.companyId || parsed.threadId !== scope.threadId) {
        return forbidden(parsed.ref, 'scope-mismatch');
      }
      const cap = Math.min(
        reqMax !== undefined && reqMax > 0 ? reqMax : MAX_BYTES_HARD_CAP,
        MAX_BYTES_HARD_CAP,
      );
      const result = await bridge.read(parsed.ref as VaultRef, cap);
      if (result.kind === 'attachment-not-found') {
        return { kind: 'attachment-not-found', vaultRef: parsed.ref };
      }
      if (result.kind === 'attachment-corrupted') {
        return { kind: 'attachment-corrupted', vaultRef: parsed.ref };
      }
      const { meta, bytes } = result;
      if (meta.companyId !== scope.companyId || meta.threadId !== scope.threadId) {
        return forbidden(parsed.ref, 'metadata-scope-mismatch');
      }
      const requested = reqMode ?? 'auto';
      const mode: Mode = requested === 'auto' ? resolveAuto(meta.mimeType) : requested;
      const truncated = bytes.length >= cap && meta.byteLength > cap;
      const base = toBase(meta, truncated);
      if (eventBus) {
        const payload: ChatAttachmentReadPayload = {
          vaultRef: parsed.ref as VaultRef,
          threadId: meta.threadId,
          mode,
          byteLengthRead: bytes.length,
          truncated,
        };
        eventBus.emit(
          chatAttachmentEvent(
            CHAT_ATTACHMENT_READ,
            { entityId: meta.attachmentId, companyId: meta.companyId, threadId: meta.threadId },
            payload,
          ),
        );
      }
      return MODE_HANDLERS[mode](meta, bytes, base, parsed.ref);
    },
  };
}

/**
 * Chat attachment contract — shared between composer UI, persistence backends,
 * and the Pi Agent tool surface. SSOT for the `add-chat-attachment-end-to-end`
 * capability. Companion runtime event payloads live in
 * `./events/chat-attachment-events.ts`.
 */

/** Branded URN-like ref to a persisted attachment blob. Format: `attachment://<companyId>/<threadId>/<attachmentId>`. */
export type VaultRef = string & { readonly __brand: 'ChatAttachmentVaultRef' };

/**
 * Structural alias for a DOM `File`. shared-types is DOM-lib-free, so we declare
 * the shape we actually consume and let composers pass the real `File` (which
 * satisfies it structurally). `slice()` is omitted on purpose — staging only
 * reads the whole file.
 */
export interface FileLike {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Coarse classification used by the bubble icon picker, system-preface listing,
 * and the AI tool's `mode='auto'` resolver. Doc-specific kinds (`pdf`/`docx`/
 * `xlsx`/`pptx`) take precedence over the generic `document` bucket so the UI can
 * pick a more specific icon and the tool can pick the structured parser branch.
 */
export type AttachmentKind =
  | 'image'
  | 'document'
  | 'code'
  | 'data'
  | 'other'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx';

export const CURRENT_PARSED_REV = 1;
export const CHAT_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const ATTACHMENT_KINDS = [
  'image',
  'document',
  'code',
  'data',
  'other',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
] as const satisfies readonly AttachmentKind[];

const ATTACHMENT_KIND_SET = new Set<string>(ATTACHMENT_KINDS);

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return typeof value === 'string' && ATTACHMENT_KIND_SET.has(value);
}

/** Persisted blob metadata. JSON-safe. */
export interface AttachmentMeta {
  readonly attachmentId: string;
  readonly companyId: string;
  readonly threadId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly parsedRev: number;
  readonly kind: AttachmentKind;
}

/**
 * Reference embedded in `ChatMessage.attachments` and `RunScope.pendingAttachments`.
 * Stable across reload — the chip in the bubble re-resolves bytes via
 * `attachmentStore.read(vaultRef)`.
 */
export interface ChatAttachmentRef {
  readonly attachmentId: string;
  readonly vaultRef: VaultRef;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly kind: AttachmentKind;
  readonly parsedRev: number;
  readonly summary?: string;
}

/**
 * In-memory composer-side state for a file the user has dropped/pasted/picked
 * but not yet sent. `parsed` is computed at staging time so the chip can show
 * a one-line preview ("PDF · 12 pages") and the send pipeline does not re-parse.
 * `error` carries staging-time rejection reasons (oversize, dedupe, parse failure)
 * for surface in the chip, NOT for blocking other staged files.
 */
export interface StagedAttachment {
  readonly attachmentId: string;
  readonly file: FileLike;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly kind: AttachmentKind;
  readonly summary?: string;
  readonly parsed?: ParsedAttachment;
  readonly error?: { readonly reason: string };
}

/** Output of `parseAttachment(...)`. Discriminated by `kind`. */
export type ParsedAttachment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'pdf';
      readonly pages: readonly string[];
      readonly text: string;
      /** True when the PDF had more pages than the extraction cap and `pages`/`text` are partial. */
      readonly truncated?: boolean;
    }
  | { readonly kind: 'docx'; readonly text: string; readonly html: string }
  | {
      readonly kind: 'xlsx';
      readonly sheets: ReadonlyArray<{
        readonly name: string;
        readonly csv: string;
        /**
         * Used-range row count per sheet (derived from the sheet's `!ref`, not a
         * materialized 2D grid). The importer caps row/col/total-cell counts and
         * rejects workbooks that exceed them; see `doc-engine/src/import/xlsx.ts`.
         */
        readonly rowCount: number;
      }>;
    }
  | { readonly kind: 'pptx'; readonly slides: readonly string[]; readonly text: string }
  | {
      readonly kind: 'image';
      readonly base64: string;
      readonly width: number;
      readonly height: number;
      readonly format: string;
    }
  | { readonly kind: 'binary'; readonly base64: string }
  | { readonly kind: 'unsupported'; readonly reason: string };

export type ParseVaultRefResult =
  | {
      readonly kind: 'ok';
      readonly ref: VaultRef;
      readonly companyId: string;
      readonly threadId: string;
      readonly attachmentId: string;
    }
  | { readonly kind: 'invalid'; readonly reason: string };

const VAULT_REF_SCHEME = 'attachment://';
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validate + decompose a `vaultRef` string. Rejects path traversal (`..`),
 * empty segments, wrong segment count, non-UUIDv4 attachment ids, and any
 * companyId/threadId containing characters outside the safe id alphabet.
 */
export function parseVaultRef(s: unknown): ParseVaultRefResult {
  if (typeof s !== 'string') return { kind: 'invalid', reason: 'not-a-string' };
  if (!s.startsWith(VAULT_REF_SCHEME)) return { kind: 'invalid', reason: 'missing-scheme' };
  const tail = s.slice(VAULT_REF_SCHEME.length);
  if (tail.includes('..')) return { kind: 'invalid', reason: 'path-traversal' };
  if (tail.includes('//')) return { kind: 'invalid', reason: 'empty-segment' };
  const parts = tail.split('/');
  if (parts.length !== 3) return { kind: 'invalid', reason: 'wrong-segments' };
  const [companyId, threadId, attachmentId] = parts as [string, string, string];
  if (!companyId || !threadId || !attachmentId) {
    return { kind: 'invalid', reason: 'empty-segment' };
  }
  if (!ID_SEGMENT_RE.test(companyId)) return { kind: 'invalid', reason: 'company-id-charset' };
  if (!ID_SEGMENT_RE.test(threadId)) return { kind: 'invalid', reason: 'thread-id-charset' };
  if (!UUID_V4_RE.test(attachmentId)) {
    return { kind: 'invalid', reason: 'attachment-id-not-uuid' };
  }
  return {
    kind: 'ok',
    ref: s as VaultRef,
    companyId,
    threadId,
    attachmentId,
  };
}

/** Build a vaultRef. Throws if any segment is malformed — callers must pass clean ids. */
export function buildVaultRef(companyId: string, threadId: string, attachmentId: string): VaultRef {
  if (!ID_SEGMENT_RE.test(companyId)) {
    throw new Error(`buildVaultRef: invalid companyId "${companyId}"`);
  }
  if (!ID_SEGMENT_RE.test(threadId)) {
    throw new Error(`buildVaultRef: invalid threadId "${threadId}"`);
  }
  if (!UUID_V4_RE.test(attachmentId)) {
    throw new Error(`buildVaultRef: attachmentId must be UUIDv4, got "${attachmentId}"`);
  }
  return `${VAULT_REF_SCHEME}${companyId}/${threadId}/${attachmentId}` as VaultRef;
}

const MIME_KIND_MAP: Readonly<Record<string, AttachmentKind>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'docx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.ms-powerpoint': 'pptx',
};

const TEXT_LIKE_MIME_RE =
  /^(text\/|application\/(json|xml|yaml|x-yaml|x-sh|x-shellscript|javascript|typescript|ld\+json|x-ndjson|toml)$)/i;

const CODE_MIME_HINTS = new Set<string>([
  'application/javascript',
  'application/typescript',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-python',
  'text/x-python',
  'text/x-go',
  'text/x-rust',
  'text/x-c',
  'text/x-c++',
  'text/x-java',
  'text/x-typescript',
  'text/x-javascript',
]);

const DATA_MIME_HINTS = new Set<string>([
  'text/csv',
  'application/json',
  'application/x-ndjson',
  'application/ld+json',
  'application/xml',
  'text/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
]);

const DOC_TEXT_HINTS = new Set<string>([
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'text/rtf',
]);

/**
 * Resolve a coarse `AttachmentKind` from a mime string. Doc kinds win over the
 * generic `document` bucket. Image any-subtype maps to `image`. Unknown mimes
 * fall through to `other`.
 */
export function kindFromMime(mime: string): AttachmentKind {
  const m = (mime ?? '').toLowerCase().trim();
  const exact = MIME_KIND_MAP[m];
  if (exact) return exact;
  if (m.startsWith('image/')) return 'image';
  if (CODE_MIME_HINTS.has(m)) return 'code';
  if (DATA_MIME_HINTS.has(m)) return 'data';
  if (DOC_TEXT_HINTS.has(m)) return 'document';
  if (TEXT_LIKE_MIME_RE.test(m)) return 'code';
  return 'other';
}

function pluralize(n: number, unit: string): string {
  return `${n.toLocaleString('en-US')} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * One-line preview rendered on the staged chip and re-used by the bubble chip
 * via `ChatAttachmentRef.summary`. Only the staged path actually parses; the
 * bubble path reads the cached summary from the ref.
 */
export function summaryFromParsed(parsed: ParsedAttachment): string {
  switch (parsed.kind) {
    case 'pdf':
      return `PDF · ${pluralize(parsed.pages.length, 'page')}${parsed.truncated ? ' (truncated)' : ''}`;
    case 'docx':
      return `DOCX · ${pluralize(parsed.text.length, 'char')}`;
    case 'xlsx': {
      const rows = parsed.sheets.reduce((acc, s) => acc + s.rowCount, 0);
      return `XLSX · ${pluralize(parsed.sheets.length, 'sheet')}, ${pluralize(rows, 'row')}`;
    }
    case 'pptx':
      return `PPTX · ${pluralize(parsed.slides.length, 'slide')}`;
    case 'image':
      return `${parsed.width}×${parsed.height}`;
    case 'text':
      return `Text · ${pluralize(parsed.text.length, 'char')}`;
    case 'binary':
      return 'Binary file';
    case 'unsupported':
      return `Unsupported · ${parsed.reason}`;
  }
}

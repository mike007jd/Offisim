import type {
  DeliverableContributor,
  DeliverableKind,
  DeliverableRow,
  DeliverableSummaryRow,
} from '@offisim/core/browser';
import type { DeliverableCreatedPayload } from '@offisim/shared-types';
import { stripLegacySpeakerPrefix } from './legacy-speaker-prefix';

export type { DeliverableKind };

export interface DeliverableArtifact {
  kind: DeliverableKind;
  fileName: string | null;
  mimeType: string | null;
  content: string;
}

const CODE_FENCE_RE = /```([a-zA-Z0-9#+._-]+)?\s*\n([\s\S]*?)\n```/m;
const FILE_NAME_HINT_RE = /(?:^|\n)\s*filename\s*:\s*([^\n]+\.[a-zA-Z0-9]{1,8})\s*(?:\n|$)/i;
const FILE_NAME_MENTION_RE = /\b([A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z]{1,8})\b/;

function sanitizeBaseName(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'deliverable';
}

function defaultFileNameForMime(mimeType: string | null): string | null {
  switch (mimeType) {
    case 'text/html':
      return 'deliverable.html';
    case 'text/javascript':
      return 'deliverable.js';
    case 'text/typescript':
      return 'deliverable.ts';
    case 'application/json':
      return 'deliverable.json';
    case 'text/markdown':
      return 'deliverable.md';
    case 'text/css':
      return 'deliverable.css';
    case 'text/csv':
      return 'deliverable.csv';
    case 'text/yaml':
      return 'deliverable.yml';
    case 'application/xml':
      return 'deliverable.xml';
    default:
      return mimeType?.startsWith('text/') ? 'deliverable.txt' : null;
  }
}

function looksLikeRawArtifactTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.startsWith('```') ||
    /^<!doctype html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    trimmed.startsWith('<!DOCTYPE html') ||
    trimmed.includes('<html') ||
    trimmed.length > 100
  );
}

function extensionFromLanguage(language: string): string | null {
  switch (language.toLowerCase()) {
    case 'html':
      return 'html';
    case 'javascript':
    case 'js':
      return 'js';
    case 'typescript':
    case 'ts':
      return 'ts';
    case 'tsx':
      return 'tsx';
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'markdown':
    case 'md':
      return 'md';
    case 'css':
      return 'css';
    case 'csv':
      return 'csv';
    case 'yaml':
    case 'yml':
      return 'yml';
    case 'xml':
      return 'xml';
    case 'text':
    case 'txt':
      return 'txt';
    case 'python':
    case 'py':
      return 'py';
    case 'bash':
    case 'sh':
      return 'sh';
    default:
      return null;
  }
}

function mimeFromExtension(extension: string): string {
  switch (extension) {
    case 'html':
      return 'text/html';
    case 'js':
    case 'jsx':
      return 'text/javascript';
    case 'ts':
    case 'tsx':
      return 'text/typescript';
    case 'json':
      return 'application/json';
    case 'md':
      return 'text/markdown';
    case 'css':
      return 'text/css';
    case 'csv':
      return 'text/csv';
    case 'yml':
      return 'text/yaml';
    case 'xml':
      return 'application/xml';
    default:
      return 'text/plain';
  }
}

function parseCodeFence(content: string): { language: string | null; body: string } | null {
  const match = content.match(CODE_FENCE_RE);
  if (!match) return null;
  return {
    language: match[1]?.trim() ?? null,
    body: (match[2] ?? '').trim(),
  };
}

function extractEmbeddedHtml(content: string): string | null {
  const start = content.search(/<!DOCTYPE html/i);
  if (start >= 0) {
    const endTagIndex = content.toLowerCase().lastIndexOf('</html>');
    if (endTagIndex > start) {
      return content.slice(start, endTagIndex + '</html>'.length).trim();
    }
    return content.slice(start).trim();
  }
  const htmlTagStart = content.search(/<html[\s>]/i);
  if (htmlTagStart >= 0) {
    const endTagIndex = content.toLowerCase().lastIndexOf('</html>');
    if (endTagIndex > htmlTagStart) {
      return content.slice(htmlTagStart, endTagIndex + '</html>'.length).trim();
    }
    return content.slice(htmlTagStart).trim();
  }
  return null;
}

function extractFileNameHint(content: string): string | null {
  const match = content.match(FILE_NAME_HINT_RE);
  return match?.[1]?.trim() ?? null;
}

function extractInlineFileNameMention(value: string): string | null {
  const match = value.match(FILE_NAME_MENTION_RE);
  return match?.[1]?.trim() ?? null;
}

function inferFallbackArtifact(title: string, content: string): DeliverableArtifact {
  const cleaned = stripLegacySpeakerPrefix(content).trim();
  const fileNameHint =
    extractFileNameHint(cleaned) ??
    extractInlineFileNameMention(cleaned) ??
    extractInlineFileNameMention(title);
  const baseName = sanitizeBaseName(looksLikeRawArtifactTitle(title) ? 'deliverable' : title);

  const embeddedHtml = extractEmbeddedHtml(cleaned);
  if (embeddedHtml) {
    return {
      kind: 'file',
      fileName: fileNameHint ?? `${baseName}.html`,
      mimeType: 'text/html',
      content: embeddedHtml,
    };
  }

  const fenced = parseCodeFence(cleaned);
  if (fenced) {
    const extension = fenced.language ? extensionFromLanguage(fenced.language) : null;
    if (extension) {
      return {
        kind: 'file',
        fileName: fileNameHint ?? `${baseName}.${extension}`,
        mimeType: mimeFromExtension(extension),
        content: fenced.body,
      };
    }
  }

  return {
    kind: 'document',
    fileName: null,
    mimeType: null,
    content: cleaned,
  };
}

export function resolveDeliverableArtifact(
  payload: Pick<DeliverableCreatedPayload, 'title' | 'content' | 'kind' | 'fileName' | 'mimeType'>,
): DeliverableArtifact {
  const cleanedTitle = stripLegacySpeakerPrefix(payload.title);
  const cleanedContent = stripLegacySpeakerPrefix(payload.content);
  if (payload.kind === 'document') {
    return {
      kind: 'document',
      fileName: null,
      mimeType: payload.mimeType ?? null,
      content: cleanedContent.trim(),
    };
  }
  if (payload.kind === 'file') {
    const inferred = inferFallbackArtifact(cleanedTitle, cleanedContent);
    return {
      kind: 'file',
      fileName: payload.fileName ?? (inferred.kind === 'file' ? inferred.fileName : null),
      mimeType: payload.mimeType ?? (inferred.kind === 'file' ? inferred.mimeType : 'text/plain'),
      content: inferred.kind === 'file' ? inferred.content : cleanedContent,
    };
  }
  return inferFallbackArtifact(cleanedTitle, cleanedContent);
}

export function isDisplayableDeliverable(
  payload: Pick<DeliverableCreatedPayload, 'kind' | 'fileName' | 'mimeType'>,
  artifact: DeliverableArtifact,
): boolean {
  if (artifact.kind === 'file') return !!artifact.fileName || payload.kind === 'file';
  return payload.kind === 'document';
}

export function getDeliverableDisplayTitle(title: string, artifact: DeliverableArtifact): string {
  if (artifact.kind === 'file') {
    return artifact.fileName ?? defaultFileNameForMime(artifact.mimeType) ?? 'Deliverable file';
  }

  const cleaned = stripLegacySpeakerPrefix(title).replace(/\s+/g, ' ').trim();
  if (!cleaned || looksLikeRawArtifactTitle(cleaned)) return 'Deliverable';
  return cleaned;
}

export function canPreviewDeliverable(artifact: DeliverableArtifact): boolean {
  if (artifact.kind !== 'file' || !artifact.mimeType) return false;
  return (
    artifact.mimeType.startsWith('text/') ||
    artifact.mimeType === 'application/json' ||
    artifact.mimeType === 'application/javascript'
  );
}

// Legacy rows pre-date contributor-brand fields; default missing values to
// internal so EmployeeAvatar falls back to DiceBear without throwing.
function safeParseContributors(json: string): ReadonlyArray<DeliverableContributor> {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return (parsed as Partial<DeliverableContributor>[]).map((c) => {
      const hasExternal = typeof c.isExternal === 'boolean';
      const hasBrand = typeof c.brandKey === 'string' || c.brandKey === null;
      if (hasExternal && hasBrand) return c as DeliverableContributor;
      return {
        employeeId: c.employeeId ?? '',
        employeeName: c.employeeName ?? '',
        sourceKind: c.sourceKind,
        roleSlug:
          typeof c.roleSlug === 'string' ? c.roleSlug : ('' as DeliverableContributor['roleSlug']),
        isExternal: hasExternal ? (c.isExternal as boolean) : false,
        brandKey: hasBrand ? (c.brandKey as string | null) : null,
      };
    });
  } catch {
    return [];
  }
}

function summaryRowToPayload(
  row: DeliverableSummaryRow,
  content: string,
): DeliverableCreatedPayload {
  return {
    deliverableId: row.deliverable_id,
    threadId: row.thread_id ?? '',
    chatThreadId: row.chat_thread_id ?? null,
    title: row.title,
    content,
    kind: row.kind ?? undefined,
    fileName: row.file_name,
    mimeType: row.mime_type,
    contributingEmployees: safeParseContributors(row.contributors_json),
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
}

/** Minimal-content hydrate shape — used when `content` is empty until lazy load. */
export interface DeliverableHookRow {
  id: string;
  threadId: string;
  /**
   * Product-layer `chat_threads.thread_id`. Legacy rows from older snapshots
   * may still hydrate as `null`.
   */
  chatThreadId: string | null;
  title: string;
  content: string;
  contentSize: number;
  declaredKind: DeliverableKind | null;
  artifact: DeliverableArtifact;
  contributingEmployees: ReadonlyArray<DeliverableContributor>;
  createdAt: number;
}

export function mapDeliverableSummaryToHookRow(row: DeliverableSummaryRow): DeliverableHookRow {
  const payload = summaryRowToPayload(row, '');
  const artifact = resolveDeliverableArtifact(payload);
  return {
    id: row.deliverable_id,
    threadId: row.thread_id ?? '',
    chatThreadId: row.chat_thread_id ?? null,
    title: getDeliverableDisplayTitle(payload.title, artifact),
    content: '',
    contentSize: row.content_size ?? 0,
    declaredKind: row.kind ?? null,
    artifact,
    contributingEmployees: payload.contributingEmployees,
    createdAt: payload.createdAt,
  };
}

export function mapDeliverableFullRowToHookRow(row: DeliverableRow): DeliverableHookRow {
  const payload: DeliverableCreatedPayload = {
    deliverableId: row.deliverable_id,
    threadId: row.thread_id ?? '',
    chatThreadId: row.chat_thread_id ?? null,
    title: row.title,
    content: row.content,
    kind: row.kind ?? undefined,
    fileName: row.file_name,
    mimeType: row.mime_type,
    contributingEmployees: safeParseContributors(row.contributors_json),
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
  const artifact = resolveDeliverableArtifact(payload);
  return {
    id: row.deliverable_id,
    threadId: payload.threadId,
    chatThreadId: row.chat_thread_id ?? null,
    title: getDeliverableDisplayTitle(payload.title, artifact),
    content: artifact.content,
    contentSize: artifact.content.length,
    declaredKind: row.kind ?? null,
    artifact,
    contributingEmployees: payload.contributingEmployees,
    createdAt: payload.createdAt,
  };
}

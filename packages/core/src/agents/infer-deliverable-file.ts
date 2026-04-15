import type { DeliverableCreatedPayload } from '@offisim/shared-types';

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

function getExtensionFromLanguage(language: string): string | null {
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

function getMimeTypeFromExtension(extension: string): string {
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
    case 'txt':
    case 'py':
    case 'sh':
      return 'text/plain';
    default:
      return 'text/plain';
  }
}

function getExplicitExtensionFromTitle(title: string): string | null {
  const match = title.trim().match(/\.([a-zA-Z0-9]{1,8})$/);
  const extension = match?.[1];
  return extension ? extension.toLowerCase() : null;
}

function getExplicitFileNameHint(content: string): string | null {
  const match = content.match(FILE_NAME_HINT_RE);
  const fileName = match?.[1]?.trim();
  return fileName || null;
}

function getInlineFileNameMention(value: string): string | null {
  const match = value.match(FILE_NAME_MENTION_RE);
  const fileName = match?.[1]?.trim();
  return fileName || null;
}

function getEmbeddedHtmlSlice(content: string): string | null {
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

export function inferDeliverableFile(
  title: string,
  content: string,
): Pick<DeliverableCreatedPayload, 'kind' | 'fileName' | 'mimeType'> | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const explicitFileName =
    getExplicitFileNameHint(trimmed) ?? getInlineFileNameMention(trimmed) ?? getInlineFileNameMention(title);
  const explicitExtension =
    getExplicitExtensionFromTitle(explicitFileName ?? title) ??
    getExplicitExtensionFromTitle(title);
  const baseName = sanitizeBaseName(title.replace(/\.[a-zA-Z0-9]{1,8}$/, ''));

  if (getEmbeddedHtmlSlice(trimmed)) {
    return {
      kind: 'file',
      fileName: explicitFileName ?? `${baseName}.${explicitExtension ?? 'html'}`,
      mimeType: 'text/html',
    };
  }

  const fenced = trimmed.match(CODE_FENCE_RE);
  if (!fenced) return null;

  const language = fenced[1]?.trim() ?? '';
  const extension = explicitExtension ?? (language ? getExtensionFromLanguage(language) : null);
  if (!extension) return null;

  return {
    kind: 'file',
    fileName: explicitFileName ?? `${baseName}.${extension}`,
    mimeType: getMimeTypeFromExtension(extension),
  };
}

import type { ToolRichDetail } from '@offisim/shared-types';

export type PreviewSourceRef =
  | { source: 'workspace-file'; path: string }
  | {
      source: 'deliverable';
      deliverableId: string;
      threadId: string | null;
      format?: string;
      name?: string;
    }
  | {
      source: 'browser';
      sourceId?: string;
      url?: string;
      detail?: Extract<ToolRichDetail, { family: 'browser' }>;
    }
  | { source: 'screenshot'; dataRef: string; mimeType: string; title?: string; url?: string }
  | { source: 'computer-artifact'; path: string; runId?: string };

export type PreviewViewerKind =
  | 'text'
  | 'code'
  | 'json'
  | 'structured-text'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'html'
  | 'csv'
  | 'spreadsheet'
  | 'doc'
  | 'slides'
  | 'video'
  | 'audio'
  | 'model3d'
  | 'browser'
  | 'screenshot'
  | 'unsupported';

export interface ResolvedPreviewTarget {
  ref: PreviewSourceRef;
  viewerKind: PreviewViewerKind;
  trustLevel: 'workspace' | 'generated' | 'external' | 'computer';
  meta: {
    title: string;
    path?: string;
    url?: string;
    mimeType?: string;
    extension?: string;
    byteLength?: number;
    modifiedAt?: string;
    threadId?: string | null;
  };
}

const MIME_VIEWERS: Readonly<Record<string, PreviewViewerKind>> = {
  'application/pdf': 'pdf',
  'application/json': 'json',
  'application/ld+json': 'json',
  'application/x-ndjson': 'json',
  'application/xml': 'structured-text',
  'text/xml': 'structured-text',
  'application/yaml': 'structured-text',
  'application/x-yaml': 'structured-text',
  'application/toml': 'structured-text',
  'application/x-toml': 'structured-text',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/csv': 'csv',
  'text/tab-separated-values': 'csv',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'doc',
  'application/msword': 'doc',
  'application/rtf': 'doc',
  'text/rtf': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'slides',
  'application/vnd.ms-powerpoint': 'slides',
  'model/gltf-binary': 'model3d',
  'model/gltf+json': 'model3d',
};

const EXTENSION_VIEWERS: Readonly<Record<string, PreviewViewerKind>> = {
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  ndjson: 'json',
  yaml: 'structured-text',
  yml: 'structured-text',
  toml: 'structured-text',
  xml: 'structured-text',
  csv: 'csv',
  tsv: 'csv',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  docx: 'doc',
  doc: 'doc',
  rtf: 'doc',
  pptx: 'slides',
  ppt: 'slides',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  avif: 'image',
  heic: 'image',
  html: 'html',
  htm: 'html',
  mp4: 'video',
  mov: 'video',
  m4v: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  aac: 'audio',
  flac: 'audio',
  ogg: 'audio',
  glb: 'model3d',
  gltf: 'model3d',
  vrm: 'model3d',
};

const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'rs',
  'py',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'cc',
  'hpp',
  'cs',
  'php',
  'rb',
  'sh',
  'bash',
  'zsh',
  'fish',
  'sql',
  'css',
  'scss',
  'less',
  'vue',
  'svelte',
]);

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/^\./, '') ?? '';
}

function mimeViewerKind(mimeType: string | undefined): PreviewViewerKind | null {
  const mime = normalize(mimeType).split(';', 1)[0] ?? '';
  if (!mime) return null;
  const exact = MIME_VIEWERS[mime];
  if (exact) return exact;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.endsWith('+json')) return 'json';
  if (mime.endsWith('+xml')) return 'structured-text';
  if (
    mime === 'application/javascript' ||
    mime === 'application/typescript' ||
    mime === 'application/x-sh' ||
    mime === 'application/x-shellscript' ||
    mime.startsWith('text/x-')
  ) {
    return 'code';
  }
  if (mime.startsWith('text/')) return 'text';
  return null;
}

export function resolveViewerKind(input: {
  mimeType?: string;
  extension?: string;
  hasText: boolean;
}): PreviewViewerKind {
  const fromMime = mimeViewerKind(input.mimeType);
  if (fromMime) return fromMime;
  const extension = normalize(input.extension);
  const fromExtension = EXTENSION_VIEWERS[extension];
  if (fromExtension) return fromExtension;
  if (CODE_EXTENSIONS.has(extension)) return 'code';
  return input.hasText ? 'text' : 'unsupported';
}

const VIEWER_KIND_LABELS: Readonly<Record<PreviewViewerKind, string>> = {
  text: 'Text',
  code: 'Code',
  json: 'JSON',
  'structured-text': 'Structured text',
  markdown: 'Markdown',
  image: 'Image',
  pdf: 'PDF',
  html: 'HTML',
  csv: 'CSV',
  spreadsheet: 'Spreadsheet',
  doc: 'Document',
  slides: 'Slides',
  video: 'Video',
  audio: 'Audio',
  model3d: '3D model',
  browser: 'Browser',
  screenshot: 'Screenshot',
  unsupported: 'File',
};

export function viewerKindLabel(kind: PreviewViewerKind): string {
  return VIEWER_KIND_LABELS[kind];
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit: (typeof units)[number] = 'KB';
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function trustLevelFor(ref: PreviewSourceRef): ResolvedPreviewTarget['trustLevel'] {
  switch (ref.source) {
    case 'workspace-file':
      return 'workspace';
    case 'deliverable':
      return 'generated';
    case 'computer-artifact':
      return 'computer';
    case 'browser':
    case 'screenshot':
      return 'external';
  }
}

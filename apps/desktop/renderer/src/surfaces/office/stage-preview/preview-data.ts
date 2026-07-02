import { loadDeliverableBody } from '@/data/queries.js';
import type { Deliverable } from '@/data/types.js';
import {
  type PreviewSourceRef,
  type ResolvedPreviewTarget,
  resolveViewerKind,
  trustLevelFor,
} from './preview-target.js';

export type PreviewData =
  | { mode: 'text'; text: string; truncated: boolean }
  | { mode: 'bytes'; bytes: Uint8Array; objectUrl: string }
  | { mode: 'stream'; streamUrl: string }
  | { mode: 'inline-html'; html: string }
  | { mode: 'url'; url: string }
  | { mode: 'screenshot'; dataRef: string }
  | { mode: 'none'; reason: string };

interface ProjectPreviewMeta {
  fileName: string;
  mimeType?: string | null;
  extension?: string | null;
  byteLength: number;
  modifiedAt?: string | null;
  text?: string | null;
  truncated: boolean;
}

export type PreviewLoadMode = PreviewData['mode'];

function isEmbeddablePreviewUrl(url: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(url);
}

export function mediaStreamUrl(path: string, projectId: string | null): string {
  const params = new URLSearchParams({ path });
  if (projectId) params.set('projectId', projectId);
  return `offisim-media://localhost/file?${params.toString()}`;
}

export function planPreviewLoad(
  resolved: ResolvedPreviewTarget,
  hints: { hasText?: boolean; hasScreenshot?: boolean; embeddableUrl?: boolean } = {},
): PreviewLoadMode {
  const { ref, viewerKind } = resolved;
  if (ref.source === 'screenshot') return 'screenshot';
  if (ref.source === 'browser') {
    const url = resolved.meta.url;
    const embeddable = hints.embeddableUrl ?? (url ? isEmbeddablePreviewUrl(url) : false);
    if (url && embeddable) return 'url';
    return hints.hasScreenshot ? 'screenshot' : 'none';
  }
  if (viewerKind === 'html' && (ref.source === 'deliverable' || hints.hasText)) {
    return 'inline-html';
  }
  if (
    viewerKind === 'text' ||
    viewerKind === 'code' ||
    viewerKind === 'json' ||
    viewerKind === 'structured-text' ||
    viewerKind === 'markdown' ||
    viewerKind === 'csv'
  ) {
    return hints.hasText === false ? 'none' : 'text';
  }
  if (viewerKind === 'video' || viewerKind === 'audio') return 'stream';
  if (
    viewerKind === 'image' ||
    viewerKind === 'pdf' ||
    viewerKind === 'doc' ||
    viewerKind === 'spreadsheet' ||
    viewerKind === 'slides' ||
    viewerKind === 'model3d'
  ) {
    return 'bytes';
  }
  return 'none';
}

function extensionFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const leaf = path.replace(/\\/g, '/').split('/').pop() ?? path;
  const index = leaf.lastIndexOf('.');
  if (index <= 0 || index === leaf.length - 1) return undefined;
  return leaf.slice(index + 1).toLowerCase();
}

function mimeForExtension(extension: string | undefined): string | undefined {
  switch (extension?.toLowerCase()) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'yaml':
    case 'yml':
      return 'application/yaml';
    case 'toml':
      return 'application/toml';
    case 'xml':
      return 'application/xml';
    case 'csv':
      return 'text/csv';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'glb':
      return 'model/gltf-binary';
    case 'gltf':
      return 'model/gltf+json';
    default:
      return undefined;
  }
}

function resolvedFromMeta(ref: PreviewSourceRef, meta: ProjectPreviewMeta): ResolvedPreviewTarget {
  const mimeType = meta.mimeType ?? undefined;
  const extension = meta.extension ?? extensionFromPath(meta.fileName);
  const hasText = meta.text != null;
  return {
    ref,
    viewerKind: resolveViewerKind({ mimeType, extension, hasText }),
    trustLevel: trustLevelFor(ref),
    meta: {
      title: meta.fileName,
      path:
        ref.source === 'workspace-file' || ref.source === 'computer-artifact' ? ref.path : undefined,
      mimeType,
      extension,
      byteLength: meta.byteLength,
      modifiedAt: meta.modifiedAt ?? undefined,
    },
  };
}

function resolvedDeliverable(ref: Extract<PreviewSourceRef, { source: 'deliverable' }>) {
  const extension =
    extensionFromPath(ref.name) ??
    (ref.format ? ref.format.trim().toLowerCase().replace(/^\./, '') : undefined);
  const mimeType = mimeForExtension(extension);
  const viewerKind = resolveViewerKind({ mimeType, extension, hasText: true });
  return {
    ref,
    viewerKind,
    trustLevel: trustLevelFor(ref),
    meta: {
      title: ref.name ?? ref.deliverableId,
      mimeType,
      extension,
      threadId: ref.threadId,
    },
  } satisfies ResolvedPreviewTarget;
}

function resolvedBrowser(ref: Extract<PreviewSourceRef, { source: 'browser' }>) {
  return {
    ref,
    viewerKind: 'browser',
    trustLevel: trustLevelFor(ref),
    meta: {
      title: ref.detail?.title ?? ref.url ?? 'Browser preview',
      url: ref.url ?? ref.detail?.url,
    },
  } satisfies ResolvedPreviewTarget;
}

function resolvedScreenshot(ref: Extract<PreviewSourceRef, { source: 'screenshot' }>) {
  return {
    ref,
    viewerKind: 'screenshot',
    trustLevel: trustLevelFor(ref),
    meta: { title: ref.title ?? ref.url ?? 'Screenshot', url: ref.url, mimeType: ref.mimeType },
  } satisfies ResolvedPreviewTarget;
}

function bytesToUint8Array(value: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value);
}

function objectUrlForBytes(bytes: Uint8Array, mimeType: string | undefined): string {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: mimeType ?? 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

async function invokeTauri<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<T>(command, args);
}

async function loadFilePreview(
  ref: Extract<PreviewSourceRef, { source: 'workspace-file' | 'computer-artifact' }>,
  projectId: string | null,
): Promise<{ resolved: ResolvedPreviewTarget; data: PreviewData }> {
  const meta = await invokeTauri<ProjectPreviewMeta>('project_preview_meta', {
    path: ref.path,
    projectId,
  });
  const resolved = resolvedFromMeta(ref, meta);
  const mode = planPreviewLoad(resolved, { hasText: meta.text != null });
  if (mode === 'text') {
    return {
      resolved,
      data:
        meta.text != null
          ? { mode: 'text', text: meta.text, truncated: meta.truncated }
          : { mode: 'none', reason: 'No UTF-8 text preview is available.' },
    };
  }
  if (mode === 'inline-html') {
    return {
      resolved,
      data:
        meta.text != null
          ? { mode: 'inline-html', html: meta.text }
          : { mode: 'none', reason: 'No HTML text preview is available.' },
    };
  }
  if (mode === 'stream') {
    return { resolved, data: { mode: 'stream', streamUrl: mediaStreamUrl(ref.path, projectId) } };
  }
  if (mode === 'bytes') {
    const raw = await invokeTauri<ArrayBuffer | Uint8Array | number[]>('project_read_file_bytes', {
      path: ref.path,
      projectId,
      maxBytes: undefined,
    });
    const bytes = bytesToUint8Array(raw);
    return {
      resolved,
      data: { mode: 'bytes', bytes, objectUrl: objectUrlForBytes(bytes, resolved.meta.mimeType) },
    };
  }
  return { resolved, data: { mode: 'none', reason: 'This file type is not previewable yet.' } };
}

async function loadDeliverablePreview(
  ref: Extract<PreviewSourceRef, { source: 'deliverable' }>,
): Promise<{ resolved: ResolvedPreviewTarget; data: PreviewData }> {
  const resolved = resolvedDeliverable(ref);
  const deliverable: Deliverable = {
    id: ref.deliverableId,
    threadId: ref.threadId,
    name: ref.name ?? ref.deliverableId,
    kind: ref.format ?? 'document',
    contributorIds: [],
    fileName: ref.name,
    mimeType: resolved.meta.mimeType,
    format: ref.format,
  };
  const body = await loadDeliverableBody(deliverable);
  const mode = planPreviewLoad(resolved, { hasText: true });
  if (mode === 'inline-html') return { resolved, data: { mode: 'inline-html', html: body } };
  return { resolved, data: { mode: 'text', text: body, truncated: false } };
}

export async function loadPreview(
  ref: PreviewSourceRef,
  projectId: string | null,
): Promise<{ resolved: ResolvedPreviewTarget; data: PreviewData }> {
  switch (ref.source) {
    case 'workspace-file':
    case 'computer-artifact':
      return await loadFilePreview(ref, projectId);
    case 'deliverable':
      return await loadDeliverablePreview(ref);
    case 'browser': {
      const resolved = resolvedBrowser(ref);
      const mode = planPreviewLoad(resolved, { hasScreenshot: Boolean(ref.detail?.screenshot) });
      if (mode === 'url' && resolved.meta.url) {
        return { resolved, data: { mode: 'url', url: resolved.meta.url } };
      }
      if (mode === 'screenshot' && ref.detail?.screenshot?.dataRef) {
        return { resolved, data: { mode: 'screenshot', dataRef: ref.detail.screenshot.dataRef } };
      }
      return { resolved, data: { mode: 'none', reason: 'No embeddable URL or screenshot is available.' } };
    }
    case 'screenshot':
      return { resolved: resolvedScreenshot(ref), data: { mode: 'screenshot', dataRef: ref.dataRef } };
  }
}

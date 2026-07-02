import type { StageViewTarget } from '@/app/ui-state.js';
import type { ClaimableArtifact } from '@/assistant/runtime/scene-cue-projection.js';
import type { ToolRichDetail } from '@offisim/shared-types';
import { openStageFilePreview } from './file-preview.js';

/**
 * The resolved stage intent for a claim: a deterministic projection of a
 * {@link ClaimableArtifact} onto one of the openable stage kinds.
 */
export type ArtifactClaimResolution =
  | { kind: 'output'; deliverableId: string; threadId: string | null; title?: string }
  | {
      kind: 'preview';
      title?: string;
      url?: string;
      sourceId?: string;
      threadId?: string;
      deliverableId?: string;
      detail?: Extract<ToolRichDetail, { family: 'browser' }>;
    }
  | { kind: 'file'; path: string; title?: string }
  | { kind: 'logs'; title?: string; tool?: string; sourceId?: string; detail?: ToolRichDetail };

const FILE_PREVIEW_BYTES = 64 * 1024;

/**
 * Pure projection of a claim onto a single stage resolution. Priority:
 *  1. a deliverable id → the durable output surface;
 *  2. else a url or a browser-family rich detail → a preview surface;
 *  3. else a filesystem path → an inline file surface;
 *  4. else → a logs surface (the generic fallback).
 */
export function resolveArtifactClaim(a: ClaimableArtifact): ArtifactClaimResolution {
  if (a.deliverableId) {
    return {
      kind: 'output',
      deliverableId: a.deliverableId,
      threadId: a.threadId ?? null,
      title: a.title,
    };
  }
  const browserDetail = a.detail && a.detail.family === 'browser' ? a.detail : undefined;
  if (a.url || browserDetail) {
    return {
      kind: 'preview',
      title: a.title,
      url: a.url,
      sourceId: a.sourceId,
      threadId: a.threadId ?? undefined,
      ...(browserDetail ? { detail: browserDetail } : {}),
    };
  }
  if (a.path) {
    return { kind: 'file', path: a.path, title: a.title };
  }
  return { kind: 'logs', title: a.title, sourceId: a.sourceId, detail: a.detail };
}

/**
 * Resolve a claim and open it on the stage. Output/preview/logs open directly as
 * stage targets; a file claim mirrors the workspace file-preview flow (loading →
 * sandboxed `project_read_file_preview` → content), degrading to an error target
 * outside the desktop runtime or on failure.
 */
export async function openArtifactClaim(
  a: ClaimableArtifact,
  deps: { openStageView: (target: StageViewTarget) => void; projectId: string | null },
): Promise<void> {
  const { openStageView, projectId } = deps;
  const resolution = resolveArtifactClaim(a);

  if (resolution.kind !== 'file') {
    openStageView(resolution);
    return;
  }

  await openStageFilePreview({
    path: resolution.path,
    openStageView,
    projectId,
    maxBytes: FILE_PREVIEW_BYTES,
  });
}

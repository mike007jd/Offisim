import type { StageViewTarget } from '@/app/ui-state.js';
import type { ClaimableArtifact } from '@/assistant/runtime/scene-cue-projection.js';
import type { ToolRichDetail } from '@offisim/shared-types';
import type { PreviewSourceRef } from '../stage-preview/preview-target.js';

/**
 * The resolved stage intent for a claim: a deterministic projection of a
 * {@link ClaimableArtifact} onto one of the openable stage kinds.
 */
export type ArtifactClaimResolution =
  | { kind: 'preview'; ref: PreviewSourceRef; title?: string }
  | { kind: 'logs'; title?: string; tool?: string; sourceId?: string; detail?: ToolRichDetail };

/**
 * Pure projection of a claim onto a single stage resolution. Priority:
 *  1. a deliverable id → a generated preview source;
 *  2. else a url or a browser-family rich detail → a preview surface;
 *  3. else a filesystem path → a workspace-file preview source;
 *  4. else → a logs surface (the generic fallback).
 */
export function resolveArtifactClaim(a: ClaimableArtifact): ArtifactClaimResolution {
  if (a.deliverableId) {
    return {
      kind: 'preview',
      ref: {
        source: 'deliverable',
        deliverableId: a.deliverableId,
        threadId: a.threadId ?? null,
        format: a.kind,
        name: a.title,
      },
      title: a.title,
    };
  }
  const browserDetail = a.detail && a.detail.family === 'browser' ? a.detail : undefined;
  if (a.url || browserDetail) {
    return {
      kind: 'preview',
      ref: {
        source: 'browser',
        sourceId: a.sourceId,
        url: a.url ?? browserDetail?.url,
        ...(browserDetail ? { detail: browserDetail } : {}),
      },
      title: a.title,
    };
  }
  if (a.path) {
    return { kind: 'preview', ref: { source: 'workspace-file', path: a.path }, title: a.title };
  }
  return { kind: 'logs', title: a.title, sourceId: a.sourceId, detail: a.detail };
}

/**
 * Resolve a claim and open it on the stage. Every visual artifact enters the
 * unified preview target; non-visual tool details stay in the logs surface.
 */
export async function openArtifactClaim(
  a: ClaimableArtifact,
  deps: { openStageView: (target: StageViewTarget) => void; projectId: string | null },
): Promise<void> {
  const resolution = resolveArtifactClaim(a);
  deps.openStageView(resolution);
}

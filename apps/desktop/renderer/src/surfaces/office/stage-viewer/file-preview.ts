import type { StageViewTarget } from '@/app/ui-state.js';

/**
 * Open a workspace file on the unified preview stage. The preview pane owns the
 * sandboxed metadata/body reads, so callers only need to project a file path
 * into a stable stage target.
 */
export async function openStageFilePreview(deps: {
  path: string;
  openStageView: (target: StageViewTarget) => void;
  projectId: string | null;
  maxBytes: number;
}): Promise<void> {
  const { path, openStageView } = deps;
  // No explicit title: tab label and pane header derive the leaf name from the
  // ref, and the full path stays available as the tab tooltip.
  openStageView({ kind: 'preview', ref: { source: 'workspace-file', path } });
}

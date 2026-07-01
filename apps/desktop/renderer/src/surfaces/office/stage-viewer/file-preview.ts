import type { StageViewTarget } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';

interface FilePreviewState {
  content: string;
  truncated: boolean;
  totalSize: number;
}

/**
 * Open a workspace file inline on the stage, mirroring the sandboxed preview
 * flow: emit a loading target, read bounded content through the
 * `project_read_file_preview` Tauri command, then emit content — or an error
 * target outside the desktop runtime / on failure. Shared by the workspace file
 * tree and the artifact-claim resolver so both open files through one path.
 */
export async function openStageFilePreview(deps: {
  path: string;
  openStageView: (target: StageViewTarget) => void;
  projectId: string | null;
  maxBytes: number;
}): Promise<void> {
  const { path, openStageView, projectId, maxBytes } = deps;
  openStageView({ kind: 'file', path, loading: true });
  if (!isTauriRuntime()) {
    openStageView({ kind: 'file', path, error: 'File preview requires the desktop runtime.' });
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<FilePreviewState>('project_read_file_preview', {
      path,
      cwd: null,
      maxBytes,
      projectId,
    });
    openStageView({
      kind: 'file',
      path,
      content: result.content,
      truncated: result.truncated,
      totalSize: result.totalSize,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'File preview failed.';
    openStageView({ kind: 'file', path, error: message });
  }
}

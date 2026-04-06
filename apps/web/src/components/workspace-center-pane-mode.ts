import type { AppView } from '../lib/app-view-layout';

export type WorkspaceCenterPaneMode = 'office-scene' | 'workspace-surface' | 'none';

export function getWorkspaceCenterPaneMode(view: AppView): WorkspaceCenterPaneMode {
  if (view === 'office') {
    return 'office-scene';
  }

  if (
    view === 'sops' ||
    view === 'market' ||
    view === 'activity-log' ||
    view === 'library' ||
    view === 'server'
  ) {
    return 'workspace-surface';
  }

  return 'none';
}

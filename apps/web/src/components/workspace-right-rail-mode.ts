import type { AppView } from '../lib/app-view-layout';

export type WorkspaceRightRailMode =
  | 'office'
  | 'tasks'
  | 'collaboration'
  | 'spaces-and-collaboration';

export function getWorkspaceRightRailMode(view: AppView): WorkspaceRightRailMode {
  if (view === 'office') {
    return 'office';
  }

  if (view === 'activity-log') {
    return 'tasks';
  }

  if (view === 'sops') {
    return 'collaboration';
  }

  return 'spaces-and-collaboration';
}

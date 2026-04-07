import type { Zone } from '@offisim/shared-types';
import { BookOpen, Database, GitBranch, ScrollText, Store } from 'lucide-react';

export type WorkspaceSurfaceView = 'sops' | 'market' | 'activity-log' | 'library' | 'server';

export const WORKSPACE_SURFACE_META: Record<
  WorkspaceSurfaceView,
  {
    label: string;
    icon: typeof GitBranch | typeof Store | typeof ScrollText | typeof BookOpen | typeof Database;
    entryDescription?: string;
  }
> = {
  sops: { label: 'SOPs', icon: GitBranch },
  market: { label: 'Market', icon: Store },
  'activity-log': { label: 'Activity Log', icon: ScrollText },
  library: {
    label: 'Library',
    icon: BookOpen,
    entryDescription:
      'Open the office knowledge shelf without promoting it to a permanent global tab.',
  },
  server: {
    label: 'Server Room',
    icon: Database,
    entryDescription:
      'Inspect infrastructure as part of the office environment instead of the chat rail.',
  },
};

const OFFICE_SPACE_ENTRY_VIEWS: WorkspaceSurfaceView[] = ['library', 'server'];

export function hasWorkspaceSurfaceZone(view: WorkspaceSurfaceView, zones: Zone[]): boolean {
  if (view === 'library') {
    return zones.some((zone) => zone.archetype === 'library');
  }
  if (view === 'server') {
    return zones.some((zone) => zone.archetype === 'server');
  }
  return true;
}

export function getOfficeSpaceEntryViews(zones: Zone[]): WorkspaceSurfaceView[] {
  return OFFICE_SPACE_ENTRY_VIEWS.filter((view) => hasWorkspaceSurfaceZone(view, zones));
}

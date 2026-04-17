import type { ZoneArchetype } from '@offisim/shared-types';

/** SVG path data for archetype icons (from lucide-react, 24x24 viewBox). */
export const ARCHETYPE_ICONS: Record<ZoneArchetype, { path: string; label: string }> = {
  workspace: {
    label: 'Workspace',
    // Monitor icon
    path: 'M2 3h20v14H2zM8 21h8M12 17v4',
  },
  meeting: {
    label: 'Meeting',
    // Users icon
    path: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  },
  library: {
    label: 'Library',
    // BookOpen icon
    path: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  },
  rest: {
    label: 'Rest Area',
    // Coffee icon
    path: 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2',
  },
  server: {
    label: 'Server',
    // Server icon
    path: 'M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 15a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM6 7h.01M6 17h.01',
  },
};

// Lock icon for required zones
export const LOCK_ICON_PATH =
  'M5 11V7a5 5 0 0 1 10 0v4M3 11h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z';

export function getFloorPatternId(archetype: ZoneArchetype | null): string {
  return archetype ? `floor-${archetype}` : 'floor-default';
}

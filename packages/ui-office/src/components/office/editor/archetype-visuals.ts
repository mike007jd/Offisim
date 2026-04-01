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

/** SVG pattern definitions for zone floor textures per archetype. */
export function getFloorPatternId(archetype: ZoneArchetype | null): string {
  return archetype ? `floor-${archetype}` : 'floor-default';
}

/** Static SVG pattern markup for zone floor textures (injected once into <defs>). */
export const FLOOR_PATTERNS_SVG = `
    <pattern id="floor-workspace" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="0" y1="8" x2="8" y2="0" stroke="currentColor" stroke-width="0.3" opacity="0.08"/>
    </pattern>
    <pattern id="floor-meeting" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="0.5" fill="currentColor" opacity="0.08"/>
    </pattern>
    <pattern id="floor-library" width="10" height="4" patternUnits="userSpaceOnUse">
      <line x1="0" y1="2" x2="10" y2="2" stroke="currentColor" stroke-width="0.4" opacity="0.06"/>
    </pattern>
    <pattern id="floor-rest" width="12" height="6" patternUnits="userSpaceOnUse">
      <path d="M0 3 Q3 0 6 3 T12 3" fill="none" stroke="currentColor" stroke-width="0.3" opacity="0.07"/>
    </pattern>
    <pattern id="floor-server" width="8" height="8" patternUnits="userSpaceOnUse">
      <line x1="4" y1="0" x2="4" y2="8" stroke="currentColor" stroke-width="0.2" opacity="0.06"/>
      <line x1="0" y1="4" x2="8" y2="4" stroke="currentColor" stroke-width="0.2" opacity="0.06"/>
    </pattern>
    <pattern id="floor-default" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="0.3" fill="currentColor" opacity="0.05"/>
    </pattern>
    <pattern id="overlap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#ef4444" stroke-width="1" opacity="0.3"/>
    </pattern>
  `;

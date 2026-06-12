import type { ZoneArchetype } from '@offisim/shared-types';
import { BookOpen, LayoutGrid, type LucideIcon, PanelTop, Server, Sofa } from 'lucide-react';

/** Single source for zone-archetype glyphs across the Studio panels. */
export const ZONE_ARCHETYPE_ICON: Record<ZoneArchetype, LucideIcon> = {
  workspace: LayoutGrid,
  meeting: PanelTop,
  server: Server,
  library: BookOpen,
  rest: Sofa,
};

export function zoneArchetypeIcon(archetype: string | null): LucideIcon {
  return (archetype && ZONE_ARCHETYPE_ICON[archetype as ZoneArchetype]) || LayoutGrid;
}

import type { SurfaceKey } from '@/app/ui-state.js';
import {
  Activity,
  BriefcaseBusiness,
  LayoutGrid,
  type LucideIcon,
  MessagesSquare,
  Settings,
  Store,
  UsersRound,
} from 'lucide-react';

export interface NavEntry {
  key: SurfaceKey;
  label: string;
  icon: LucideIcon;
  tier: 'primary' | 'utility';
}

/**
 * Single source of truth for surface navigation. WorkspaceNav (both tiers:
 * primary as text tabs, utility icon-only past the divider) and the command
 * palette render from this list, so labels/icons/reachability never drift
 * across the entry points.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { key: 'office', label: 'Office', icon: BriefcaseBusiness, tier: 'primary' },
  // 'Apps' disambiguates the suite from the Office surface (both once read "work…").
  { key: 'workspace', label: 'Apps', icon: MessagesSquare, tier: 'primary' },
  { key: 'market', label: 'Market', icon: Store, tier: 'primary' },
  { key: 'personnel', label: 'Personnel', icon: UsersRound, tier: 'primary' },
  { key: 'activity', label: 'Activity', icon: Activity, tier: 'utility' },
  { key: 'settings', label: 'Settings', icon: Settings, tier: 'utility' },
  { key: 'studio', label: 'Studio', icon: LayoutGrid, tier: 'utility' },
];

export const PRIMARY_NAV = NAV_ENTRIES.filter((e) => e.tier === 'primary');
export const UTILITY_NAV = NAV_ENTRIES.filter((e) => e.tier === 'utility');

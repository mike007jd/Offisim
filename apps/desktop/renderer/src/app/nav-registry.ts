import type { SurfaceKey } from '@/app/ui-state.js';
import {
  Activity,
  BriefcaseBusiness,
  type LucideIcon,
  MessagesSquare,
  PencilRuler,
  Settings,
  Store,
  Target,
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
  // 'Connect' is the company's daily communication space (chat / calendar /
  // contacts / tools), distinct from Office's live 3D project work. The surface
  // key stays 'workspace' as a legacy internal identifier so this rename does
  // not ripple through routing/state — only the user-visible label changes.
  { key: 'workspace', label: 'Connect', icon: MessagesSquare, tier: 'primary' },
  // The Missions surface is now the prompt-first **Loops** product (PR-08). The
  // internal surface key stays 'mission' as a compatibility alias so routing,
  // ui-state, and the command palette do not ripple — only the user-visible
  // label / aria / palette text becomes "Loops". Old Missions live on as Legacy
  // Runs inside this surface.
  { key: 'mission', label: 'Loops', icon: Target, tier: 'primary' },
  { key: 'market', label: 'Market', icon: Store, tier: 'primary' },
  { key: 'personnel', label: 'Personnel', icon: UsersRound, tier: 'primary' },
  { key: 'activity', label: 'Activity', icon: Activity, tier: 'utility' },
  { key: 'settings', label: 'Settings', icon: Settings, tier: 'utility' },
  { key: 'studio', label: 'Studio', icon: PencilRuler, tier: 'utility' },
];

/** @public — asserted by scripts/check-ui-framework-hygiene.mjs (content match, not import). */
export const PRIMARY_NAV = NAV_ENTRIES.filter((e) => e.tier === 'primary');
export const UTILITY_NAV = NAV_ENTRIES.filter((e) => e.tier === 'utility');

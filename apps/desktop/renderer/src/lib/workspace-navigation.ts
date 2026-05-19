import {
  Activity,
  Building2,
  LayoutDashboard,
  PenTool,
  Settings as SettingsIcon,
  Store,
  Users,
  Workflow,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { WorkspaceKey } from '../components/workspaces/types';

export type NavIcon = ComponentType<{ className?: string }>;

export interface PeerWorkspaceNavItem {
  /** Workspace key this item activates. */
  key: WorkspaceKey;
  label: string;
  icon: NavIcon;
}

export type OfficeToolId = 'studio' | 'dashboard';

export interface OfficeToolNavItem {
  key: OfficeToolId;
  label: string;
  icon: NavIcon;
  /** Accelerator display text (e.g. "⌘D"). */
  shortcut?: string;
  /** Whether the tool appears pressed/active given current state. */
  isActive?: boolean;
  /** Disabled + reason when unavailable (e.g., no active company). */
  disabled?: boolean;
  disabledReason?: string;
  /** Hidden entirely (e.g., Studio hidden for external-only companies). */
  hidden?: boolean;
  onActivate: () => void;
}

export interface NavigationConfig {
  peerWorkspaces: PeerWorkspaceNavItem[];
  officeTools: OfficeToolNavItem[];
}

export const PEER_WORKSPACE_ITEMS: ReadonlyArray<PeerWorkspaceNavItem> = [
  { key: 'office', label: 'Office', icon: Building2 },
  { key: 'sops', label: 'SOPs', icon: Workflow },
  { key: 'market', label: 'Market', icon: Store },
  { key: 'personnel', label: 'Personnel', icon: Users },
  { key: 'activity-log', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export const OFFICE_TOOL_ICON: Record<OfficeToolId, NavIcon> = {
  studio: PenTool,
  dashboard: LayoutDashboard,
};

export const OFFICE_TOOL_LABEL: Record<OfficeToolId, string> = {
  studio: 'Studio',
  dashboard: 'Dashboard',
};

export const OFFICE_TOOL_SHORTCUT: Record<OfficeToolId, string | undefined> = {
  studio: undefined,
  dashboard: '⌘D',
};

export interface BuildOfficeToolsOptions {
  hasActiveCompany: boolean;
  dashboardOpen: boolean;
  onOpenStudio: () => void;
  onToggleDashboard: () => void;
}

export function buildOfficeToolItems(opts: BuildOfficeToolsOptions): OfficeToolNavItem[] {
  const disabledBase = !opts.hasActiveCompany;
  const disabledReason = disabledBase ? 'Select or create a company first' : undefined;
  return (['studio', 'dashboard'] as const).map((id) => {
    const base = {
      key: id,
      label: OFFICE_TOOL_LABEL[id],
      icon: OFFICE_TOOL_ICON[id],
      shortcut: OFFICE_TOOL_SHORTCUT[id],
      disabled: disabledBase,
      disabledReason,
    };
    switch (id) {
      case 'studio':
        return { ...base, onActivate: opts.onOpenStudio };
      case 'dashboard':
        return {
          ...base,
          isActive: opts.dashboardOpen,
          onActivate: opts.onToggleDashboard,
        };
    }
  });
}

/**
 * Determines whether an Office tool entry should render as-is, collapse into an
 * overflow group, or be hidden outside Office mode.
 */
export function visibleOfficeToolsFor(
  activeWorkspace: WorkspaceKey,
  tools: OfficeToolNavItem[],
): OfficeToolNavItem[] {
  if (activeWorkspace !== 'office') return [];
  return tools.filter((tool) => !tool.hidden);
}

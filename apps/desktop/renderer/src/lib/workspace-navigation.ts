import {
  Activity,
  Building2,
  LayoutGrid,
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

export type OfficeToolId = 'studio';

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
  { key: 'workspace', label: 'Workspace', icon: LayoutGrid },
  { key: 'sops', label: 'SOPs', icon: Workflow },
  { key: 'market', label: 'Market', icon: Store },
  { key: 'personnel', label: 'Personnel', icon: Users },
  { key: 'activity-log', label: 'Activity', icon: Activity },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export const OFFICE_TOOL_ICON: Record<OfficeToolId, NavIcon> = {
  studio: PenTool,
};

export const OFFICE_TOOL_LABEL: Record<OfficeToolId, string> = {
  studio: 'Studio',
};

export const OFFICE_TOOL_SHORTCUT: Record<OfficeToolId, string | undefined> = {
  studio: undefined,
};

export interface BuildOfficeToolsOptions {
  hasActiveCompany: boolean;
  onOpenStudio: () => void;
}

export function buildOfficeToolItems(opts: BuildOfficeToolsOptions): OfficeToolNavItem[] {
  const disabledBase = !opts.hasActiveCompany;
  const disabledReason = disabledBase ? 'Select or create a company first' : undefined;
  return [
    {
      key: 'studio',
      label: OFFICE_TOOL_LABEL.studio,
      icon: OFFICE_TOOL_ICON.studio,
      shortcut: OFFICE_TOOL_SHORTCUT.studio,
      disabled: disabledBase,
      disabledReason,
      onActivate: opts.onOpenStudio,
    },
  ];
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

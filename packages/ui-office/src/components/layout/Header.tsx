import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EntityDropdown,
  type EntityDropdownItem,
  SegmentedControl,
  useFocusTrap,
  useRegisterModal,
  useTopmostEscape,
} from '@offisim/ui-core';
import { Building2, ChevronDown, Menu, MoreHorizontal, X } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useCompany } from '../company/CompanyContext.js';
import { FileImportTrigger } from '../install/FileImportTrigger.js';
import { useTourTarget } from '../onboarding/tour-context.js';

type WorkspaceKey =
  | 'office'
  | 'sops'
  | 'market'
  | 'personnel'
  | 'workspace'
  | 'activity-log'
  | 'settings';

type HeaderIcon = ComponentType<{ className?: string }>;

export interface HeaderPeerWorkspaceItem {
  key: WorkspaceKey;
  label: string;
  icon: HeaderIcon;
}

export interface HeaderOfficeToolItem {
  key: string;
  label: string;
  icon: HeaderIcon;
  shortcut?: string;
  isActive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onActivate: () => void;
}

interface HeaderProps {
  companyName?: string;
  onOpenSettings: () => void;
  onOpenCompanySelect?: () => void;
  onFileImport: (file: File) => void;
  projectSlot?: ReactNode;
  modeSlot?: ReactNode;
  viewMode?: '2D' | '3D';
  onViewModeChange?: (mode: '2D' | '3D') => void;
  /**
   * Fires on every view-mode segment click, including same-value clicks. Wires the
   * 3D ghost-state recovery signal from `SceneCanvas` (`viewModeNonce`).
   */
  onViewModeClick?: (mode: '2D' | '3D') => void;
  needsConfig?: boolean;
  activeWorkspace?: WorkspaceKey;
  workspaceTitle?: string;
  /** Peer workspace navigation (Office/SOPs/Market/Activity/Settings). Always visible. */
  peerWorkspaces: ReadonlyArray<HeaderPeerWorkspaceItem>;
  onSelectWorkspace: (key: WorkspaceKey) => void;
  /** Office-scoped tools. Rendered only when activeWorkspace === 'office'. */
  officeTools?: ReadonlyArray<HeaderOfficeToolItem>;
}

const DRAWER_STACK_ID = 'header:workspace-drawer';

interface HeaderSlots {
  title: string;
  viewMode: ReactNode;
  company: ReactNode;
  project: ReactNode;
  peerNav: ReactNode;
  iconbar: ReactNode;
  apiSettings: ReactNode;
  mode: ReactNode;
  officeTools: ReactNode;
  marketActions: ReactNode;
}

/** Peers that render as centered nav pills (vs. the Activity/Settings iconbar). */
const NAV_PILL_KEYS: ReadonlySet<WorkspaceKey> = new Set([
  'office',
  'workspace',
  'sops',
  'market',
  'personnel',
]);
const ICONBAR_KEYS: ReadonlyArray<WorkspaceKey> = ['activity-log', 'settings'];

export function Header({
  companyName,
  onOpenSettings,
  onOpenCompanySelect,
  onFileImport,
  projectSlot,
  modeSlot,
  viewMode,
  onViewModeChange,
  onViewModeClick,
  needsConfig,
  activeWorkspace = 'office',
  workspaceTitle,
  peerWorkspaces,
  onSelectWorkspace,
  officeTools,
}: HeaderProps) {
  const isOffice = activeWorkspace === 'office';
  const { tier } = useLayoutTier();
  const isNarrow = tier === 'narrow';
  const [drawerOpen, setDrawerOpen] = useState(false);

  const providerCtaRef = useTourTarget('settings:provider-cta');
  const projectSelectorRef = useTourTarget('office:project-selector');
  const personnelRef = useTourTarget('personnel:nav-button');
  const marketRef = useTourTarget('market:nav-button');

  const drawerStackId = drawerOpen ? DRAWER_STACK_ID : null;
  useRegisterModal(drawerStackId, 'overlay');
  useTopmostEscape(drawerStackId, () => setDrawerOpen(false), { enabled: drawerOpen });
  const drawerRef = useRef<HTMLElement | null>(null);
  useFocusTrap(drawerRef, drawerOpen);

  const slots: HeaderSlots = {
    title: isOffice ? companyName || 'Office' : workspaceTitle || 'Workspace',
    viewMode:
      isOffice && viewMode && onViewModeChange ? (
        <ViewModeToggle
          value={viewMode}
          onChange={onViewModeChange}
          onSegmentClick={onViewModeClick}
        />
      ) : null,
    company: onOpenCompanySelect ? (
      <CompanySwitcher currentName={companyName} onManageCompanies={onOpenCompanySelect} />
    ) : null,
    project: projectSlot ? <span ref={projectSelectorRef}>{projectSlot}</span> : null,
    peerNav: (
      <PeerWorkspaceNav
        items={peerWorkspaces.filter((item) => NAV_PILL_KEYS.has(item.key))}
        active={activeWorkspace}
        onSelect={onSelectWorkspace}
        personnelRef={personnelRef}
        marketRef={marketRef}
      />
    ),
    iconbar: (
      <WorkspaceIconBar
        items={peerWorkspaces.filter((item) => ICONBAR_KEYS.includes(item.key))}
        active={activeWorkspace}
        onSelect={onSelectWorkspace}
        officeTools={isOffice ? officeTools : undefined}
      />
    ),
    apiSettings: needsConfig ? (
      <Button
        ref={providerCtaRef}
        type="button"
        variant="secondary"
        size="sm"
        onClick={onOpenSettings}
        title="Open API and model settings"
        aria-label="Open API and model settings"
      >
        API Settings
      </Button>
    ) : null,
    mode: isOffice ? modeSlot : null,
    // Office tools (Studio) render inside the iconbar (after a divider); the
    // narrow drawer still surfaces them via this slot.
    officeTools:
      isOffice && officeTools && officeTools.length > 0 ? (
        <OfficeToolBar items={officeTools} />
      ) : null,
    marketActions:
      activeWorkspace === 'market' ? (
        <FileImportTrigger onFileSelect={onFileImport} compact />
      ) : null,
  };

  if (isNarrow) {
    return (
      <NarrowHeader
        slots={slots}
        isOffice={isOffice}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        onViewModeClick={onViewModeClick}
        peerWorkspaces={peerWorkspaces}
        activeWorkspace={activeWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        drawerOpen={drawerOpen}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCloseDrawer={() => setDrawerOpen(false)}
        drawerRef={drawerRef}
        companyName={companyName}
        onOpenCompanySelect={onOpenCompanySelect}
        onOpenSettings={onOpenSettings}
        needsConfig={needsConfig}
        providerCtaRef={providerCtaRef}
        personnelRef={personnelRef}
        marketRef={marketRef}
        projectSelectorRef={projectSelectorRef}
      />
    );
  }

  return <DesktopHeader slots={slots} />;
}

// ---------------------------------------------------------------------------
// Desktop layout
// ---------------------------------------------------------------------------

function DesktopHeader({ slots }: { slots: HeaderSlots }) {
  return (
    <header className="app-header-desktop">
      <div className="app-header-left">
        {slots.viewMode}
        {slots.company}
        {slots.project}
      </div>

      <div className="app-header-center">{slots.peerNav}</div>

      <div className="app-header-right">
        {slots.apiSettings}
        {slots.mode}
        {slots.iconbar}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Narrow layout (top bar + drawer)
// ---------------------------------------------------------------------------

interface NarrowHeaderProps {
  slots: HeaderSlots;
  isOffice: boolean;
  viewMode?: '2D' | '3D';
  onViewModeChange?: (mode: '2D' | '3D') => void;
  onViewModeClick?: (mode: '2D' | '3D') => void;
  peerWorkspaces: ReadonlyArray<HeaderPeerWorkspaceItem>;
  activeWorkspace: WorkspaceKey;
  onSelectWorkspace: (key: WorkspaceKey) => void;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
  drawerRef: React.RefObject<HTMLElement | null>;
  companyName?: string;
  onOpenCompanySelect?: () => void;
  onOpenSettings: () => void;
  needsConfig?: boolean;
  providerCtaRef: (el: HTMLElement | null) => void;
  personnelRef: (el: HTMLElement | null) => void;
  marketRef: (el: HTMLElement | null) => void;
  projectSelectorRef: (el: HTMLElement | null) => void;
}

function NarrowHeader({
  slots,
  isOffice,
  viewMode,
  onViewModeChange,
  onViewModeClick,
  peerWorkspaces,
  activeWorkspace,
  onSelectWorkspace,
  drawerOpen,
  onOpenDrawer,
  onCloseDrawer,
  drawerRef,
  companyName,
  onOpenCompanySelect,
  onOpenSettings,
  needsConfig,
  providerCtaRef,
  personnelRef,
  marketRef,
  projectSelectorRef,
}: NarrowHeaderProps) {
  return (
    <>
      <header className="app-header-narrow" data-layout-tier="narrow">
        <Button
          ref={
            activeWorkspace === 'personnel'
              ? personnelRef
              : activeWorkspace === 'market'
                ? marketRef
                : undefined
          }
          type="button"
          variant="secondary"
          size="icon"
          aria-label="Open workspace menu"
          onClick={onOpenDrawer}
          className="app-header-narrow-button"
        >
          <Menu data-icon="header-menu" aria-hidden="true" />
        </Button>
        <h1 className="app-header-narrow-title">{slots.title}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={isOffice ? projectSelectorRef : undefined}
              type="button"
              variant="secondary"
              size="icon"
              aria-label="More actions"
              className="app-header-narrow-button"
            >
              <MoreHorizontal data-icon="header-more" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="app-header-menu-content">
            <div className="app-header-menu-stack">
              {isOffice && viewMode && onViewModeChange ? (
                <div className="app-header-menu-panel">
                  <ViewModeToggle
                    value={viewMode}
                    onChange={onViewModeChange}
                    onSegmentClick={onViewModeClick}
                  />
                </div>
              ) : null}
              {slots.project ? <div className="app-header-menu-pad">{slots.project}</div> : null}
              {isOffice && slots.mode ? (
                <div className="app-header-menu-pad">{slots.mode}</div>
              ) : null}
              {isOffice && slots.officeTools ? (
                <div className="app-header-menu-pad">{slots.officeTools}</div>
              ) : null}
              {slots.marketActions}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {drawerOpen && (
        <div className="app-header-drawer-layer" role="presentation">
          <Button
            type="button"
            variant="ghost"
            aria-label="Close workspace menu"
            className="app-header-drawer-scrim"
            onClick={onCloseDrawer}
          />
          <aside
            ref={drawerRef}
            // biome-ignore lint/a11y/useSemanticElements: aside hosts side-anchored drawer chrome with custom focus trap
            role="dialog"
            aria-modal="true"
            aria-label="Workspace menu"
            tabIndex={-1}
            className="app-header-drawer"
          >
            <div className="app-header-drawer-head">
              <div>
                <p>Workspace</p>
                <p>{companyName || 'Select Company'}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Close workspace menu"
                onClick={onCloseDrawer}
                className="app-header-drawer-close"
              >
                <X data-icon="drawer-close" aria-hidden="true" />
              </Button>
            </div>
            <div className="app-header-drawer-nav">
              {peerWorkspaces.map((item) => {
                const Icon = item.icon;
                const selected = item.key === activeWorkspace;
                return (
                  <a
                    key={item.key}
                    href={workspaceHref(item.key)}
                    ref={
                      item.key === 'personnel'
                        ? personnelRef
                        : item.key === 'market'
                          ? marketRef
                          : undefined
                    }
                    aria-current={selected ? 'page' : undefined}
                    onClick={(event) => {
                      activateWorkspaceLink(event, item.key, onSelectWorkspace);
                      onCloseDrawer();
                    }}
                    className="app-header-drawer-link"
                    data-selected={selected || undefined}
                  >
                    <Icon data-icon="drawer-nav" />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
            <div className="app-header-drawer-actions">
              {onOpenCompanySelect && (
                <Button
                  ref={providerCtaRef}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpenCompanySelect();
                    onCloseDrawer();
                  }}
                  className="app-header-drawer-action"
                >
                  Switch Company
                </Button>
              )}
              {needsConfig && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onOpenSettings();
                    onCloseDrawer();
                  }}
                  className="app-header-drawer-action"
                >
                  Open API Settings
                </Button>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ViewModeToggle({
  value,
  onChange,
  onSegmentClick,
}: {
  value: '2D' | '3D';
  onChange: (mode: '2D' | '3D') => void;
  onSegmentClick?: (mode: '2D' | '3D') => void;
}) {
  return (
    <SegmentedControl
      size="sm"
      ariaLabel="Office view mode"
      value={value}
      onChange={onChange}
      onSelectClick={onSegmentClick}
      items={[
        { value: '3D', label: '3D', ariaLabel: 'Switch to 3D office view' },
        { value: '2D', label: '2D', ariaLabel: 'Switch to 2D office view' },
      ]}
    />
  );
}

function CompanySwitcher({
  currentName,
  onManageCompanies,
}: {
  currentName?: string;
  onManageCompanies: () => void;
}) {
  const { companies, activeCompanyId, switchCompany } = useCompany();
  const visibleCompanies = companies.filter((company) => company.status !== 'archived').slice(0, 8);

  const items: EntityDropdownItem[] = visibleCompanies.map((company) => ({
    id: company.company_id,
    label: company.name,
    icon: <Building2 className="app-header-company-item-icon" />,
  }));

  return (
    <EntityDropdown
      title="Companies"
      items={items}
      activeId={activeCompanyId}
      onSelect={(id) => switchCompany(id)}
      footerAction={{ label: 'Manage companies', onSelect: onManageCompanies }}
      emptyText="No companies yet."
      align="start"
      collisionPadding={8}
      contentClassName="w-72"
      trigger={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="app-header-company-trigger"
          title="Switch Company"
        >
          <Building2 data-icon="company" aria-hidden="true" />
          <span>{currentName || 'Select Company'}</span>
          <ChevronDown data-icon="company-caret" aria-hidden="true" />
        </Button>
      }
    />
  );
}

function PeerWorkspaceNav({
  items,
  active,
  onSelect,
  personnelRef,
  marketRef,
}: {
  items: ReadonlyArray<HeaderPeerWorkspaceItem>;
  active: WorkspaceKey;
  onSelect: (key: WorkspaceKey) => void;
  personnelRef: (el: HTMLElement | null) => void;
  marketRef: (el: HTMLElement | null) => void;
}) {
  return (
    <nav aria-label="Primary workspace navigation" className="app-header-peer-nav">
      {items.map((item) => {
        const selected = item.key === active;
        const Icon = item.icon;
        return (
          <a
            key={item.key}
            href={workspaceHref(item.key)}
            ref={
              item.key === 'personnel'
                ? personnelRef
                : item.key === 'market'
                  ? marketRef
                  : undefined
            }
            onClick={(event) => activateWorkspaceLink(event, item.key, onSelect)}
            aria-label={`${item.label} workspace`}
            title={item.label}
            aria-current={selected ? 'page' : undefined}
            className="app-header-peer-link"
            data-selected={selected || undefined}
          >
            <Icon data-icon="peer-nav" />
            <span className="truncate">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function WorkspaceIconBar({
  items,
  active,
  onSelect,
  officeTools,
}: {
  items: ReadonlyArray<HeaderPeerWorkspaceItem>;
  active: WorkspaceKey;
  onSelect: (key: WorkspaceKey) => void;
  officeTools?: ReadonlyArray<HeaderOfficeToolItem>;
}) {
  const showStudio = officeTools && officeTools.length > 0;
  return (
    <div role="toolbar" aria-label="Workspace and office tools" className="app-header-iconbar">
      {items.map((item) => {
        const selected = item.key === active;
        const Icon = item.icon;
        return (
          <a
            key={item.key}
            href={workspaceHref(item.key)}
            onClick={(event) => activateWorkspaceLink(event, item.key, onSelect)}
            aria-label={`${item.label} workspace`}
            title={`${item.label} workspace`}
            aria-current={selected ? 'page' : undefined}
            className="app-header-icon-link"
            data-selected={selected || undefined}
          >
            <Icon data-icon="iconbar" />
          </a>
        );
      })}
      {showStudio ? (
        <>
          <span aria-hidden="true" className="app-header-iconbar-divider" />
          {officeTools.map((tool) => (
            <OfficeToolButton key={tool.key} tool={tool} />
          ))}
        </>
      ) : null}
    </div>
  );
}

function workspaceHref(key: WorkspaceKey): string {
  switch (key) {
    case 'activity-log':
      return '/activity';
    case 'market':
      return '/market/explore';
    case 'office':
      return '/';
    case 'personnel':
      return '/personnel';
    case 'workspace':
      return '/workspace';
    case 'settings':
      return '/settings/provider';
    case 'sops':
      return '/sops';
  }
}

function activateWorkspaceLink(
  event: React.MouseEvent<HTMLAnchorElement>,
  key: WorkspaceKey,
  onSelect: (key: WorkspaceKey) => void,
): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  onSelect(key);
}

const MAX_VISIBLE_OFFICE_TOOLS = 3;

function OfficeToolBar({ items }: { items: ReadonlyArray<HeaderOfficeToolItem> }) {
  if (items.length === 0) return null;
  const visible = items.slice(0, MAX_VISIBLE_OFFICE_TOOLS);
  const overflow = items.slice(MAX_VISIBLE_OFFICE_TOOLS);

  return (
    <div role="toolbar" aria-label="Office tools" className="app-header-office-tools">
      {visible.map((tool) => (
        <OfficeToolButton key={tool.key} tool={tool} />
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More office tools"
              className="app-header-office-tool"
            >
              <MoreHorizontal data-icon="office-tool-more" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={8} className="app-header-tool-menu">
            {overflow.map((tool) => (
              <DropdownMenuItem
                key={tool.key}
                disabled={tool.disabled}
                title={tool.disabled ? tool.disabledReason : undefined}
                onSelect={() => tool.onActivate()}
                className="app-header-tool-menu-item"
              >
                <tool.icon data-icon="tool-menu" />
                <span>{tool.label}</span>
                {tool.shortcut && <kbd>{tool.shortcut}</kbd>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function OfficeToolButton({ tool }: { tool: HeaderOfficeToolItem }) {
  const Icon = tool.icon;
  const label = tool.label + (tool.shortcut ? ` (${tool.shortcut})` : '');
  const active = tool.isActive === true;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => {
        if (!tool.disabled) tool.onActivate();
      }}
      disabled={tool.disabled}
      aria-pressed={active}
      aria-label={label}
      title={tool.disabled ? tool.disabledReason : label}
      data-office-tool={tool.key}
      className="app-header-office-tool"
      data-active={active || undefined}
    >
      <Icon data-icon="office-tool" aria-hidden="true" />
    </Button>
  );
}

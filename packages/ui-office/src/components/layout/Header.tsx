import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EntityDropdown,
  type EntityDropdownItem,
  SegmentedControl,
  cn,
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
    <header className="grid-app-header-desktop grid h-app-toolbar items-center gap-sp-4 px-sp-5 text-ink-1">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden justify-self-start">
        {slots.viewMode}
        {slots.company}
        {slots.project}
      </div>

      <div className="min-w-0 max-w-full overflow-hidden justify-self-center">{slots.peerNav}</div>

      <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden justify-self-end">
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
      <header
        className="flex min-h-11 items-center justify-between gap-2 rounded-r-lg border border-line bg-surface-1/92 px-2 py-1.5 text-ink-1 shadow-overlay backdrop-blur-md"
        data-layout-tier="narrow"
      >
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
          className="size-8 rounded-r-pill"
        >
          <Menu className="size-4" aria-hidden="true" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-center text-fs-sm font-semibold text-ink-1">
          {slots.title}
        </h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={isOffice ? projectSelectorRef : undefined}
              type="button"
              variant="secondary"
              size="icon"
              aria-label="More actions"
              className="size-8 rounded-r-pill"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto p-2">
            <div className="flex flex-col gap-2">
              {isOffice && viewMode && onViewModeChange ? (
                <div className="rounded-r-md border border-line-soft bg-surface-2 p-2">
                  <ViewModeToggle
                    value={viewMode}
                    onChange={onViewModeChange}
                    onSegmentClick={onViewModeClick}
                  />
                </div>
              ) : null}
              {slots.project ? <div className="rounded-r-md p-1">{slots.project}</div> : null}
              {isOffice && slots.mode ? <div className="rounded-r-md p-1">{slots.mode}</div> : null}
              {isOffice && slots.officeTools ? (
                <div className="rounded-r-md p-1">{slots.officeTools}</div>
              ) : null}
              {slots.marketActions}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-top" role="presentation">
          <Button
            type="button"
            variant="ghost"
            aria-label="Close workspace menu"
            className="absolute inset-0 h-auto w-auto rounded-none border-0 bg-surface/70 p-0 hover:bg-surface/70"
            onClick={onCloseDrawer}
          />
          <aside
            ref={drawerRef}
            // biome-ignore lint/a11y/useSemanticElements: aside hosts side-anchored drawer chrome with custom focus trap
            role="dialog"
            aria-modal="true"
            aria-label="Workspace menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-full max-w-sm flex-col border-r border-line bg-surface-1 p-4 shadow-modal outline-none"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-fs-meta uppercase tracking-wider text-ink-4">Workspace</p>
                <p className="truncate text-fs-sm font-semibold text-ink-1">
                  {companyName || 'Select Company'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Close workspace menu"
                onClick={onCloseDrawer}
                className="size-8 rounded-r-pill"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-col gap-2">
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
                    className={cn(
                      'flex w-full items-center gap-3 rounded-r-md border px-3 py-2 text-left text-fs-sm',
                      selected
                        ? 'border-accent bg-accent-surface text-accent'
                        : 'border-line-soft bg-surface-2 text-ink-3 hover:border-line hover:bg-surface-sunken hover:text-ink-1',
                    )}
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-line-soft pt-4">
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
                  className="w-full justify-start"
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
                  className="w-full justify-start"
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
    icon: <Building2 className="h-3.5 w-3.5 text-ink-4" />,
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
          className="h-8 min-w-48 max-w-64 rounded-r-pill px-3"
          title="Switch Company"
        >
          <Building2 className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-fs-meta font-medium text-ink-1">
            {currentName || 'Select Company'}
          </span>
          <ChevronDown className="size-3 shrink-0 text-ink-4" aria-hidden="true" />
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
    <nav
      aria-label="Primary workspace navigation"
      className="flex max-w-full items-center gap-0.5 overflow-hidden rounded-r-sm border border-line bg-surface-2 p-0.5 shadow-elev-1"
    >
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
            className={cn(
              'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-3.5 py-1 text-fs-meta font-semibold tracking-wide transition-colors',
              selected
                ? 'bg-accent-surface text-accent ring-1 ring-inset ring-accent-ring'
                : 'text-ink-3 hover:bg-surface-sunken hover:text-ink-1',
            )}
          >
            <Icon className="size-3.5 shrink-0" />
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
    <div
      role="toolbar"
      aria-label="Workspace and office tools"
      className="flex items-center gap-0.5 rounded-r-sm border border-line bg-surface-2 p-0.5 shadow-elev-1"
    >
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
            className={cn(
              'grid size-7 place-items-center rounded-sm transition-colors',
              selected
                ? 'bg-accent-surface text-accent ring-1 ring-inset ring-accent-ring'
                : 'text-ink-3 hover:bg-surface-sunken hover:text-ink-1',
            )}
          >
            <Icon className="size-4" />
          </a>
        );
      })}
      {showStudio ? (
        <>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border-default" />
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
    <div
      role="toolbar"
      aria-label="Office tools"
      className="flex items-center gap-0.5 rounded-r-pill border border-line bg-surface-2 p-0.5"
    >
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
              className="size-7 rounded-r-pill text-ink-3"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionPadding={8}
            className="max-h-96 w-48 overflow-y-auto"
          >
            {overflow.map((tool) => (
              <DropdownMenuItem
                key={tool.key}
                disabled={tool.disabled}
                title={tool.disabled ? tool.disabledReason : undefined}
                onSelect={() => tool.onActivate()}
                className="gap-2"
              >
                <tool.icon className="size-4" />
                <span className="flex-1">{tool.label}</span>
                {tool.shortcut && (
                  <kbd className="rounded border border-line-soft bg-surface-2 px-1.5 py-0.5 text-fs-meta text-ink-4">
                    {tool.shortcut}
                  </kbd>
                )}
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
      className={cn(
        'relative size-7 rounded-r-pill disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'text-accent hover:text-accent after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-px after:rounded-r-pill after:bg-accent'
          : 'text-ink-3 hover:bg-surface-sunken hover:text-ink-1',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}

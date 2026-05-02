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

type WorkspaceKey = 'office' | 'sops' | 'market' | 'personnel' | 'activity-log' | 'settings';

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
  notificationSlot?: ReactNode;
  projectSlot?: ReactNode;
  modeSlot?: ReactNode;
  viewMode?: '2D' | '3D';
  onViewModeChange?: (mode: '2D' | '3D') => void;
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
  apiSettings: ReactNode;
  mode: ReactNode;
  officeTools: ReactNode;
  fileImport: ReactNode;
  notification: ReactNode;
}

export function Header({
  companyName,
  onOpenSettings,
  onOpenCompanySelect,
  onFileImport,
  notificationSlot,
  projectSlot,
  modeSlot,
  viewMode,
  onViewModeChange,
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
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
      ) : null,
    company:
      isOffice && onOpenCompanySelect ? (
        <CompanySwitcher currentName={companyName} onManageCompanies={onOpenCompanySelect} />
      ) : null,
    project: isOffice && projectSlot ? <span ref={projectSelectorRef}>{projectSlot}</span> : null,
    peerNav: (
      <PeerWorkspaceNav
        items={peerWorkspaces}
        active={activeWorkspace}
        onSelect={onSelectWorkspace}
        personnelRef={personnelRef}
        marketRef={marketRef}
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
    officeTools:
      isOffice && officeTools && officeTools.length > 0 ? (
        <OfficeToolBar items={officeTools} />
      ) : null,
    fileImport: <FileImportTrigger onFileSelect={onFileImport} compact />,
    notification: notificationSlot,
  };

  if (isNarrow) {
    return (
      <NarrowHeader
        slots={slots}
        isOffice={isOffice}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
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

  return <DesktopHeader slots={slots} isOffice={isOffice} />;
}

// ---------------------------------------------------------------------------
// Desktop layout
// ---------------------------------------------------------------------------

function DesktopHeader({ slots, isOffice }: { slots: HeaderSlots; isOffice: boolean }) {
  return (
    <header
      className="grid h-14 grid-cols-[minmax(250px,320px)_minmax(540px,1fr)_minmax(260px,360px)] items-center gap-3 rounded-[18px] border border-border-default bg-surface-elevated/92 text-text-primary shadow-overlay backdrop-blur-md"
      style={{ paddingInline: 'var(--sp-md)' }}
    >
      <div className="flex min-w-0 items-center overflow-hidden" style={{ columnGap: '0.5rem' }}>
        {!isOffice && (
          <h1 className="truncate text-sm font-semibold tracking-wide text-text-primary">
            {slots.title}
          </h1>
        )}
        {slots.viewMode}
        {slots.company}
      </div>

      <div className="flex min-w-0 justify-center">{slots.peerNav}</div>

      <div
        className="flex min-w-0 shrink-0 items-center justify-end overflow-hidden"
        style={{ columnGap: 'var(--sp-sm)' }}
      >
        {slots.apiSettings}
        {slots.mode}
        {slots.officeTools}
        {slots.fileImport}
        {slots.notification}
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
        className="flex min-h-11 items-center justify-between gap-2 rounded-[18px] border border-border-default bg-surface-elevated/92 px-2 py-1.5 text-text-primary shadow-overlay backdrop-blur-md"
        data-layout-tier="narrow"
      >
        <button
          ref={
            activeWorkspace === 'personnel'
              ? personnelRef
              : activeWorkspace === 'market'
                ? marketRef
                : undefined
          }
          type="button"
          aria-label="Open workspace menu"
          onClick={onOpenDrawer}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-default bg-surface-muted text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
        >
          <Menu className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-text-primary">
          {slots.title}
        </h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              ref={isOffice ? projectSelectorRef : undefined}
              type="button"
              aria-label="More actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-default bg-surface-muted text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[70vh] w-72 overflow-y-auto p-2">
            <div className="space-y-2">
              {isOffice && viewMode && onViewModeChange ? (
                <div className="rounded-lg border border-border-subtle bg-surface-muted p-2">
                  <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
                </div>
              ) : null}
              {isOffice && slots.project ? (
                <div className="rounded-lg p-1">{slots.project}</div>
              ) : null}
              {isOffice && slots.mode ? <div className="rounded-lg p-1">{slots.mode}</div> : null}
              {isOffice && slots.officeTools ? (
                <div className="rounded-lg p-1">{slots.officeTools}</div>
              ) : null}
              {slots.fileImport}
              {slots.notification}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-top" role="presentation">
          <button
            type="button"
            aria-label="Close workspace menu"
            className="absolute inset-0 bg-surface/70"
            onClick={onCloseDrawer}
          />
          <aside
            ref={drawerRef}
            // biome-ignore lint/a11y/useSemanticElements: aside hosts side-anchored drawer chrome with custom focus trap
            role="dialog"
            aria-modal="true"
            aria-label="Workspace menu"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-full max-w-sm flex-col border-r border-border-default bg-surface-elevated p-4 shadow-modal outline-none"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-text-muted">Workspace</p>
                <p className="truncate text-sm font-semibold text-text-primary">
                  {companyName || 'Select Company'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close workspace menu"
                onClick={onCloseDrawer}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-default text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
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
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm ${
                      selected
                        ? 'border-border-focus bg-accent-muted text-accent-text'
                        : 'border-border-subtle bg-surface-muted text-text-secondary hover:border-border-default hover:bg-surface-hover hover:text-text-primary'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
            <div className="mt-4 space-y-2 border-t border-border-subtle pt-4">
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
}: { value: '2D' | '3D'; onChange: (mode: '2D' | '3D') => void }) {
  return (
    <SegmentedControl
      size="sm"
      ariaLabel="Office view mode"
      value={value}
      onChange={onChange}
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
    icon: <Building2 className="h-3.5 w-3.5 text-text-muted" />,
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
        <button
          type="button"
          className="flex h-8 min-w-[188px] max-w-[260px] items-center gap-1.5 rounded-full border border-border-default bg-surface-muted px-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
          title="Switch Company"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
            {currentName || 'Select Company'}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
        </button>
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
      className="grid min-w-[560px] grid-cols-6 items-center gap-0.5 rounded-full border border-border-default bg-surface-muted p-0.5"
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
            className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors sm:px-3 ${
              selected
                ? 'border border-border-focus bg-accent-muted text-accent-text'
                : 'border border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden truncate sm:inline">{item.label}</span>
          </a>
        );
      })}
    </nav>
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
      className="flex items-center gap-0.5 rounded-full border border-border-default bg-surface-muted p-0.5"
    >
      {visible.map((tool) => (
        <OfficeToolButton key={tool.key} tool={tool} />
      ))}
      {overflow.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More office tools"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            collisionPadding={8}
            className="max-h-[60vh] w-48 overflow-y-auto"
          >
            {overflow.map((tool) => (
              <DropdownMenuItem
                key={tool.key}
                disabled={tool.disabled}
                title={tool.disabled ? tool.disabledReason : undefined}
                onSelect={() => tool.onActivate()}
                className="gap-2"
              >
                <tool.icon className="h-4 w-4" />
                <span className="flex-1">{tool.label}</span>
                {tool.shortcut && (
                  <kbd className="rounded border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-[10px] text-text-muted">
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
    <button
      type="button"
      onClick={() => {
        if (!tool.disabled) tool.onActivate();
      }}
      disabled={tool.disabled}
      aria-pressed={active}
      aria-label={label}
      title={tool.disabled ? tool.disabledReason : label}
      data-office-tool={tool.key}
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'text-accent hover:text-accent after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-px after:rounded-full after:bg-accent'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

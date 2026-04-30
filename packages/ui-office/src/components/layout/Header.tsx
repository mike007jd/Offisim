import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@offisim/ui-core';
import { ArrowLeft, Building2, ChevronDown, Menu, MoreHorizontal, X } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
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
  providerName?: string;
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
  onBackToOffice?: () => void;
  workspaceTitle?: string;
  /** Peer workspace navigation (Office/SOPs/Market/Activity/Settings). Always visible. */
  peerWorkspaces: ReadonlyArray<HeaderPeerWorkspaceItem>;
  onSelectWorkspace: (key: WorkspaceKey) => void;
  /** Office-scoped tools. Rendered only when activeWorkspace === 'office'. */
  officeTools?: ReadonlyArray<HeaderOfficeToolItem>;
}

export function Header({
  providerName,
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
  onBackToOffice,
  workspaceTitle,
  peerWorkspaces,
  onSelectWorkspace,
  officeTools,
}: HeaderProps) {
  const isOffice = activeWorkspace === 'office';
  const { tier } = useLayoutTier();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const providerCtaRef = useTourTarget('settings:provider-cta');
  const projectSelectorRef = useTourTarget('office:project-selector');
  const drawerPersonnelRef = useTourTarget('personnel:nav-button');
  const drawerMarketRef = useTourTarget('market:nav-button');

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  if (tier === 'narrow') {
    return (
      <>
        <header
          className="flex min-h-11 items-center justify-between gap-2 rounded-[18px] border border-white/10 bg-black/25 px-2 py-1.5 shadow-2xl backdrop-blur-md"
          data-layout-tier="narrow"
        >
          <button
            type="button"
            aria-label="Open workspace menu"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
          >
            <Menu className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-slate-100">
            {isOffice ? companyName || 'Office' : workspaceTitle || 'Workspace'}
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[70vh] w-72 overflow-y-auto p-2">
              <div className="space-y-2">
                {isOffice && viewMode && onViewModeChange ? (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                    <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
                  </div>
                ) : null}
                {isOffice && projectSlot ? (
                  <div ref={projectSelectorRef} className="rounded-lg p-1">
                    {projectSlot}
                  </div>
                ) : null}
                {isOffice && modeSlot ? <div className="rounded-lg p-1">{modeSlot}</div> : null}
                {isOffice && officeTools && officeTools.length > 0 ? (
                  <div className="grid grid-cols-2 gap-1">
                    {officeTools.map((tool) => (
                      <button
                        key={tool.key}
                        type="button"
                        disabled={tool.disabled}
                        onClick={() => tool.onActivate()}
                        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 text-left text-xs text-slate-200 disabled:opacity-50"
                      >
                        <tool.icon className="h-4 w-4" />
                        <span className="truncate">{tool.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <FileImportTrigger onFileSelect={onFileImport} />
                {notificationSlot}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {drawerOpen && (
          <div className="fixed inset-0 z-top" role="presentation">
            <button
              type="button"
              aria-label="Close workspace menu"
              className="absolute inset-0 bg-black/50"
              onClick={() => setDrawerOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 flex w-full max-w-sm flex-col border-r border-border-default bg-surface-elevated p-4 shadow-modal">
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
                  onClick={() => setDrawerOpen(false)}
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
                          ? drawerPersonnelRef
                          : item.key === 'market'
                            ? drawerMarketRef
                            : undefined
                      }
                      aria-current={selected ? 'page' : undefined}
                      onClick={(event) => {
                        activateWorkspaceLink(event, item.key, onSelectWorkspace);
                        setDrawerOpen(false);
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
              <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                {onOpenCompanySelect && (
                  <Button
                    ref={providerCtaRef}
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onOpenCompanySelect();
                      setDrawerOpen(false);
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
                      setDrawerOpen(false);
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

  return (
    <header
      className="flex min-h-11 flex-wrap items-center justify-between gap-y-1 rounded-[18px] border border-white/10 bg-black/20 shadow-2xl backdrop-blur-md"
      style={{ paddingInline: 'var(--sp-md)', paddingBlock: '0.375rem' }}
    >
      <div
        className="flex min-w-0 flex-wrap items-center"
        style={{ columnGap: '0.5rem', rowGap: '0.25rem' }}
      >
        {!isOffice && onBackToOffice && (
          <>
            <button
              type="button"
              onClick={onBackToOffice}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Office
            </button>
            <div className="h-5 w-px bg-white/10" />
            {workspaceTitle && (
              <h1 className="truncate text-sm font-semibold tracking-wide text-slate-100">
                {workspaceTitle}
              </h1>
            )}
          </>
        )}

        {isOffice && viewMode && onViewModeChange && (
          <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
        )}

        {isOffice && onOpenCompanySelect && (
          <button
            type="button"
            onClick={onOpenCompanySelect}
            className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 transition-colors hover:border-white/20 hover:bg-white/10"
            title="Switch Company"
          >
            <Building2 className="h-3.5 w-3.5 shrink-0 text-violet-400" />
            <span className="max-w-[140px] truncate text-xs font-medium text-slate-200">
              {companyName || 'Select Company'}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" />
          </button>
        )}

        {isOffice && <div className="hidden h-5 w-px bg-white/10 sm:block" />}

        <PeerWorkspaceNav
          items={peerWorkspaces}
          active={activeWorkspace}
          onSelect={onSelectWorkspace}
        />

        {providerName && (
          <div
            className="hidden items-center gap-2 rounded-full border border-emerald-500/10 bg-emerald-500/5 px-2.5 py-1 md:inline-flex"
            title={`Current provider: ${providerName}`}
          >
            <div className="h-1 w-1 rounded-full bg-emerald-500" />
            <span className="font-mono text-xs uppercase tracking-wider text-emerald-500/80">
              {providerName}
            </span>
          </div>
        )}
        {needsConfig && (
          <Button
            ref={providerCtaRef}
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenSettings}
            title="Open API and model settings"
            aria-label="Open API and model settings"
            className="h-8 border-blue-400/25 bg-blue-500/14 text-blue-50 hover:border-blue-300/40 hover:bg-blue-500/22"
          >
            Open API Settings
          </Button>
        )}

        {isOffice && projectSlot ? <span ref={projectSelectorRef}>{projectSlot}</span> : null}
      </div>

      <div
        className="flex shrink-0 flex-wrap items-center justify-end"
        style={{ columnGap: 'var(--sp-sm)', rowGap: '0.25rem' }}
      >
        {isOffice && modeSlot}
        {isOffice && officeTools && officeTools.length > 0 && <OfficeToolBar items={officeTools} />}
        <FileImportTrigger onFileSelect={onFileImport} />
        {notificationSlot}
      </div>
    </header>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: { value: '2D' | '3D'; onChange: (mode: '2D' | '3D') => void }) {
  return (
    <div className="flex h-8 items-center rounded-full border border-white/10 bg-black/35 px-1">
      {(['3D', '2D'] as const).map((mode) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            title={`Switch to ${mode} office view`}
            aria-label={`Switch to ${mode} office view`}
            className={`h-6 rounded-md px-3 text-xs font-semibold uppercase tracking-wider transition-all ${
              active
                ? 'rounded-full border border-cyan-400/35 bg-cyan-400/12 text-cyan-100'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {mode}
          </button>
        );
      })}
    </div>
  );
}

function PeerWorkspaceNav({
  items,
  active,
  onSelect,
}: {
  items: ReadonlyArray<HeaderPeerWorkspaceItem>;
  active: WorkspaceKey;
  onSelect: (key: WorkspaceKey) => void;
}) {
  const personnelRef = useTourTarget('personnel:nav-button');
  const marketRef = useTourTarget('market:nav-button');
  return (
    <nav
      aria-label="Primary workspace navigation"
      className="flex items-center gap-0.5 rounded-full border border-white/10 bg-black/30 p-0.5"
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
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors sm:px-3 ${
              selected
                ? 'border border-cyan-400/30 bg-blue-500/15 text-blue-100'
                : 'border border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">{item.label}</span>
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
  const href = workspaceHref(key);
  onSelect(key);
  if (typeof window === 'undefined') return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === href) return;
  window.history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
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
      className="flex items-center gap-0.5 rounded-full border border-white/10 bg-black/30 p-0.5"
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
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-white/8 hover:text-slate-100"
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
                  <kbd className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[10px] text-slate-400">
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
          ? 'text-cyan-200 hover:text-cyan-100 after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-px after:rounded-full after:bg-cyan-300/70'
          : 'text-slate-400 hover:bg-white/8 hover:text-slate-100'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

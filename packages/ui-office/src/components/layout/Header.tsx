import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@offisim/ui-core';
import { ArrowLeft, Building2, ChevronDown, MoreHorizontal, Pencil } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

type WorkspaceKey = 'office' | 'sops' | 'market' | 'activity-log' | 'settings';

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
  onOpenCompanyEditor?: () => void;
  onFileImport: (file: File) => void;
  notificationSlot?: ReactNode;
  projectSlot?: ReactNode;
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
  onOpenCompanyEditor,
  onFileImport,
  notificationSlot,
  projectSlot,
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
          <div className="flex min-w-0 items-center gap-2">
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
            {onOpenCompanyEditor && (
              <>
                <div className="h-5 w-px bg-white/10" />
                <button
                  type="button"
                  onClick={onOpenCompanyEditor}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-white/8 transition-colors hover:bg-white/10"
                  title="Company Settings"
                  aria-label="Company Settings"
                >
                  <Pencil className="h-3 w-3 text-slate-500 hover:text-violet-400" />
                </button>
              </>
            )}
          </div>
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
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenSettings}
            data-onboarding-target="configure-provider"
            title="Open API and model settings"
            aria-label="Open API and model settings"
            className="h-8 border-blue-400/25 bg-blue-500/14 text-blue-50 hover:border-blue-300/40 hover:bg-blue-500/22"
          >
            Open API Settings
          </Button>
        )}

        {isOffice && projectSlot}
      </div>

      <div
        className="flex shrink-0 flex-wrap items-center justify-end"
        style={{ columnGap: 'var(--sp-sm)', rowGap: '0.25rem' }}
      >
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
  return (
    <nav
      aria-label="Primary workspace navigation"
      className="flex items-center gap-0.5 rounded-full border border-white/10 bg-black/30 p-0.5"
    >
      {items.map((item) => {
        const selected = item.key === active;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
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
          </button>
        );
      })}
    </nav>
  );
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

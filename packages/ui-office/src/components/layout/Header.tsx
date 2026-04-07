import { Button } from '@offisim/ui-core';
import { Building2, ChevronDown, PenTool, Pencil, Settings, Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

type WorkspaceKey = 'office' | 'sops' | 'market' | 'activity-log';

interface HeaderProps {
  providerName?: string;
  /** Current company display name — shown in the company chip. */
  companyName?: string;
  onOpenSettings: () => void;
  onOpenOffice?: () => void;
  onOpenSops?: () => void;
  onOpenMarket?: () => void;
  onOpenStudio?: () => void;
  onOpenCompanySelect?: () => void;
  onOpenCompanyEditor?: () => void;
  onFileImport: (file: File) => void;
  notificationSlot?: ReactNode;
  /** Slot for project selector dropdown — rendered in the left section. */
  projectSlot?: ReactNode;
  viewMode?: '2D' | '3D';
  onViewModeChange?: (mode: '2D' | '3D') => void;
  /** Show provider setup guidance when runtime config is incomplete. */
  needsConfig?: boolean;
  activeWorkspace?: WorkspaceKey;
}

export function Header({
  providerName,
  companyName,
  onOpenSettings,
  onOpenOffice,
  onOpenSops,
  onOpenMarket,
  onOpenStudio,
  onOpenCompanySelect,
  onOpenCompanyEditor,
  onFileImport,
  notificationSlot,
  projectSlot,
  viewMode,
  onViewModeChange,
  needsConfig,
  activeWorkspace = 'office',
}: HeaderProps) {
  const primaryNav = [
    { key: 'office' as const, label: 'Office', onClick: onOpenOffice },
    { key: 'sops' as const, label: 'SOPs', onClick: onOpenSops },
  ];

  return (
    <header
      className="min-h-12 bg-black/20 backdrop-blur-md flex items-center justify-between rounded-xl border border-white/10 shadow-2xl"
      style={{ paddingInline: 'var(--sp-lg)', paddingBlock: '0.5rem' }}
    >
      <div className="flex items-center min-w-0 flex-wrap" style={{ columnGap: 'var(--sp-md)', rowGap: '0.5rem' }}>
        {/* 2D/3D View Toggle */}
        {viewMode && onViewModeChange && (
          <div className="flex h-8 items-center bg-black/40 border border-white/10 rounded-lg px-1">
            <button
              type="button"
              onClick={() => onViewModeChange('3D')}
              title="Switch to 3D office view"
              aria-label="Switch to 3D office view"
              className={`h-6 px-3 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
                viewMode === '3D'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              3D
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('2D')}
              title="Switch to 2D office map"
              aria-label="Switch to 2D office map"
              className={`h-6 px-3 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
                viewMode === '2D'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              2D
            </button>
          </div>
        )}

        {/* Company chip — primary identity, always visible */}
        {onOpenCompanySelect && (
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onOpenCompanySelect}
              className="flex min-w-0 items-center gap-1.5 h-8 px-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-colors"
              title="Switch Company"
            >
              <Building2 className="h-3.5 w-3.5 text-violet-400 flex-shrink-0" />
              <span className="text-xs font-medium text-slate-200 max-w-[140px] truncate">
                {companyName || 'Select Company'}
              </span>
              <ChevronDown className="h-3 w-3 text-slate-500 flex-shrink-0" />
            </button>
            {onOpenCompanyEditor && (
              <>
                <div className="h-5 w-px bg-white/10" />
                <button
                  type="button"
                  onClick={onOpenCompanyEditor}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/8 hover:bg-white/10 transition-colors"
                  title="Company Settings"
                  aria-label="Company Settings"
                >
                  <Pencil className="h-3 w-3 text-slate-500 hover:text-violet-400" />
                </button>
              </>
            )}
          </div>
        )}

        <div className="h-5 w-px bg-white/10" />

        <nav
          aria-label="Primary workspace navigation"
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 p-1"
        >
          {primaryNav.map((item) =>
            item.onClick ? (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                aria-label={`${item.label} workspace`}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors ${
                  activeWorkspace === item.key
                    ? 'bg-blue-500/15 text-blue-100 border border-blue-400/30'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
                }`}
              >
                {item.label}
              </button>
            ) : null,
          )}
        </nav>

        {/* Provider badge */}
        {providerName && (
          <div className="flex items-center space-x-2" title={`Current provider: ${providerName}`}>
            <div className="w-1 h-1 bg-emerald-500 rounded-full" />
            <span className="text-xs font-mono text-emerald-500/80 uppercase tracking-wider">
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

        {/* Project selector slot */}
        {projectSlot}
      </div>

      <div className="flex items-center shrink-0" style={{ columnGap: 'var(--sp-sm)' }}>
        <FileImportTrigger onFileSelect={onFileImport} />
        {onOpenMarket && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMarket}
            title="Market utility"
            aria-label="Market utility"
            className="h-8 w-8 hover:bg-white/5"
          >
            <Store className="h-4 w-4 text-slate-400 hover:text-cyan-300" />
          </Button>
        )}
        {notificationSlot}
        {onOpenStudio && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenStudio}
            title="Studio utility"
            aria-label="Studio utility"
            className="h-8 w-8 hover:bg-white/5"
          >
            <PenTool className="h-4 w-4 text-slate-400 hover:text-emerald-400" />
          </Button>
        )}
        <div className="h-6 w-px bg-white/10" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          title={needsConfig ? 'Settings - API key required' : 'Settings'}
          aria-label={needsConfig ? 'Settings - API key required' : 'Settings'}
          className="h-8 w-8 hover:bg-white/5"
        >
          <Settings className="h-4 w-4 text-slate-400 hover:text-blue-400" />
        </Button>
      </div>
    </header>
  );
}

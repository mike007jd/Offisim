import { Button } from '@offisim/ui-core';
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  PenTool,
  Pencil,
  Settings,
  Store,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

type WorkspaceKey = 'office' | 'sops' | 'market' | 'activity-log' | 'settings';

interface HeaderProps {
  providerName?: string;
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
  projectSlot?: ReactNode;
  viewMode?: '2D' | '3D';
  onViewModeChange?: (mode: '2D' | '3D') => void;
  needsConfig?: boolean;
  activeWorkspace?: WorkspaceKey;
  onBackToOffice?: () => void;
  workspaceTitle?: string;
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
  onBackToOffice,
  workspaceTitle,
}: HeaderProps) {
  const isOffice = activeWorkspace === 'office';

  return (
    <header
      className="flex min-h-11 items-center justify-between rounded-[18px] border border-white/10 bg-black/20 shadow-2xl backdrop-blur-md"
      style={{ paddingInline: 'var(--sp-md)', paddingBlock: '0.375rem' }}
    >
      <div
        className="flex min-w-0 flex-wrap items-center"
        style={{ columnGap: '0.625rem', rowGap: '0.375rem' }}
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
              <h1 className="text-sm font-semibold tracking-wide text-slate-100">
                {workspaceTitle}
              </h1>
            )}
          </>
        )}

        {isOffice && viewMode && onViewModeChange && (
          <div className="flex h-8 items-center rounded-full border border-white/10 bg-black/35 px-1">
            <button
              type="button"
              onClick={() => onViewModeChange('3D')}
              title="Switch to 3D office view"
              aria-label="Switch to 3D office view"
              className={`h-6 px-3 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
                viewMode === '3D'
                  ? 'rounded-full border border-cyan-400/35 bg-cyan-400/12 text-cyan-100'
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
                  ? 'rounded-full border border-cyan-400/35 bg-cyan-400/12 text-cyan-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              2D
            </button>
          </div>
        )}

        {isOffice && onOpenCompanySelect && (
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onOpenCompanySelect}
              className="flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 hover:border-white/20 hover:bg-white/10 transition-colors"
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

        {isOffice && <div className="h-5 w-px bg-white/10" />}

        {isOffice && (
          <nav
            aria-label="Primary workspace navigation"
            className="flex items-center gap-1 rounded-full border border-white/10 bg-black/30 p-1"
          >
            {onOpenOffice && (
              <button
                type="button"
                onClick={onOpenOffice}
                aria-label="Office workspace"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors ${
                  isOffice
                    ? 'border border-cyan-400/30 bg-blue-500/15 text-blue-100'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
                }`}
              >
                Office
              </button>
            )}
          </nav>
        )}

        {providerName && (
          <div
            className="flex items-center space-x-2 rounded-full border border-emerald-500/10 bg-emerald-500/5 px-2.5 py-1"
            title={`Current provider: ${providerName}`}
          >
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

        {isOffice && projectSlot}
      </div>

      <div className="flex items-center shrink-0" style={{ columnGap: 'var(--sp-sm)' }}>
        <FileImportTrigger onFileSelect={onFileImport} />
        {onOpenSops && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSops}
            title="SOPs"
            aria-label="SOPs workspace"
            className={`h-8 w-8 hover:bg-white/5 ${activeWorkspace === 'sops' ? 'bg-cyan-500/15 border border-cyan-400/30' : ''}`}
          >
            <Workflow
              className={`h-4 w-4 ${activeWorkspace === 'sops' ? 'text-cyan-300' : 'text-slate-400 hover:text-cyan-300'}`}
            />
          </Button>
        )}
        {onOpenMarket && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenMarket}
            title="Market utility"
            aria-label="Market utility"
            className={`h-8 w-8 hover:bg-white/5 ${activeWorkspace === 'market' ? 'bg-cyan-500/15 border border-cyan-400/30' : ''}`}
          >
            <Store
              className={`h-4 w-4 ${activeWorkspace === 'market' ? 'text-cyan-300' : 'text-slate-400 hover:text-cyan-300'}`}
            />
          </Button>
        )}
        {notificationSlot}
        {onOpenStudio && activeWorkspace === 'office' && (
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

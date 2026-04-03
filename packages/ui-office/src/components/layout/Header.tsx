import { Button } from '@offisim/ui-core';
import {
  Building2,
  ChevronDown,
  PenTool,
  Pencil,
  Settings,
  UserPlus,
  WandSparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

interface HeaderProps {
  providerName?: string;
  /** Current company display name — shown in the company chip. */
  companyName?: string;
  onOpenSettings: () => void;
  onOpenEmployeeCreator?: () => void;
  onOpenLayoutEditor?: () => void;
  onOpenStudio?: () => void;
  onOpenCompanySelect?: () => void;
  onOpenCompanyEditor?: () => void;
  onFileImport: (file: File) => void;
  notificationSlot?: ReactNode;
  /** Slot for project selector dropdown — rendered in the left section. */
  projectSlot?: ReactNode;
  viewMode?: '2D' | '3D';
  onViewModeChange?: (mode: '2D' | '3D') => void;
  /** Show a red dot on the Settings icon when provider is not yet configured. */
  needsConfig?: boolean;
}

export function Header({
  providerName,
  companyName,
  onOpenSettings,
  onOpenEmployeeCreator,
  onOpenLayoutEditor,
  onOpenStudio,
  onOpenCompanySelect,
  onOpenCompanyEditor,
  onFileImport,
  notificationSlot,
  projectSlot,
  viewMode,
  onViewModeChange,
  needsConfig,
}: HeaderProps) {
  return (
    <header
      className="h-12 bg-black/20 backdrop-blur-md flex items-center justify-between rounded-xl border border-white/10 shadow-2xl"
      style={{ paddingInline: 'var(--sp-lg)' }}
    >
      <div className="flex items-center" style={{ columnGap: 'var(--sp-lg)' }}>
        {/* 2D/3D View Toggle */}
        {viewMode && onViewModeChange && (
          <div
            className="flex items-center bg-black/40 border border-white/10 rounded-lg"
            style={{ padding: 'var(--sp-xs)' }}
          >
            <button
              type="button"
              onClick={() => onViewModeChange('3D')}
              className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
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
              className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenCompanySelect}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-colors"
              title="Switch Company"
            >
              <Building2 className="h-3.5 w-3.5 text-violet-400 flex-shrink-0" />
              <span className="text-xs font-medium text-slate-200 max-w-[140px] truncate">
                {companyName || 'Select Company'}
              </span>
              <ChevronDown className="h-3 w-3 text-slate-500 flex-shrink-0" />
            </button>
            {onOpenCompanyEditor && (
              <button
                type="button"
                onClick={onOpenCompanyEditor}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
                title="Company Settings"
                aria-label="Company Settings"
              >
                <Pencil className="h-3 w-3 text-slate-500 hover:text-violet-400" />
              </button>
            )}
          </div>
        )}

        <div className="h-5 w-px bg-white/10" />

        {/* Provider badge */}
        {providerName && (
          <div className="flex items-center space-x-2">
            <div className="w-1 h-1 bg-emerald-500 rounded-full" />
            <span className="text-xs font-mono text-emerald-500/80 uppercase tracking-wider">
              {providerName}
            </span>
          </div>
        )}
        {needsConfig && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="h-7 rounded-lg border border-amber-400/20 bg-amber-400/8 px-2.5 text-[11px] text-amber-100 transition-colors hover:bg-amber-400/12"
          >
            Configure API Key
          </button>
        )}

        {/* Project selector slot */}
        {projectSlot}
      </div>

      <div className="flex items-center" style={{ columnGap: 'var(--sp-lg)' }}>
        <FileImportTrigger onFileSelect={onFileImport} />
        {notificationSlot}
        {onOpenEmployeeCreator && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenEmployeeCreator}
            title="Create Employee"
            aria-label="Create Employee"
            className="hover:bg-white/5"
          >
            <UserPlus className="h-4 w-4 text-slate-400 hover:text-blue-400" />
          </Button>
        )}
        {onOpenLayoutEditor && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenLayoutEditor}
            title="Layout Editor"
            aria-label="Layout Editor"
            className="hover:bg-white/5"
          >
            <WandSparkles className="h-4 w-4 text-slate-400 hover:text-cyan-400" />
          </Button>
        )}
        {onOpenStudio && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenStudio}
            title="Decoration Studio"
            aria-label="Decoration Studio"
            className="hover:bg-white/5"
          >
            <PenTool className="h-4 w-4 text-slate-400 hover:text-emerald-400" />
          </Button>
        )}
        <div className="h-6 w-px bg-white/10" />
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            className="hover:bg-white/5"
          >
            <Settings className="h-4 w-4 text-slate-400 hover:text-blue-400" />
          </Button>
          {needsConfig && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full pointer-events-none" />
          )}
        </div>
      </div>
    </header>
  );
}

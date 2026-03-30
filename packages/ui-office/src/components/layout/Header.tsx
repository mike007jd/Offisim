import { Button } from '@offisim/ui-core';
import { Building2, ChevronDown, PenTool, Settings, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

interface HeaderProps {
  providerName?: string;
  /** Current company display name — shown in the company chip. */
  companyName?: string;
  onOpenSettings: () => void;
  onOpenEmployeeCreator?: () => void;
  onOpenStudio?: () => void;
  onOpenCompanySelect?: () => void;
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
  onOpenStudio,
  onOpenCompanySelect,
  onFileImport,
  notificationSlot,
  projectSlot,
  viewMode,
  onViewModeChange,
  needsConfig,
}: HeaderProps) {
  return (
    <header className="h-12 bg-black/20 backdrop-blur-md flex items-center justify-between px-4 rounded-xl border border-white/10 shadow-2xl">
      <div className="flex items-center space-x-3">
        {/* 2D/3D View Toggle */}
        {viewMode && onViewModeChange && (
          <div className="flex items-center bg-black/40 border border-white/10 rounded-lg p-0.5">
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

        {/* Project selector slot */}
        {projectSlot}
      </div>

      <div className="flex items-center space-x-3">
        <FileImportTrigger onFileSelect={onFileImport} />
        {notificationSlot}
        {onOpenEmployeeCreator && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenEmployeeCreator}
            title="Create Employee"
            className="hover:bg-white/5"
          >
            <UserPlus className="h-4 w-4 text-slate-400 hover:text-blue-400" />
          </Button>
        )}
        {onOpenStudio && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenStudio}
            title="Studio Editor"
            className="hover:bg-white/5"
          >
            <PenTool className="h-4 w-4 text-slate-400 hover:text-emerald-400" />
          </Button>
        )}
        <div className="h-6 w-px bg-white/10" />
        <div className="relative">
          <Button variant="ghost" size="icon" onClick={onOpenSettings} title="Settings" className="hover:bg-white/5">
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

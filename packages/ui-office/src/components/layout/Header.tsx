import { Button } from '@aics/ui-core';
import { Building2, Settings, UserPlus, LayoutGrid } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

interface HeaderProps {
  providerName?: string;
  onOpenSettings: () => void;
  onOpenCompanyEditor?: () => void;
  onOpenEmployeeCreator?: () => void;
  onOpenOfficeEditor?: () => void;
  onFileImport: (file: File) => void;
  notificationSlot?: ReactNode;
  viewMode?: '2D' | '3D';
  onViewModeChange?: (mode: '2D' | '3D') => void;
  /** Show a red dot on the Settings icon when provider is not yet configured. */
  needsConfig?: boolean;
}

export function Header({ providerName, onOpenSettings, onOpenCompanyEditor, onOpenEmployeeCreator, onOpenOfficeEditor, onFileImport, notificationSlot, viewMode, onViewModeChange, needsConfig }: HeaderProps) {
  return (
    <header className="h-12 bg-surface-light/80 backdrop-blur-md flex items-center justify-between px-4 rounded-xl border border-border shadow-sm">
      {/* ── Left: brand + status ── */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-text-primary tracking-tight">Offisim</span>
        {providerName && (
          <span className="text-xs text-text-muted px-2 py-0.5 rounded-md bg-surface-lighter/60 border border-border">
            {providerName}
          </span>
        )}
      </div>

      {/* ── Center: view mode toggle ── */}
      {viewMode && onViewModeChange && (
        <div className="flex items-center gap-1 bg-surface-lighter/50 rounded-lg p-0.5 border border-border">
          {(['2D', '3D'] as const).map((m) => (
            <button
              key={m}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === m
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => onViewModeChange(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {/* ── Right: toolbar ── */}
      <div className="flex items-center gap-1">
        {notificationSlot}
        <FileImportTrigger onFileSelect={onFileImport} />
        {onOpenEmployeeCreator && (
          <Button variant="ghost" size="icon" onClick={onOpenEmployeeCreator} title="New Employee" className="hover:bg-surface-lighter">
            <UserPlus className="h-4 w-4 text-text-muted hover:text-accent" />
          </Button>
        )}
        {onOpenOfficeEditor && (
          <Button variant="ghost" size="icon" onClick={onOpenOfficeEditor} title="Office Editor" className="hover:bg-surface-lighter">
            <LayoutGrid className="h-4 w-4 text-text-muted hover:text-accent" />
          </Button>
        )}
        {onOpenCompanyEditor && (
          <Button variant="ghost" size="icon" onClick={onOpenCompanyEditor} title="Company Settings" className="hover:bg-surface-lighter">
            <Building2 className="h-4 w-4 text-text-muted hover:text-accent" />
          </Button>
        )}
        <div className="h-6 w-px bg-border" />
        <div className="relative">
          <Button variant="ghost" size="icon" onClick={onOpenSettings} className="hover:bg-surface-lighter">
            <Settings className="h-4 w-4 text-text-muted hover:text-accent" />
          </Button>
          {needsConfig && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-error rounded-full pointer-events-none" />
          )}
        </div>
      </div>
    </header>
  );
}

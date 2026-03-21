import { Button } from '@aics/ui-core';
import { Building2, Settings, UserPlus, LayoutGrid, Sun, Moon, Monitor } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';
import { useTheme } from '../../theme/index.js';
import type { Theme } from '../../theme/index.js';

const THEME_NEXT: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const THEME_ICONS: Record<Theme, ReactNode> = {
  light: <Sun size={14} />,
  dark: <Moon size={14} />,
  system: <Monitor size={14} />,
};
const THEME_LABELS: Record<Theme, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
      onClick={() => setTheme(THEME_NEXT[theme])}
      title={THEME_LABELS[theme]}
    >
      {THEME_ICONS[theme]}
      <span className="hidden sm:inline">{THEME_LABELS[theme]}</span>
    </button>
  );
}

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
    <header className="h-12 bg-black/20 backdrop-blur-md flex items-center justify-between px-4 rounded-xl border border-white/10 shadow-2xl">
      <div className="flex items-center space-x-3">
        {/* 2D/3D View Toggle */}
        {viewMode && onViewModeChange && (
          <div className="flex items-center bg-black/40 border border-white/10 rounded-lg p-0.5">
            <button
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

        {/* Provider badge */}
        {providerName && (
          <div className="flex items-center space-x-2">
            <div className="w-1 h-1 bg-emerald-500 rounded-full" />
            <span className="text-xs font-mono text-emerald-500/80 uppercase tracking-wider">{providerName}</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3">
        <FileImportTrigger onFileSelect={onFileImport} />
        {notificationSlot}
        {onOpenEmployeeCreator && (
          <Button variant="ghost" size="icon" onClick={onOpenEmployeeCreator} title="Create Employee" className="hover:bg-white/5">
            <UserPlus className="h-4 w-4 text-slate-400 hover:text-blue-400" />
          </Button>
        )}
        {onOpenOfficeEditor && (
          <Button variant="ghost" size="icon" onClick={onOpenOfficeEditor} title="Office Editor" className="hover:bg-white/5">
            <LayoutGrid className="h-4 w-4 text-slate-400 hover:text-blue-400" />
          </Button>
        )}
        {onOpenCompanyEditor && (
          <Button variant="ghost" size="icon" onClick={onOpenCompanyEditor} title="Company Settings" className="hover:bg-white/5">
            <Building2 className="h-4 w-4 text-slate-400 hover:text-blue-400" />
          </Button>
        )}
        <ThemeToggle />
        <div className="h-6 w-px bg-white/10" />
        <div className="relative">
          <Button variant="ghost" size="icon" onClick={onOpenSettings} className="hover:bg-white/5">
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

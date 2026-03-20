import { Button } from '@aics/ui-core';
import { Cpu, Building2, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

interface HeaderProps {
  providerName?: string;
  onOpenSettings: () => void;
  onOpenCompanyEditor?: () => void;
  onFileImport: (file: File) => void;
  notificationSlot?: ReactNode;
}

export function Header({ providerName, onOpenSettings, onOpenCompanyEditor, onFileImport, notificationSlot }: HeaderProps) {
  return (
    <header className="h-16 bg-black/20 backdrop-blur-md flex items-center justify-between px-8 rounded-2xl border border-white/10 shadow-2xl">
      <div className="flex items-center space-x-8">
        {/* Brand */}
        <div className="flex items-center space-x-3 group cursor-pointer">
          <div className="relative">
            <div className="w-9 h-9 bg-blue-500/10 border border-blue-500/40 rounded-lg flex items-center justify-center group-hover:bg-blue-500/20 transition-all duration-500">
              <Cpu className="w-4 h-4 text-blue-400" />
            </div>
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter text-white group-hover:text-blue-400 transition-colors">
              OFFI<span className="text-blue-500">SIM</span>
            </h1>
            <p className="text-[8px] font-mono text-slate-500 tracking-[0.3em] uppercase">
              Enterprise_Runtime
            </p>
          </div>
        </div>

        {/* Provider badge */}
        {providerName && (
          <div className="flex items-center space-x-2">
            <div className="w-1 h-1 bg-emerald-500 rounded-full" />
            <span className="text-[10px] font-mono text-emerald-500/80 uppercase tracking-wider">{providerName}</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3">
        <FileImportTrigger onFileSelect={onFileImport} />
        {notificationSlot}
        {onOpenCompanyEditor && (
          <Button variant="ghost" size="icon" onClick={onOpenCompanyEditor} title="Company Settings" className="hover:bg-white/5">
            <Building2 className="h-4 w-4 text-slate-400 hover:text-blue-400" />
          </Button>
        )}
        <div className="h-6 w-px bg-white/10" />
        <Button variant="ghost" size="icon" onClick={onOpenSettings} className="hover:bg-white/5">
          <Settings className="h-4 w-4 text-slate-400 hover:text-blue-400" />
        </Button>
      </div>
    </header>
  );
}

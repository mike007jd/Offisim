import { Badge, Button } from '@aics/ui-core';
import { Building2, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';

interface HeaderProps {
  providerName?: string;
  onOpenSettings: () => void;
  onOpenCompanyEditor?: () => void;
  onFileImport: (file: File) => void;
  /** Optional slot for the NotificationCenter component. */
  notificationSlot?: ReactNode;
}

export function Header({ providerName, onOpenSettings, onOpenCompanyEditor, onFileImport, notificationSlot }: HeaderProps) {
  return (
    <header className="flex h-12 items-center justify-between border-b-2 border-ocean-light bg-ocean-deep px-4">
      <div className="flex items-center gap-3">
        <h1 className="font-pixel-display text-[10px] text-lobster-red tracking-wider">AICS</h1>
        <span className="text-xs text-shell font-pixel-body">AI Company Simulator</span>
        {providerName && <Badge variant="secondary">{providerName}</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <FileImportTrigger onFileSelect={onFileImport} />
        {notificationSlot}
        {onOpenCompanyEditor && (
          <Button variant="ghost" size="icon" onClick={onOpenCompanyEditor} title="Company Settings">
            <Building2 className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

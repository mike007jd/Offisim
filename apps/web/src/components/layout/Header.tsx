import { Settings } from 'lucide-react';
import { FileImportTrigger } from '../install/FileImportTrigger.js';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

interface HeaderProps {
  providerName?: string;
  onOpenSettings: () => void;
  onFileImport: (file: File) => void;
}

export function Header({ providerName, onOpenSettings, onFileImport }: HeaderProps) {
  return (
    <header className="flex h-12 items-center justify-between border-b-2 border-ocean-light bg-ocean-deep px-4">
      <div className="flex items-center gap-3">
        <h1 className="font-pixel-display text-[10px] text-lobster-red tracking-wider">
          AICS
        </h1>
        <span className="text-xs text-shell font-pixel-body">AI Company Simulator</span>
        {providerName && <Badge variant="secondary">{providerName}</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <FileImportTrigger onFileSelect={onFileImport} />
        <Button variant="ghost" size="icon" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

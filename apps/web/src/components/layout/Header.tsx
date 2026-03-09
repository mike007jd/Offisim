import { Settings } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

interface HeaderProps {
  providerName?: string;
  onOpenSettings: () => void;
}

export function Header({ providerName, onOpenSettings }: HeaderProps) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-text-primary">AI Company Simulator</h1>
        {providerName && (
          <Badge variant="secondary">{providerName}</Badge>
        )}
      </div>
      <Button variant="ghost" size="icon" onClick={onOpenSettings}>
        <Settings className="h-4 w-4" />
      </Button>
    </header>
  );
}

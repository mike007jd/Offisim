import { Badge } from '../ui/badge';

interface StatusBarProps {
  modelName?: string;
  totalTokens?: number;
  lastLatencyMs?: number;
  runStatus: 'idle' | 'running' | 'error';
}

export function StatusBar({ modelName, totalTokens, lastLatencyMs, runStatus }: StatusBarProps) {
  const statusVariant = runStatus === 'error' ? 'error' : runStatus === 'running' ? 'info' : 'secondary';

  return (
    <footer className="flex h-8 items-center justify-between border-t border-border bg-surface px-4 text-xs text-text-muted">
      <div className="flex items-center gap-4">
        <Badge variant={statusVariant} className="text-[10px] px-1.5 py-0">
          {runStatus}
        </Badge>
        {modelName && <span>Model: {modelName}</span>}
      </div>
      <div className="flex items-center gap-4">
        {totalTokens != null && <span>Tokens: {totalTokens.toLocaleString()}</span>}
        {lastLatencyMs != null && <span>Latency: {lastLatencyMs}ms</span>}
      </div>
    </footer>
  );
}

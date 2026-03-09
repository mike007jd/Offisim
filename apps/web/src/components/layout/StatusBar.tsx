import { useEffect, useState } from 'react';
import type { RuntimeEvent, LlmCallCompletedPayload } from '@aics/shared-types';
import { Badge } from '../ui/badge';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';

interface StatusBarProps {
  modelName?: string;
}

export function StatusBar({ modelName }: StatusBarProps) {
  const { eventBus, isRunning, error } = useAicsRuntime();
  const [totalTokens, setTotalTokens] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    const unsub = eventBus.on('llm.call.completed', (event: RuntimeEvent<LlmCallCompletedPayload>) => {
      const { latencyMs, inputTokens, outputTokens } = event.payload;
      setTotalTokens((prev) => prev + inputTokens + outputTokens);
      setLastLatencyMs(latencyMs);
    });
    return unsub;
  }, [eventBus]);

  // Reset tokens on new run
  useEffect(() => {
    if (isRunning) {
      setTotalTokens(0);
      setLastLatencyMs(null);
    }
  }, [isRunning]);

  const runStatus = isRunning ? 'running' : error ? 'error' : 'idle';
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
        {totalTokens > 0 && <span>Tokens: {totalTokens.toLocaleString()}</span>}
        {lastLatencyMs != null && <span>Latency: {lastLatencyMs}ms</span>}
      </div>
    </footer>
  );
}

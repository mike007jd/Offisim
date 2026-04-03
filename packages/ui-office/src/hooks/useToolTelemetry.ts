import type { ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';

const MAX_ENTRIES = 50;

export interface ToolTelemetryStats {
  total: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgDurationMs: number;
}

export function useToolTelemetry(threadId: string | null) {
  const { toolTelemetryService, eventBus } = useOffisimRuntime();
  const [entries, setEntries] = useState<ToolExecutionTelemetryPayload[]>([]);

  // Load historical entries from service
  const refresh = useCallback(() => {
    if (!toolTelemetryService || !threadId) {
      setEntries([]);
      return;
    }
    const historical = toolTelemetryService.listByThread(threadId, { limit: MAX_ENTRIES });
    setEntries(historical);
  }, [toolTelemetryService, threadId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to live telemetry events
  useEffect(() => {
    if (!threadId) return;
    const off = eventBus.on(
      'tool.execution.telemetry',
      (event: { payload: ToolExecutionTelemetryPayload }) => {
        if (event.payload.threadId !== threadId) return;
        setEntries((prev) => [...prev, event.payload].slice(-MAX_ENTRIES));
      },
    );
    return off;
  }, [eventBus, threadId]);

  const stats = useMemo<ToolTelemetryStats>(() => {
    if (entries.length === 0) {
      return { total: 0, successCount: 0, errorCount: 0, successRate: 0, avgDurationMs: 0 };
    }
    const completed = entries.filter((e) => e.status !== 'started');
    const successCount = completed.filter((e) => e.status === 'completed').length;
    const errorCount = completed.filter(
      (e) => e.status === 'error' || e.status === 'denied',
    ).length;
    const totalDuration = completed.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
    return {
      total: completed.length,
      successCount,
      errorCount,
      successRate: completed.length > 0 ? successCount / completed.length : 0,
      avgDurationMs: completed.length > 0 ? Math.round(totalDuration / completed.length) : 0,
    };
  }, [entries]);

  return { entries, stats, refresh };
}

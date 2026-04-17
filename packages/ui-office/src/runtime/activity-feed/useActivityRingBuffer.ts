import type { ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import { useCallback, useState } from 'react';
import type { ToolCategory } from '../../lib/tool-category';
import { toolBurstLabel } from '../runtime-activity-formatters';
import type { RuntimeActivityEntry } from './activity-types';

const DEFAULT_CAPACITY = 6;

interface Params {
  capacity?: number;
}

interface Returns {
  entries: RuntimeActivityEntry[];
  push: (entry: RuntimeActivityEntry) => void;
  clear: () => void;
}

/**
 * FIFO ring buffer with a tool-burst merge rule: if a new tool entry shares
 * `burstKey` and tone with the current head and lands within 3.5s, the head
 * entry's `burstCount` is incremented instead of prepending a new row. Merge
 * logic lives here so every caller writes through the same push path.
 */
export function useActivityRingBuffer({ capacity = DEFAULT_CAPACITY }: Params = {}): Returns {
  const [entries, setEntries] = useState<RuntimeActivityEntry[]>([]);

  const push = useCallback(
    (next: RuntimeActivityEntry) => {
      setEntries((prev) => applyPush(prev, next, capacity));
    },
    [capacity],
  );

  const clear = useCallback(() => setEntries([]), []);

  return { entries, push, clear };
}

function applyPush(
  prev: RuntimeActivityEntry[],
  next: RuntimeActivityEntry,
  limit: number,
): RuntimeActivityEntry[] {
  const latest = prev[0];
  if (
    latest &&
    next.kind === 'tool' &&
    latest.kind === 'tool' &&
    next.burstKey &&
    latest.burstKey === next.burstKey &&
    next.tone === latest.tone &&
    Math.abs(next.timestamp - latest.timestamp) <= 3_500
  ) {
    const mergedCount = (latest.burstCount ?? 1) + (next.burstCount ?? 1);
    const [statusPart, categoryPart] = next.burstKey.split(':');
    return [
      {
        ...next,
        burstCount: mergedCount,
        label: toolBurstLabel(
          categoryPart as ToolCategory,
          statusPart as ToolExecutionTelemetryPayload['status'],
          mergedCount,
        ),
      },
      ...prev.slice(1),
    ].slice(0, limit);
  }
  return [next, ...prev].slice(0, limit);
}

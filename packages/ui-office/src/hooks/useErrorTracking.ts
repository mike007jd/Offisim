import type { ErrorOccurredPayload, RuntimeEvent } from '@aics/shared-types';
import { useEffect, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export interface TrackedError {
  errorCode: string;
  message: string;
  recoverable: boolean;
  nodeName: string;
  timestamp: number;
  employeeId?: string;
  taskRunId?: string;
}

const MAX_ERROR_HISTORY = 100;

/**
 * Accumulates structured error events from the EventBus.
 * Capped at {@link MAX_ERROR_HISTORY} entries to prevent unbounded growth.
 */
export function useErrorTracking(): TrackedError[] {
  const { eventBus } = useAicsRuntime();
  const [errors, setErrors] = useState<TrackedError[]>([]);

  useEffect(() => {
    const off = eventBus.on('error.occurred', (e: RuntimeEvent<ErrorOccurredPayload>) => {
      const { errorCode, message, recoverable, nodeName, employeeId, taskRunId } = e.payload;
      setErrors((prev) => {
        const next = [
          ...prev,
          { errorCode, message, recoverable, nodeName, timestamp: e.timestamp, employeeId, taskRunId },
        ];
        return next.length > MAX_ERROR_HISTORY ? next.slice(-MAX_ERROR_HISTORY) : next;
      });
    });
    return off;
  }, [eventBus]);

  return errors;
}

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

/**
 * Accumulates structured error events from the EventBus.
 *
 * TODO(P2): Wire this into a UI component (e.g., EventLog error tab or StatusBar error indicator)
 * to display error history. Currently this hook is defined but not consumed.
 */
export function useErrorTracking(): TrackedError[] {
  const { eventBus } = useAicsRuntime();
  const [errors, setErrors] = useState<TrackedError[]>([]);

  useEffect(() => {
    const off = eventBus.on('error.occurred', (e: RuntimeEvent<ErrorOccurredPayload>) => {
      const { errorCode, message, recoverable, nodeName, employeeId, taskRunId } = e.payload;
      setErrors((prev) => [
        ...prev,
        {
          errorCode,
          message,
          recoverable,
          nodeName,
          timestamp: e.timestamp,
          employeeId,
          taskRunId,
        },
      ]);
    });
    return off;
  }, [eventBus]);

  return errors;
}

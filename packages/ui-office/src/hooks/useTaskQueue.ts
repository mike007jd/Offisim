import type { TaskRunRow } from '@aics/core';
import type { RuntimeEvent, TaskStatePayload } from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMPANY_ID } from '../lib/constants';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export interface TaskQueueState {
  activeTasks: TaskRunRow[];
  pendingTasks: TaskRunRow[];
  recentCompleted: TaskRunRow[];
  statusCounts: Record<string, number>;
  loading: boolean;
}

const ACTIVE_STATUSES = ['active', 'queued'];
const PENDING_STATUSES = ['planned', 'pending'];
const COMPLETED_STATUSES = ['completed', 'failed', 'cancelled'];

/**
 * Provides live task queue data from the runtime repositories.
 *
 * Loads initial state from repos, then subscribes to `task.state.changed`
 * events for live updates. Uses rAF batching to coalesce rapid updates.
 */
export function useTaskQueue(): TaskQueueState {
  const { repos, eventBus } = useAicsRuntime();
  const [state, setState] = useState<TaskQueueState>({
    activeTasks: [],
    pendingTasks: [],
    recentCompleted: [],
    statusCounts: {},
    loading: true,
  });

  const rafIdRef = useRef<number | null>(null);
  const pendingRefreshRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!repos) return;

    try {
      const [active, pending, completed, counts] = await Promise.all([
        repos.taskRuns.findQueue(COMPANY_ID, { statuses: ACTIVE_STATUSES, limit: 20 }),
        repos.taskRuns.findQueue(COMPANY_ID, { statuses: PENDING_STATUSES, limit: 20 }),
        repos.taskRuns.findQueue(COMPANY_ID, { statuses: COMPLETED_STATUSES, limit: 10 }),
        repos.taskRuns.countByStatus(COMPANY_ID),
      ]);

      setState({
        activeTasks: active,
        pendingTasks: pending,
        recentCompleted: completed,
        statusCounts: counts,
        loading: false,
      });
    } catch (err) {
      console.error('[useTaskQueue] refresh failed:', err);
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [repos]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to task state changes with rAF batching
  useEffect(() => {
    const unsub = eventBus.on('task.state.changed', (_event: RuntimeEvent<TaskStatePayload>) => {
      if (pendingRefreshRef.current) return;
      pendingRefreshRef.current = true;

      rafIdRef.current = requestAnimationFrame(() => {
        pendingRefreshRef.current = false;
        refresh();
      });
    });

    return () => {
      unsub();
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [eventBus, refresh]);

  return state;
}

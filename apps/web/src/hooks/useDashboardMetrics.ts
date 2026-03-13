import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeStatePayload,
  LlmCallCompletedPayload,
  LlmUsageRecordedPayload,
  RuntimeEvent,
  TaskStatePayload,
} from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export interface DashboardMetrics {
  activeTaskCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  employeeUtilization: { active: number; total: number };
  elapsedMs: number | null;
  estimatedCostUsd: number;
}

const INITIAL_METRICS: DashboardMetrics = {
  activeTaskCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  employeeUtilization: { active: 0, total: 0 },
  elapsedMs: null,
  estimatedCostUsd: 0,
};

/** TaskStates considered "active" for the dashboard counter. */
const ACTIVE_TASK_STATES = new Set(['active', 'queued']);

/**
 * Model-aware cost estimation (per 1K tokens).
 * Falls back to a conservative mid-range estimate for unknown models.
 */
const COST_TABLE: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  // Google
  'gemini-2.5-flash': { input: 0.00015, output: 0.0006 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
};
const DEFAULT_COST = { input: 0.003, output: 0.015 };

function lookupCost(model: string | undefined) {
  if (!model) return DEFAULT_COST;
  // Try exact match, then prefix match (for versioned model names)
  const exact = COST_TABLE[model];
  if (exact) return exact;
  for (const [key, val] of Object.entries(COST_TABLE)) {
    if (model.startsWith(key)) return val;
  }
  return DEFAULT_COST;
}

/** Cost accumulator ref type — tracks per-model cost contributions. */
interface CostAccumulator {
  totalCost: number;
}

function estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
  const rates = lookupCost(model);
  return (inputTokens * rates.input + outputTokens * rates.output) / 1000;
}

/**
 * Aggregates runtime events into dashboard-level metrics:
 * token totals, cost estimate, active tasks, employee utilization, and elapsed time.
 */
export function useDashboardMetrics(): DashboardMetrics {
  const { eventBus, isRunning } = useAicsRuntime();
  const [metrics, setMetrics] = useState<DashboardMetrics>(INITIAL_METRICS);

  // Mutable refs for tracking sets across events without triggering re-renders per event.
  const activeTasksRef = useRef<Set<string>>(new Set());
  const employeeStatesRef = useRef<Map<string, string>>(new Map());
  const costAccRef = useRef<CostAccumulator>({ totalCost: 0 });

  // Elapsed time tracking
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset all accumulators when a new run starts
  useEffect(() => {
    if (isRunning) {
      activeTasksRef.current.clear();
      employeeStatesRef.current.clear();
      costAccRef.current = { totalCost: 0 };
      startTimeRef.current = Date.now();

      setMetrics({
        ...INITIAL_METRICS,
        elapsedMs: 0,
      });

      // Start elapsed timer
      timerRef.current = setInterval(() => {
        if (startTimeRef.current != null) {
          setMetrics((prev) => ({
            ...prev,
            elapsedMs: Date.now() - startTimeRef.current!,
          }));
        }
      }, 1000);
    } else {
      // Stop timer but keep elapsed time displayed
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current != null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning]);

  const updateMetrics = useCallback((updater: (prev: DashboardMetrics) => DashboardMetrics) => {
    setMetrics(updater);
  }, []);

  useEffect(() => {
    // --- LLM tokens (from llm.call.completed for totals) ---
    const unsubLlm = eventBus.on(
      'llm.call.completed',
      (event: RuntimeEvent<LlmCallCompletedPayload>) => {
        const { inputTokens, outputTokens } = event.payload;
        updateMetrics((prev) => ({
          ...prev,
          totalInputTokens: prev.totalInputTokens + inputTokens,
          totalOutputTokens: prev.totalOutputTokens + outputTokens,
        }));
      },
    );

    // --- Model-aware cost estimation (from llm.usage.recorded which includes model) ---
    const unsubUsage = eventBus.on(
      'llm.usage.recorded',
      (event: RuntimeEvent<LlmUsageRecordedPayload>) => {
        const { inputTokens, outputTokens, model } = event.payload;
        const callCost = estimateCost(inputTokens, outputTokens, model);
        costAccRef.current.totalCost += callCost;
        const newTotal = costAccRef.current.totalCost;
        updateMetrics((prev) => ({
          ...prev,
          estimatedCostUsd: newTotal,
        }));
      },
    );

    // --- Active task count ---
    const unsubTask = eventBus.on('task.state.changed', (event: RuntimeEvent<TaskStatePayload>) => {
      const { taskRunId, next } = event.payload;
      const tasks = activeTasksRef.current;

      if (ACTIVE_TASK_STATES.has(next)) {
        tasks.add(taskRunId);
      } else {
        tasks.delete(taskRunId);
      }

      updateMetrics((prev) => ({
        ...prev,
        activeTaskCount: tasks.size,
      }));
    });

    // --- Employee creation (register with initial 'idle' state for total count) ---
    const unsubCreated = eventBus.on(
      'employee.created',
      (event: RuntimeEvent<EmployeeCreatedPayload>) => {
        const states = employeeStatesRef.current;
        states.set(event.payload.employeeId, 'idle');

        updateMetrics((prev) => ({
          ...prev,
          employeeUtilization: { active: prev.employeeUtilization.active, total: states.size },
        }));
      },
    );

    // --- Employee deletion ---
    const unsubDeleted = eventBus.on(
      'employee.deleted',
      (event: RuntimeEvent<EmployeeDeletedPayload>) => {
        const states = employeeStatesRef.current;
        states.delete(event.payload.employeeId);

        let active = 0;
        for (const state of states.values()) {
          if (state !== 'idle') active++;
        }

        updateMetrics((prev) => ({
          ...prev,
          employeeUtilization: { active, total: states.size },
        }));
      },
    );

    // --- Employee utilization (prefix match on 'employee.state.') ---
    const unsubEmployee = eventBus.on(
      'employee.state.',
      (event: RuntimeEvent<EmployeeStatePayload>) => {
        const { employeeId, next } = event.payload;
        const states = employeeStatesRef.current;

        states.set(employeeId, next);

        let active = 0;
        for (const state of states.values()) {
          if (state !== 'idle') active++;
        }

        updateMetrics((prev) => ({
          ...prev,
          employeeUtilization: { active, total: states.size },
        }));
      },
    );

    return () => {
      unsubLlm();
      unsubUsage();
      unsubTask();
      unsubCreated();
      unsubDeleted();
      unsubEmployee();
    };
  }, [eventBus, updateMetrics]);

  return metrics;
}

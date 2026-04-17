import type {
  LlmCallCompletedPayload,
  LlmUsageRecordedPayload,
  RuntimeEvent,
  TaskStatePayload,
} from '@offisim/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime, useOffisimRuntimeStatus } from '../runtime/offisim-runtime-context';
import { useActiveEmployeeCount } from '../runtime/use-active-employee-count.js';

export interface DashboardMetrics {
  activeTaskCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  employeeUtilization: { active: number; total: number };
  elapsedMs: number | null;
  estimatedCostUsd: number;
  completedTasks: number;
  totalTasks: number;
  bossMessages: number;
  taskCompletionRate: number;
  bossInterventionRate: number;
  /** Returns the accumulated estimated cost (USD) for a given taskRunId, or 0 if no data. */
  getTaskCost: (taskRunId: string) => number;
}

type MetricsState = Omit<DashboardMetrics, 'getTaskCost' | 'employeeUtilization'>;

const INITIAL_METRICS: MetricsState = {
  activeTaskCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  elapsedMs: null,
  estimatedCostUsd: 0,
  completedTasks: 0,
  totalTasks: 0,
  bossMessages: 0,
  taskCompletionRate: 0,
  bossInterventionRate: 0,
};

/** TaskStates considered "active" for the dashboard counter. */
const ACTIVE_TASK_STATES = new Set(['active', 'queued']);

/**
 * Model-aware cost estimation (per 1K tokens).
 * Falls back to a conservative mid-range estimate for unknown models.
 */
const COST_TABLE: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  // Anthropic
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  // Google
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.5-flash': { input: 0.00015, output: 0.0006 },
  'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
  // Kimi/Moonshot
  'moonshot-v1-8k': { input: 0.001, output: 0.001 },
};
const DEFAULT_COST = { input: 0.001, output: 0.004 };

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
 *
 * Employee utilization (`active` / `total`) is delegated to
 * `useActiveEmployeeCount()` so the StatusBar footer and the 3D overlay
 * read the same authoritative numbers.
 */
export function useDashboardMetrics(): DashboardMetrics {
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const { activeCompanyId } = useCompany();
  const employeeCount = useActiveEmployeeCount();
  const [metrics, setMetrics] = useState<MetricsState>(() => ({ ...INITIAL_METRICS }));

  // Mutable refs for tracking sets across events without triggering re-renders per event.
  const activeTasksRef = useRef<Set<string>>(new Set());
  const costAccRef = useRef<CostAccumulator>({ totalCost: 0 });
  const costByTaskRef = useRef(new Map<string, number>());
  const completedTasksRef = useRef(0);
  const totalTasksRef = useRef(0);
  const bossMessagesRef = useRef(0);

  // Elapsed time tracking
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset all accumulators when a new run starts
  useEffect(() => {
    if (isRunning) {
      activeTasksRef.current.clear();
      costAccRef.current = { totalCost: 0 };
      costByTaskRef.current.clear();
      completedTasksRef.current = 0;
      totalTasksRef.current = 0;
      bossMessagesRef.current = 0;
      startTimeRef.current = Date.now();

      setMetrics(() => ({
        ...INITIAL_METRICS,
        elapsedMs: 0,
      }));

      // Start elapsed timer
      timerRef.current = setInterval(() => {
        if (startTimeRef.current != null) {
          const startTime = startTimeRef.current;
          setMetrics((prev) => ({
            ...prev,
            elapsedMs: Date.now() - startTime,
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

  const updateMetrics = useCallback((updater: (prev: MetricsState) => MetricsState) => {
    setMetrics(updater);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeCompanyId is an intentional trigger — re-runs reset + re-binds subscriptions on company switch even though the body doesn't read it
  useEffect(() => {
    // Reset accumulators on company switch so data doesn't bleed across companies.
    // Employee count is owned by useActiveEmployeeCount and resets independently
    // when activeCompanyId changes.
    activeTasksRef.current.clear();
    costAccRef.current = { totalCost: 0 };
    costByTaskRef.current.clear();
    completedTasksRef.current = 0;
    totalTasksRef.current = 0;
    bossMessagesRef.current = 0;
    setMetrics({ ...INITIAL_METRICS });

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
        const { inputTokens, outputTokens, model, taskRunId } = event.payload;
        const callCost = estimateCost(inputTokens, outputTokens, model);
        costAccRef.current.totalCost += callCost;
        // Accumulate cost per task
        if (taskRunId) {
          const current = costByTaskRef.current.get(taskRunId) ?? 0;
          costByTaskRef.current.set(taskRunId, current + callCost);

          // Prune oldest entries if map grows too large (long-running session defense)
          if (costByTaskRef.current.size > 5000) {
            const keys = Array.from(costByTaskRef.current.keys());
            for (const key of keys.slice(0, keys.length - 2500)) {
              costByTaskRef.current.delete(key);
            }
          }
        }
        const newTotal = costAccRef.current.totalCost;
        updateMetrics((prev) => ({
          ...prev,
          estimatedCostUsd: newTotal,
        }));
      },
    );

    // --- Active task count + completion KPI ---
    const unsubTask = eventBus.on('task.state.changed', (event: RuntimeEvent<TaskStatePayload>) => {
      const { taskRunId, next } = event.payload;
      const tasks = activeTasksRef.current;

      if (ACTIVE_TASK_STATES.has(next)) {
        if (!tasks.has(taskRunId)) {
          totalTasksRef.current += 1;
        }
        tasks.add(taskRunId);
      } else {
        tasks.delete(taskRunId);
        if (next === 'completed') {
          completedTasksRef.current += 1;
        }
      }

      const total = totalTasksRef.current;
      const completed = completedTasksRef.current;
      const bossMsg = bossMessagesRef.current;

      updateMetrics((prev) => ({
        ...prev,
        activeTaskCount: tasks.size,
        completedTasks: completed,
        totalTasks: total,
        taskCompletionRate: total > 0 ? completed / total : 0,
        bossInterventionRate: total > 0 ? bossMsg / total : 0,
      }));
    });

    // --- Boss intervention counter (prefix match on 'boss.') ---
    const unsubBoss = eventBus.on('boss.', () => {
      bossMessagesRef.current += 1;
      const total = totalTasksRef.current;
      const bossMsg = bossMessagesRef.current;
      updateMetrics((prev) => ({
        ...prev,
        bossMessages: bossMsg,
        bossInterventionRate: total > 0 ? bossMsg / total : 0,
      }));
    });

    return () => {
      unsubLlm();
      unsubUsage();
      unsubTask();
      unsubBoss();
    };
  }, [eventBus, updateMetrics, activeCompanyId]);

  const getTaskCost = useCallback((taskRunId: string): number => {
    return costByTaskRef.current.get(taskRunId) ?? 0;
  }, []);

  return {
    ...metrics,
    employeeUtilization: { active: employeeCount.active, total: employeeCount.total },
    getTaskCost,
  };
}

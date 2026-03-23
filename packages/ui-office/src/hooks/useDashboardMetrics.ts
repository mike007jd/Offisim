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
import { useCompany } from '../components/company/CompanyContext.js';
import { useAicsRuntime, useAicsRuntimeStatus } from '../runtime/aics-runtime-context';

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

type MetricsState = Omit<DashboardMetrics, 'getTaskCost'>;

const INITIAL_METRICS: MetricsState = {
  activeTaskCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  employeeUtilization: { active: 0, total: 0 },
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
 */
export function useDashboardMetrics(): DashboardMetrics {
  const { eventBus, repos } = useAicsRuntime();
  const { isRunning } = useAicsRuntimeStatus();
  const { activeCompanyId } = useCompany();
  const [metrics, setMetrics] = useState<MetricsState>(INITIAL_METRICS);

  // Mutable refs for tracking sets across events without triggering re-renders per event.
  const activeTasksRef = useRef<Set<string>>(new Set());
  const employeeStatesRef = useRef<Map<string, string>>(new Map());
  const costAccRef = useRef<CostAccumulator>({ totalCost: 0 });
  const costByTaskRef = useRef(new Map<string, number>());
  const completedTasksRef = useRef(0);
  const totalTasksRef = useRef(0);
  const bossMessagesRef = useRef(0);

  // Elapsed time tracking
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial employee count from repos on mount (same pattern as useAgentStates).
  // Without this, the status bar shows "0/0 agents" until an employee.created event fires.
  useEffect(() => {
    if (!repos || !activeCompanyId) return;
    repos.employees.findByCompany(activeCompanyId).then((rows) => {
      const states = employeeStatesRef.current;
      for (const row of rows) {
        if (!states.has(row.employee_id)) {
          states.set(row.employee_id, 'idle');
        }
      }
      if (rows.length > 0) {
        setMetrics((prev) => ({
          ...prev,
          employeeUtilization: { active: prev.employeeUtilization.active, total: states.size },
        }));
      }
    });
  }, [repos, activeCompanyId]);

  // Reset all accumulators when a new run starts
  useEffect(() => {
    if (isRunning) {
      activeTasksRef.current.clear();
      employeeStatesRef.current.clear();
      costAccRef.current = { totalCost: 0 };
      costByTaskRef.current.clear();
      completedTasksRef.current = 0;
      totalTasksRef.current = 0;
      bossMessagesRef.current = 0;
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

  const updateMetrics = useCallback((updater: (prev: MetricsState) => MetricsState) => {
    setMetrics(updater);
  }, []);

  useEffect(() => {
    // Reset accumulators on company switch so data doesn't bleed across companies
    activeTasksRef.current.clear();
    employeeStatesRef.current.clear();
    costAccRef.current = { totalCost: 0 };
    costByTaskRef.current.clear();
    completedTasksRef.current = 0;
    totalTasksRef.current = 0;
    bossMessagesRef.current = 0;
    setMetrics(INITIAL_METRICS);

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
            for (let i = 0; i < keys.length - 2500; i++) {
              costByTaskRef.current.delete(keys[i]!);
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
      unsubCreated();
      unsubDeleted();
      unsubEmployee();
      unsubBoss();
    };
  }, [eventBus, updateMetrics, activeCompanyId]);

  const getTaskCost = useCallback((taskRunId: string): number => {
    return costByTaskRef.current.get(taskRunId) ?? 0;
  }, []);

  return { ...metrics, getTaskCost };
}

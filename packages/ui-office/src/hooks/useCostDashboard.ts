import { CostCalculationService } from '@aics/core/browser';
import type { CostAggregate } from '@aics/core/browser';
import type { LlmUsageRecordedPayload, RuntimeEvent } from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMPANY_ID } from '../lib/constants';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export interface CostSummary {
  totalCost: number;
  todayCost: number;
  totalCalls: number;
  todayCalls: number;
}

const INITIAL_SUMMARY: CostSummary = {
  totalCost: 0,
  todayCost: 0,
  totalCalls: 0,
  todayCalls: 0,
};

/**
 * Provides aggregated cost data from LLM call history.
 *
 * Refreshes on mount and whenever an `llm.usage.recorded` event fires.
 * Uses {@link CostCalculationService.getDashboardSummary} for a single-pass
 * aggregation instead of 3 separate queries.
 */
export function useCostDashboard() {
  const { repos, eventBus } = useAicsRuntime();
  const [summary, setSummary] = useState<CostSummary>(INITIAL_SUMMARY);
  const [byModel, setByModel] = useState<CostAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  // Debounce refresh: avoid hammering the repos when multiple events fire in quick succession
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!repos) return;

    const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

    try {
      const dashboard = await service.getDashboardSummary(COMPANY_ID);

      setSummary({
        totalCost: dashboard.totalCost,
        todayCost: dashboard.todayCost,
        totalCalls: dashboard.totalCalls,
        todayCalls: dashboard.todayCalls,
      });
      setByModel(dashboard.byModel);
    } catch (err) {
      console.error('[useCostDashboard] aggregation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [repos]);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to llm.usage.recorded for live updates (debounced)
  useEffect(() => {
    const unsub = eventBus.on(
      'llm.usage.recorded',
      (_event: RuntimeEvent<LlmUsageRecordedPayload>) => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          refresh();
        }, 500);
      },
    );

    return () => {
      unsub();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [eventBus, refresh]);

  return { summary, byModel, loading, refresh };
}

import { CostCalculationService } from '@aics/core';
import type { CostAggregate } from '@aics/core';
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
 * Uses {@link CostCalculationService} for rate lookups and aggregation.
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
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    try {
      const [allAgg, todayAgg, modelAgg] = await Promise.all([
        service.aggregateCosts(COMPANY_ID),
        service.aggregateCosts(COMPANY_ID, { from: `${today}T00:00:00.000Z` }),
        service.aggregateCosts(COMPANY_ID, { groupBy: 'model' }),
      ]);

      const totalCost = allAgg.reduce((sum, a) => sum + a.totalCost, 0);
      const totalCalls = allAgg.reduce((sum, a) => sum + a.callCount, 0);
      const todayCost = todayAgg.reduce((sum, a) => sum + a.totalCost, 0);
      const todayCalls = todayAgg.reduce((sum, a) => sum + a.callCount, 0);

      setSummary({ totalCost, todayCost, totalCalls, todayCalls });
      setByModel(modelAgg);
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
    const unsub = eventBus.on('llm.usage.recorded', (_event: RuntimeEvent<LlmUsageRecordedPayload>) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refresh();
      }, 500);
    });

    return () => {
      unsub();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [eventBus, refresh]);

  return { summary, byModel, loading, refresh };
}

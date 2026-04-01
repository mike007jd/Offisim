import { CostCalculationService } from '@offisim/core/browser';
import type { CostAggregate } from '@offisim/core/browser';
import type { LlmUsageRecordedPayload, RuntimeEvent } from '@offisim/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context';

export interface CostSummary {
  totalCost: number;
  todayCost: number;
  totalCalls: number;
  todayCalls: number;
  pricedCallCount: number;
  unpricedCallCount: number;
  costConfidence: 'exact' | 'catalog' | 'fallback' | 'unknown';
}

const INITIAL_SUMMARY: CostSummary = {
  totalCost: 0,
  todayCost: 0,
  totalCalls: 0,
  todayCalls: 0,
  pricedCallCount: 0,
  unpricedCallCount: 0,
  costConfidence: 'unknown',
};

/**
 * Provides aggregated cost data from LLM call history.
 *
 * Refreshes on mount and whenever an `llm.usage.recorded` event fires.
 * Uses {@link CostCalculationService.getDashboardSummary} for a single-pass
 * aggregation instead of 3 separate queries.
 */
export function useCostDashboard() {
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [summary, setSummary] = useState<CostSummary>(INITIAL_SUMMARY);
  const [byModel, setByModel] = useState<CostAggregate[]>([]);
  const [loading, setLoading] = useState(true);

  // Debounce refresh: avoid hammering the repos when multiple events fire in quick succession
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) return;

    const service = new CostCalculationService(repos.costRates, repos.llmCalls, repos.threads);

    try {
      const dashboard = await service.getDashboardSummary(activeCompanyId);

      setSummary({
        totalCost: dashboard.totalCost,
        todayCost: dashboard.todayCost,
        totalCalls: dashboard.totalCalls,
        todayCalls: dashboard.todayCalls,
        pricedCallCount: dashboard.pricedCallCount,
        unpricedCallCount: dashboard.unpricedCallCount,
        costConfidence: dashboard.costConfidence,
      });
      setByModel(dashboard.byModel);
    } catch (err) {
      console.error('[useCostDashboard] aggregation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [repos, activeCompanyId]);

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

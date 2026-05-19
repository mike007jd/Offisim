import type { NodeSummaryRow } from '@offisim/core/browser';
import { useCallback, useEffect, useState } from 'react';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context';

export function useNodeSummaries(threadId: string | null) {
  const { repos } = useOffisimRuntimeServices();
  const [summaries, setSummaries] = useState<NodeSummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!repos?.nodeSummaries || !threadId) {
      setSummaries([]);
      return;
    }
    setIsLoading(true);
    try {
      const result = await repos.nodeSummaries.listByThread(threadId, { limit: 50 });
      setSummaries(result);
    } finally {
      setIsLoading(false);
    }
  }, [repos, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { summaries, isLoading, refresh };
}

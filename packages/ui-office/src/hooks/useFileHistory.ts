import type { FileHistoryRow } from '@offisim/core/browser';
import { useCallback, useEffect, useState } from 'react';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context';

export function useFileHistory(threadId: string | null) {
  const { repos } = useOffisimRuntimeServices();
  const [changes, setChanges] = useState<FileHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!repos?.fileHistory || !threadId) {
      setChanges([]);
      return;
    }
    setIsLoading(true);
    try {
      const result = await repos.fileHistory.listByThread(threadId, { limit: 100 });
      setChanges(result);
    } finally {
      setIsLoading(false);
    }
  }, [repos, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { changes, isLoading, refresh };
}

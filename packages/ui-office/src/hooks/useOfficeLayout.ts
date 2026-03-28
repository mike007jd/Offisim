import type { OfficeLayoutRow } from '@offisim/core/browser';
import { useCallback, useEffect, useState } from 'react';

import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context.js';

export interface UseOfficeLayoutReturn {
  layouts: OfficeLayoutRow[];
  activeLayout: OfficeLayoutRow | null;
  loading: boolean;
  createLayout: (name: string, layoutJson: string) => Promise<string>;
  setActive: (layoutId: string) => Promise<void>;
  updateLayout: (layoutId: string, patch: { name?: string; layout_json?: string }) => Promise<void>;
  deleteLayout: (layoutId: string) => Promise<void>;
  refresh: () => void;
}

export function useOfficeLayout(): UseOfficeLayoutReturn {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [layouts, setLayouts] = useState<OfficeLayoutRow[]>([]);
  const [activeLayout, setActiveLayout] = useState<OfficeLayoutRow | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const all = await repos.officeLayouts.findByCompany(activeCompanyId);
      setLayouts(all);
      const active = await repos.officeLayouts.findActive(activeCompanyId);
      setActiveLayout(active);
    } finally {
      setLoading(false);
    }
  }, [repos, activeCompanyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createLayout = useCallback(
    async (name: string, layoutJson: string) => {
      if (!repos || !activeCompanyId) throw new Error('Runtime not ready');
      const layoutId = `layout_${crypto.randomUUID()}`;
      await repos.officeLayouts.create({
        layout_id: layoutId,
        company_id: activeCompanyId,
        name,
        layout_json: layoutJson,
        is_active: 0,
      });
      await refresh();
      return layoutId;
    },
    [repos, refresh, activeCompanyId],
  );

  const setActive = useCallback(
    async (layoutId: string) => {
      if (!repos || !activeCompanyId) return;
      await repos.officeLayouts.setActive(activeCompanyId, layoutId);
      await refresh();
    },
    [repos, refresh, activeCompanyId],
  );

  const updateLayout = useCallback(
    async (layoutId: string, patch: { name?: string; layout_json?: string }) => {
      if (!repos) return;
      await repos.officeLayouts.update(layoutId, patch);
      await refresh();
    },
    [repos, refresh],
  );

  const deleteLayout = useCallback(
    async (layoutId: string) => {
      if (!repos) return;
      await repos.officeLayouts.delete(layoutId);
      await refresh();
    },
    [repos, refresh],
  );

  return {
    layouts,
    activeLayout,
    loading,
    createLayout,
    setActive,
    updateLayout,
    deleteLayout,
    refresh,
  };
}

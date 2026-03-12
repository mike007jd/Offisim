import type { OfficeLayoutRow } from '@aics/core';
import { useCallback, useEffect, useState } from 'react';

import { useAicsRuntime } from '../runtime/aics-runtime-context.js';

const COMPANY_ID = 'company-default';

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
  const { repos } = useAicsRuntime();
  const [layouts, setLayouts] = useState<OfficeLayoutRow[]>([]);
  const [activeLayout, setActiveLayout] = useState<OfficeLayoutRow | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repos) { setLoading(false); return; }
    setLoading(true);
    try {
      const all = await repos.officeLayouts.findByCompany(COMPANY_ID);
      setLayouts(all);
      const active = await repos.officeLayouts.findActive(COMPANY_ID);
      setActiveLayout(active);
    } finally {
      setLoading(false);
    }
  }, [repos]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createLayout = useCallback(
    async (name: string, layoutJson: string) => {
      if (!repos) throw new Error('Runtime not ready');
      const layoutId = `layout_${crypto.randomUUID()}`;
      await repos.officeLayouts.create({
        layout_id: layoutId,
        company_id: COMPANY_ID,
        name,
        layout_json: layoutJson,
        is_active: 0,
      });
      await refresh();
      return layoutId;
    },
    [repos, refresh],
  );

  const setActive = useCallback(
    async (layoutId: string) => {
      if (!repos) return;
      await repos.officeLayouts.setActive(COMPANY_ID, layoutId);
      await refresh();
    },
    [repos, refresh],
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

  return { layouts, activeLayout, loading, createLayout, setActive, updateLayout, deleteLayout, refresh };
}

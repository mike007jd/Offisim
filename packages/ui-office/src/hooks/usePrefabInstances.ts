/**
 * usePrefabInstances — React hook for loading PrefabInstance data.
 *
 * Loads PrefabInstanceRow records from the runtime repository and
 * pairs each with its PrefabDefinition from the catalog.
 */

import { getBuiltinPrefab } from '@offisim/renderer';
import type { PrefabDefinition, PrefabInstanceRow } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { ensureSystemPrefabLayoutVersion } from '../lib/system-prefab-layout-repair.js';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context.js';

/** A prefab instance paired with its definition from the catalog. */
export interface PrefabInstanceWithDef {
  instance: PrefabInstanceRow;
  definition: PrefabDefinition;
}

export interface UsePrefabInstancesReturn {
  instances: PrefabInstanceWithDef[];
  loading: boolean;
  refresh: () => void;
}

/**
 * Hook that loads PrefabInstance records and resolves their definitions.
 * Returns empty array when no instances exist for the company.
 */
export function usePrefabInstances(): UsePrefabInstancesReturn {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const [instances, setInstances] = useState<PrefabInstanceWithDef[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setInstances([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      await ensureSystemPrefabLayoutVersion(repos, activeCompanyId);
      const rows = await repos.prefabInstances.findByCompany(activeCompanyId);

      const resolved: PrefabInstanceWithDef[] = [];
      for (const row of rows) {
        if (!row.enabled) continue;
        const def = getBuiltinPrefab(row.prefab_id);
        if (def) {
          resolved.push({ instance: row, definition: def });
        }
      }

      setInstances(resolved);
    } catch {
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [repos, activeCompanyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-refresh when prefab state changes (editor save, template init, etc.)
  useEffect(() => {
    if (!eventBus) return;
    return eventBus.on('prefab.state.changed', () => {
      void refresh();
    });
  }, [eventBus, refresh]);

  return { instances, loading, refresh };
}

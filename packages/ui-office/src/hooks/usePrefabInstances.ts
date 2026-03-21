/**
 * usePrefabInstances — React hook for loading PrefabInstance data.
 *
 * Loads PrefabInstanceRow records from the runtime repository and
 * pairs each with its PrefabDefinition from the catalog.
 *
 * The hook returns an empty array when:
 * - The runtime is not ready (repos is null)
 * - The prefabInstances repository is not yet wired into RuntimeRepositories
 * - No PrefabInstances have been created for the current company
 *
 * This allows Office3DView to fall back to hardcoded furniture when no
 * prefab data is available (backward compatibility).
 */

import { useState, useEffect, useCallback } from 'react';
import type { PrefabInstanceRow, PrefabDefinition } from '@aics/shared-types';
import { getBuiltinPrefab } from '@aics/renderer';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';
import { COMPANY_ID } from '../lib/constants.js';

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
 *
 * Returns an empty instances array when the prefab repo is not yet
 * wired into RuntimeRepositories, allowing the caller to fall back
 * to hardcoded furniture.
 */
export function usePrefabInstances(): UsePrefabInstancesReturn {
  const { repos } = useAicsRuntime();
  const [instances, setInstances] = useState<PrefabInstanceWithDef[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!repos) {
      setInstances([]);
      setLoading(false);
      return;
    }

    // PrefabInstanceRepository is not yet part of RuntimeRepositories.
    // When it is wired in, this check should be replaced with:
    //   const rows = await repos.prefabInstances.findByCompany(COMPANY_ID);
    const reposAny = repos as unknown as Record<string, unknown>;
    if (!reposAny['prefabInstances']) {
      setInstances([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const prefabRepo = reposAny['prefabInstances'] as {
        findByCompany: (companyId: string) => Promise<PrefabInstanceRow[]>;
      };
      const rows = await prefabRepo.findByCompany(COMPANY_ID);

      const resolved: PrefabInstanceWithDef[] = [];
      for (const row of rows) {
        if (!row.enabled) continue;
        const def = getBuiltinPrefab(row.prefab_id);
        if (def) {
          resolved.push({ instance: row, definition: def });
        }
        // Skip instances with unknown prefabIds — they won't render
      }

      setInstances(resolved);
    } catch {
      // Silently fail — fallback to hardcoded furniture
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }, [repos]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { instances, loading, refresh };
}

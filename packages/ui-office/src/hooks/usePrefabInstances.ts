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
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';
import { COMPANY_ID } from '../lib/constants.js';

/** A prefab instance paired with its definition from the catalog. */
export interface PrefabInstanceWithDef {
  instance: PrefabInstanceRow;
  definition: PrefabDefinition;
}

/**
 * Built-in prefab definition catalog.
 *
 * Maps prefabId → PrefabDefinition. This is the source of truth for
 * which 3D mesh to render for each prefab type. When the asset-schema
 * package gains a runtime catalog, this should be replaced by a
 * catalog lookup.
 */
const PREFAB_CATALOG: ReadonlyMap<string, PrefabDefinition> = new Map([
  ['workstation-standard', {
    prefabId: 'workstation-standard',
    name: 'Standard Workstation',
    description: '4-seat desk cluster with laptops and glass dividers',
    category: 'workspace',
    gridSize: [4, 4],
    composite: true,
    render2D: { template: 'desk-cluster', params: {} },
    bindingSlots: [
      { name: 'agent-context', type: 'agent-context', required: false },
    ],
  }],
  ['server-rack-2u', {
    prefabId: 'server-rack-2u',
    name: 'Server Rack (2U)',
    description: 'Server rack cabinet with LED indicators',
    category: 'compute',
    gridSize: [2, 1],
    composite: false,
    render2D: { template: 'server-rack', params: {} },
    bindingSlots: [
      { name: 'rack-provider', type: 'rack-provider', required: false },
    ],
  }],
  ['bookshelf-double', {
    prefabId: 'bookshelf-double',
    name: 'Double Bookshelf',
    description: 'Library bookshelf with reading tables',
    category: 'knowledge',
    gridSize: [12, 6],
    composite: true,
    render2D: { template: 'bookshelf', params: {} },
    bindingSlots: [
      { name: 'knowledge-source', type: 'knowledge-source', required: false },
    ],
  }],
  ['meeting-table-4', {
    prefabId: 'meeting-table-4',
    name: 'Meeting Table (4-seat)',
    description: 'Conference table with chairs and whiteboard',
    category: 'collaboration',
    gridSize: [8, 4],
    composite: true,
    render2D: { template: 'meeting-table', params: {} },
    bindingSlots: [
      { name: 'meeting-session', type: 'meeting-session', required: false },
    ],
  }],
  ['meeting-table-8', {
    prefabId: 'meeting-table-8',
    name: 'Meeting Table (8-seat)',
    description: 'Large conference table with chairs and whiteboard',
    category: 'collaboration',
    gridSize: [10, 5],
    composite: true,
    render2D: { template: 'meeting-table', params: {} },
    bindingSlots: [
      { name: 'meeting-session', type: 'meeting-session', required: false },
    ],
  }],
  ['sofa-set', {
    prefabId: 'sofa-set',
    name: 'Rest Area Set',
    description: 'Sofas, coffee table, and vending machine',
    category: 'decorative',
    gridSize: [10, 6],
    composite: true,
    render2D: { template: 'sofa-set', params: {} },
    bindingSlots: [],
  }],
  ['plant-small', {
    prefabId: 'plant-small',
    name: 'Small Plant',
    description: 'Decorative potted plant',
    category: 'decorative',
    gridSize: [1, 1],
    composite: false,
    render2D: { template: 'plant', params: {} },
    bindingSlots: [],
  }],
  ['plant-large', {
    prefabId: 'plant-large',
    name: 'Large Plant',
    description: 'Large decorative plant',
    category: 'decorative',
    gridSize: [1, 1],
    composite: false,
    render2D: { template: 'plant-large', params: {} },
    bindingSlots: [],
  }],
  ['network-switch', {
    prefabId: 'network-switch',
    name: 'Network Switch',
    description: 'Flat switch box with port indicators',
    category: 'infrastructure',
    gridSize: [2, 1],
    composite: false,
    render2D: { template: 'network-switch', params: {} },
    bindingSlots: [],
  }],
  ['cable-tray', {
    prefabId: 'cable-tray',
    name: 'Cable Tray',
    description: 'Floor cable management channel',
    category: 'infrastructure',
    gridSize: [1, 3],
    composite: false,
    render2D: { template: 'cable-tray', params: {} },
    bindingSlots: [],
  }],
  ['reading-table', {
    prefabId: 'reading-table',
    name: 'Reading Table',
    description: 'Library reading table with chairs',
    category: 'knowledge',
    gridSize: [3, 2],
    composite: true,
    render2D: { template: 'reading-table', params: {} },
    bindingSlots: [],
  }],
  ['coffee-table', {
    prefabId: 'coffee-table',
    name: 'Coffee Table',
    description: 'Round coffee table',
    category: 'decorative',
    gridSize: [2, 2],
    composite: false,
    render2D: { template: 'coffee-table', params: {} },
    bindingSlots: [],
  }],
  ['vending-machine', {
    prefabId: 'vending-machine',
    name: 'Vending Machine',
    description: 'Snack and drink vending machine',
    category: 'infrastructure',
    gridSize: [1, 1],
    composite: false,
    render2D: { template: 'vending-machine', params: {} },
    bindingSlots: [],
  }],
  ['chair-standalone', {
    prefabId: 'chair-standalone',
    name: 'Office Chair',
    description: 'Standalone office chair',
    category: 'workspace',
    gridSize: [1, 1],
    composite: false,
    render2D: { template: 'chair', params: {} },
    bindingSlots: [],
  }],
  ['whiteboard', {
    prefabId: 'whiteboard',
    name: 'Whiteboard',
    description: 'Wall-mounted whiteboard',
    category: 'collaboration',
    gridSize: [3, 1],
    composite: false,
    render2D: { template: 'whiteboard', params: {} },
    bindingSlots: [],
  }],
]);

/** Resolve a PrefabDefinition from the catalog by prefabId. */
export function getPrefabDefinition(prefabId: string): PrefabDefinition | undefined {
  return PREFAB_CATALOG.get(prefabId);
}

/** Get all known prefab definitions. */
export function getAllPrefabDefinitions(): PrefabDefinition[] {
  return [...PREFAB_CATALOG.values()];
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
        const def = PREFAB_CATALOG.get(row.prefab_id);
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

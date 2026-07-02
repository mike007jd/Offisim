/**
 * Shared staging inputs for every SceneCue consumer (I3).
 *
 * One derivation RECIPE for the scene-domain facts `useSceneCueFrame` takes as
 * parameters: the real office layout, the roster, zone geometry, the seat
 * planner's home placements, and the staging prefabs (anchor offsets scaled by
 * SCENE_CONTENT_SCALE, matching both render modes). Hook instances do NOT
 * share state — each consumer memoizes its own copy per render. That stays
 * cheap: at most one scene (OfficeStage mounts 2D or 3D, never both) plus the
 * open workload drilldown compute it concurrently, and the underlying queries
 * are TanStack-cached. The guarantee is consistency, not sharing: every
 * consumer derives identical inputs from the same sources, so no scene
 * re-derives a projection input differently; per-scene geometry (pixel/world
 * mapping) stays in the scenes.
 */
import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useOfficeLayout } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import type { StagingPrefab } from '@offisim/shared-types';
import { useMemo } from 'react';
import { SCENE_CONTENT_SCALE } from './r3d/scene-art-direction.js';
import {
  type EmployeeScenePlacement,
  type ZoneDef,
  defaultEmployeeZone,
  employeePlacements,
  zoneDefsFromLayout,
} from './scene-layout.js';

export interface SceneStagingInputs {
  /** Real backend layout (zones + placed prefabs); null in the no-backend preview. */
  readonly layoutData: ReturnType<typeof useOfficeLayout>['data'];
  readonly roster: Employee[];
  readonly zoneDefs: ZoneDef[];
  readonly fallbackZone: ZoneDef;
  /** Home seat per employee from the shared seat planner (both render modes). */
  readonly positions: Map<string, EmployeeScenePlacement>;
  /** Placed prefabs as staging anchors, offsets scaled like the seat planner. */
  readonly stagingPrefabs: StagingPrefab[];
}

export function useSceneStagingInputs(): SceneStagingInputs {
  const companyId = useUiState((s) => s.companyId);
  const employees = useEmployees();
  const layout = useOfficeLayout(companyId);
  const layoutData = layout.data;

  const roster = useMemo(() => employees.data ?? [], [employees.data]);
  const zoneDefs = useMemo(() => zoneDefsFromLayout(layoutData), [layoutData]);
  const fallbackZone = useMemo(() => defaultEmployeeZone(zoneDefs), [zoneDefs]);
  const positions = useMemo(
    () => employeePlacements(roster, zoneDefs, fallbackZone, layoutData?.prefabs),
    [roster, zoneDefs, fallbackZone, layoutData?.prefabs],
  );
  const stagingPrefabs = useMemo<StagingPrefab[]>(
    () =>
      (layoutData?.prefabs ?? []).map((p) => ({
        instanceId: p.instance.instance_id,
        prefabId: p.instance.prefab_id,
        x: p.instance.position_x,
        z: p.instance.position_y,
        rotation: p.instance.rotation,
        // Anchor offsets scale to match the home-seat planner (which scales in
        // both render modes), so a relocated actor sits on the same seat in 2D
        // and 3D.
        scale: SCENE_CONTENT_SCALE,
      })),
    [layoutData?.prefabs],
  );

  return useMemo(
    () => ({ layoutData, roster, zoneDefs, fallbackZone, positions, stagingPrefabs }),
    [layoutData, roster, zoneDefs, fallbackZone, positions, stagingPrefabs],
  );
}

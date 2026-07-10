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
import type { AmbientRoutePlanner, StagingPrefab } from '@offisim/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { OFFICE_DELIVERY_STAGING_PREFAB } from './office-visual-language.js';
import { SCENE_CONTENT_SCALE } from './r3d/scene-art-direction.js';
import {
  type EmployeeScenePlacement,
  type ZoneDef,
  defaultEmployeeZone,
  employeePlacements,
  floorBounds,
  sceneObstacles,
  zoneDefsFromLayout,
} from './scene-layout.js';
import {
  type OfficePathfinder,
  buildOfficePathfinder,
  measureOfficeRouteWithinBounds,
} from './scene-pathfinding.js';
import {
  type SeatSlotRegistry,
  readSeatSlotRegistry,
  reconcileSeatSlotRegistry,
  seatSlotRegistriesEqual,
  writeSeatSlotRegistry,
} from './seat-slot-registry.js';

export interface SceneStagingInputs {
  /** Both roster and layout queries have settled; scenes suppress actors before this. */
  readonly ready: boolean;
  /** Real backend layout (zones + placed prefabs); null in the no-backend preview. */
  readonly layoutData: ReturnType<typeof useOfficeLayout>['data'];
  readonly roster: Employee[];
  readonly zoneDefs: ZoneDef[];
  readonly fallbackZone: ZoneDef;
  /** Home seat per employee from the shared seat planner (both render modes). */
  readonly positions: Map<string, EmployeeScenePlacement>;
  /** Placed prefabs as staging anchors, offsets scaled like the seat planner. */
  readonly stagingPrefabs: StagingPrefab[];
  /** One exact A* route grid shared by scene motion and ambient admission. */
  readonly pathfinder: OfficePathfinder | null;
  readonly routeFor: AmbientRoutePlanner;
  readonly routeSignature: string;
}

export function useSceneStagingInputs(): SceneStagingInputs {
  const companyId = useUiState((s) => s.companyId);
  const employees = useEmployees();
  const layout = useOfficeLayout(companyId);
  const layoutData = layout.data;

  const ready = employees.isSuccess && layout.isSuccess;
  const roster = useMemo(() => (ready ? (employees.data ?? []) : []), [employees.data, ready]);
  const zoneDefs = useMemo(
    () => (ready ? zoneDefsFromLayout(layoutData) : []),
    [layoutData, ready],
  );
  const fallbackZone = useMemo(() => defaultEmployeeZone(zoneDefs), [zoneDefs]);
  const [registrySnapshot, setRegistrySnapshot] = useState<{
    companyId: string;
    registry: SeatSlotRegistry;
  }>(() => ({ companyId, registry: readSeatSlotRegistry(companyId) }));
  const persistedRegistry = useMemo(
    () =>
      registrySnapshot.companyId === companyId
        ? registrySnapshot.registry
        : readSeatSlotRegistry(companyId),
    [companyId, registrySnapshot],
  );
  // Never rewrite a real company's stored slots from the synthetic fallback
  // while either query is still loading. Dev preview reaches isSuccess with a
  // null layout and intentionally uses the same stable registry contract.
  const registryReady = ready;
  const seatSlotRegistry = useMemo(
    () =>
      registryReady
        ? reconcileSeatSlotRegistry(roster, zoneDefs, fallbackZone, persistedRegistry)
        : persistedRegistry,
    [fallbackZone, persistedRegistry, registryReady, roster, zoneDefs],
  );
  useEffect(() => {
    if (!registryReady) return;
    writeSeatSlotRegistry(companyId, seatSlotRegistry);
    setRegistrySnapshot((current) =>
      current.companyId === companyId && seatSlotRegistriesEqual(current.registry, seatSlotRegistry)
        ? current
        : { companyId, registry: seatSlotRegistry },
    );
  }, [companyId, registryReady, seatSlotRegistry]);
  const positions = useMemo(
    () => employeePlacements(roster, zoneDefs, fallbackZone, layoutData?.prefabs, seatSlotRegistry),
    [roster, zoneDefs, fallbackZone, layoutData?.prefabs, seatSlotRegistry],
  );
  const stagingPrefabs = useMemo<StagingPrefab[]>(
    () => [
      ...(layoutData?.prefabs ?? []).map((p) => ({
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
      // A semantic scene fixture, not persisted customer layout: artifact beats
      // reserve it through the same deterministic anchor pipeline as furniture.
      OFFICE_DELIVERY_STAGING_PREFAB,
    ],
    [layoutData?.prefabs],
  );
  const routeGeometry = useMemo(() => {
    const obstacles = sceneObstacles(layoutData?.prefabs);
    const { floorW, floorD } = floorBounds(zoneDefs);
    return {
      bounds: { minX: -floorW / 2, minZ: -floorD / 2, maxX: floorW / 2, maxZ: floorD / 2 },
      obstacles,
    };
  }, [layoutData?.prefabs, zoneDefs]);
  const routeSignature = useMemo(
    () =>
      JSON.stringify({
        bounds: routeGeometry.bounds,
        obstacles: [...routeGeometry.obstacles].sort(
          (a, b) => a.x - b.x || a.z - b.z || a.radius - b.radius,
        ),
      }),
    [routeGeometry],
  );
  const pathfinder = useMemo(
    () =>
      routeGeometry.obstacles.length === 0
        ? null
        : buildOfficePathfinder(routeGeometry.bounds, routeGeometry.obstacles),
    [routeGeometry],
  );
  const routeFor = useMemo<AmbientRoutePlanner>(
    () =>
      ({ from, to, allowBlockedTarget }) => {
        const fromPoint = [from.x, from.z] as const;
        const toPoint = [to.x, to.z] as const;
        const distance = measureOfficeRouteWithinBounds(
          routeGeometry.bounds,
          pathfinder,
          fromPoint,
          toPoint,
          allowBlockedTarget,
        );
        return distance === null ? null : { distance };
      },
    [pathfinder, routeGeometry.bounds],
  );

  return useMemo(
    () => ({
      ready,
      layoutData,
      roster,
      zoneDefs,
      fallbackZone,
      positions,
      stagingPrefabs,
      pathfinder,
      routeFor,
      routeSignature,
    }),
    [
      ready,
      layoutData,
      roster,
      zoneDefs,
      fallbackZone,
      positions,
      stagingPrefabs,
      pathfinder,
      routeFor,
      routeSignature,
    ],
  );
}

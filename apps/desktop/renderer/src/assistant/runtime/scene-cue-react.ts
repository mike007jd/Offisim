/**
 * The ONE hook behind every scene surface (I3): composes the live runtime
 * sources — snapshot-derived workloads, the rolling beat window, dramaturgy
 * mode, reduced motion, roster, thread ownership, selection — into a single
 * `SceneCueFrame` per render. The 2D scene, the 3D scene, and the workload
 * drilldown all call this hook, so no component re-derives a runtime fact;
 * scenes keep only geometry and ink→hex mapping.
 *
 * Two-level memo mirrors the projection split: the base frame recomputes on
 * FACT changes only (`projectSceneBaseFrame`), while selection/hover/drag
 * transitions pay just the O(actors) `applyInputState` overlay — a hover never
 * re-runs staging, beat sorting, or flow bundling. The returned `actorById`
 * index is memoized on the decorated frame so consumers stop rebuilding it.
 *
 * `prefabs`/`actorPositions` are PARAMETERS, not hook-internal queries: they
 * carry scene art-direction facts (SCENE_CONTENT_SCALE anchor scaling, the
 * seat planner) that live in the surfaces layer, and querying them here would
 * re-create the runtime→surfaces import this layer just shed. They are built
 * by the shared `useSceneStagingInputs` office hook, so neither scene
 * re-derives them either. `now` is read from Date.now() at this hook boundary;
 * the projection itself stays pure.
 */
import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useThreads } from '@/data/queries.js';
import {
  type AmbientActorAvailability,
  type AmbientActorHome,
  type AmbientRoutePlanner,
  type StagingPrefab,
  worldAnchorsFor,
} from '@offisim/shared-types';
import { useMemo } from 'react';
import { useEmployeeWorkloads } from './conversation-run-react.js';
import { useOfficeAmbientDirections } from './office-ambient-life.js';
import { useOfficeBeats, usePrefersReducedMotion } from './office-dramaturgy.js';
import {
  type ActorCue,
  type SceneCueFrame,
  actorAcceptsAmbientCue,
  ambientDirectionsForAvailableActors,
  applyAmbientCues,
  applyInputState,
  projectSceneBaseFrame,
} from './scene-cue-projection.js';

export interface SceneCueFrameOptions {
  /** Staging prefabs in world coordinates (anchor offsets already scaled). */
  readonly prefabs: readonly StagingPrefab[];
  /** Home seat per employee — lets anchor reservation pick the nearest anchor. */
  readonly actorPositions?: ReadonlyMap<
    string,
    {
      readonly x: number;
      readonly z: number;
      readonly rotation?: number;
      readonly posture?: 'sitting' | 'standing';
    }
  >;
  /** Exact route oracle from the live 3D pathfinder; absent surfaces use straight travel. */
  readonly routeFor?: AmbientRoutePlanner;
  readonly routeSignature?: string;
  /** Scene-local interaction state; omitted by non-interactive consumers. */
  readonly hoveredEmployeeId?: string | null;
  readonly draggingEmployeeId?: string | null;
}

export function useSceneCueFrame(options: SceneCueFrameOptions): {
  readonly frame: SceneCueFrame;
  readonly actorById: Map<string, ActorCue>;
} {
  const {
    prefabs,
    actorPositions,
    routeFor,
    routeSignature,
    hoveredEmployeeId,
    draggingEmployeeId,
  } = options;
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const mode = useUiState((s) => s.officeMode);
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const workloads = useEmployeeWorkloads(projectId, companyId);
  const beats = useOfficeBeats(companyId);
  const reducedMotion = usePrefersReducedMotion();

  const roster = useMemo(() => (employees.data ?? []).map((e) => e.id), [employees.data]);
  // employeeId → owning threadId (first thread wins, matching the scenes' join).
  const threadByEmployee = useMemo(() => {
    const map = new Map<string, string>();
    for (const thread of threads.data ?? []) {
      if (thread.employeeId && !map.has(thread.employeeId)) map.set(thread.employeeId, thread.id);
    }
    return map;
  }, [threads.data]);
  // Selection resolves to the EMPLOYEE across ALL of their threads (any-thread
  // match): selecting an employee's non-first thread still selects the actor,
  // while the ActorCue.threadId click target keeps the first-thread join above.
  const selectedEmployeeId = useMemo(() => {
    if (!selectedThreadId) return null;
    return (threads.data ?? []).find((t) => t.id === selectedThreadId)?.employeeId ?? null;
  }, [threads.data, selectedThreadId]);

  // Level 1: facts only — interaction transitions never reach this memo.
  const baseFrame = useMemo(
    () =>
      projectSceneBaseFrame({
        roster,
        workloads,
        beats,
        // The single wall-clock read: the projection's liveness cut happens at
        // recompute time; the beat store's expiry timer re-notifies (new beats
        // array) when the soonest beat lapses, so `now` never goes stale.
        now: Date.now(),
        prefabs,
        ...(actorPositions ? { actorPositions } : {}),
        mode,
        reducedMotion,
        threadByEmployee,
      }),
    [roster, workloads, beats, prefabs, actorPositions, mode, reducedMotion, threadByEmployee],
  );

  const ambientActors = useMemo<AmbientActorAvailability[]>(
    () =>
      baseFrame.actors.map((actor) => ({
        employeeId: actor.employeeId,
        busy: !actorAcceptsAmbientCue(actor) || actor.employeeId === draggingEmployeeId,
      })),
    [baseFrame, draggingEmployeeId],
  );
  const ambientHomes = useMemo<AmbientActorHome[]>(() => {
    if (!actorPositions) return [];
    const homes: AmbientActorHome[] = [];
    for (const employeeId of roster) {
      const position = actorPositions.get(employeeId);
      if (!position) continue;
      homes.push({
        employeeId,
        x: position.x,
        z: position.z,
        facing: position.rotation ?? 0,
        posture: position.posture ?? 'sitting',
      });
    }
    return homes;
  }, [actorPositions, roster]);
  const blockedAnchorIds = useMemo(
    () =>
      baseFrame.actors.flatMap((actor) =>
        actor.staging?.anchorId ? [actor.staging.anchorId] : [],
      ),
    [baseFrame],
  );
  const ambientContext = useMemo(
    () => ({
      companyId,
      projectId,
      actors: ambientActors,
      homes: ambientHomes,
      prefabs,
      blockedAnchorIds,
      mode,
      reducedMotion,
      routeFor,
      routeSignature,
    }),
    [
      companyId,
      projectId,
      ambientActors,
      ambientHomes,
      prefabs,
      blockedAnchorIds,
      mode,
      reducedMotion,
      routeFor,
      routeSignature,
    ],
  );
  const ambientDirections = useOfficeAmbientDirections(ambientContext);
  const unavailableEmployeeIds = useMemo(
    () => new Set(ambientActors.filter((actor) => actor.busy).map((actor) => actor.employeeId)),
    [ambientActors],
  );
  const unavailableAmbientAnchorIds = useMemo(() => {
    const unavailable = new Set(blockedAnchorIds);
    if (unavailable.size === 0) return unavailable;
    const anchors = worldAnchorsFor(prefabs);
    const blockedFixtureIds = new Set(
      anchors
        .filter((anchor) => unavailable.has(anchor.anchorId))
        .map((anchor) => anchor.instanceId),
    );
    for (const anchor of anchors) {
      if (blockedFixtureIds.has(anchor.instanceId)) unavailable.add(anchor.anchorId);
    }
    return unavailable;
  }, [blockedAnchorIds, prefabs]);
  const visibleAmbientDirections = useMemo(
    () =>
      ambientDirectionsForAvailableActors(
        ambientDirections,
        unavailableEmployeeIds,
        unavailableAmbientAnchorIds,
      ),
    [ambientDirections, unavailableEmployeeIds, unavailableAmbientAnchorIds],
  );
  const ambientFrame = useMemo(
    () => applyAmbientCues(baseFrame, visibleAmbientDirections),
    [baseFrame, visibleAmbientDirections],
  );

  // Level 2: renderer-owned ambience, then the O(actors) interaction overlay.
  const frame = useMemo(
    () =>
      applyInputState(ambientFrame, {
        selectedEmployeeId,
        hoveredEmployeeId: hoveredEmployeeId ?? null,
        draggingEmployeeId: draggingEmployeeId ?? null,
      }),
    [ambientFrame, selectedEmployeeId, hoveredEmployeeId, draggingEmployeeId],
  );

  // The shared per-frame actor index every consumer previously rebuilt locally.
  const actorById = useMemo(
    () => new Map(frame.actors.map((actor) => [actor.employeeId, actor])),
    [frame],
  );

  return useMemo(() => ({ frame, actorById }), [frame, actorById]);
}

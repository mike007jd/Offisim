import { useUiState } from '@/app/ui-state.js';
import { useConversationRun } from '@/assistant/runtime/conversation-run-react.js';
import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import {
  FLOW_TARGET_LABELS,
  type FlowCueTarget,
  RESOURCE_KIND_GLYPHS,
  type SceneInk,
  type WorkloadChipTone,
  type WorkloadCue,
} from '@/assistant/runtime/scene-cue-projection.js';
import { useSceneCueFrame } from '@/assistant/runtime/scene-cue-react.js';
import { type EmployeeSeniority, employeeSeniorityLabel } from '@/data/employee-seniority.js';
import { useReassignEmployee } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { seniorityForEmployee, useEmployeeSeniorityRoster } from '@/data/use-employee-seniority.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { openArtifactClaim } from '@/surfaces/office/stage-viewer/artifact-claim.js';
import {
  CHARACTER_TURN_RATE_PER_SECOND,
  CHARACTER_WALK_SPEED_UNITS_PER_SECOND,
  type PaceSignal,
  animationTempoForPace,
  animationTempoForRole,
} from '@offisim/dramaturgy';
import type {
  CharacterPerformanceState,
  CharacterStatus,
  PrefabDefinition,
  PrefabInstanceRow,
  ResourceKind,
  RoleSlug,
} from '@offisim/shared-types';
import { Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  type CSSProperties,
  Fragment,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ACESFilmicToneMapping, type Group } from 'three';
import {
  type CharacterMoveOrigin,
  type CharacterMovementPhase,
  planCharacterMove,
} from './character-movement.js';
import { GltfCharacter } from './character/GltfCharacter.js';
import { preloadCharacterAssets } from './character/character-assets.js';
import { openDeliveryHistory } from './delivery-history.js';
import { FlowPacket3D } from './flow-packets-3d.js';
import { OfficeCompanion3D } from './office-companion/OfficeCompanion3D.js';
import {
  buildOfficeCompanionCandidates,
  officeCompanionOccupiedPoints,
} from './office-companion/companion-projection.js';
import { OFFICE_DELIVERY_WORLD, officeResourceMarkerColor } from './office-visual-language.js';
import { DioramaBackdrop } from './r3d/DioramaBackdrop.js';
import { DioramaDressing } from './r3d/DioramaDressing.js';
import { RoomShell } from './r3d/RoomShell.js';
import { SceneAnnotation, SceneAnnotationScheduler } from './r3d/SceneAnnotation.js';
import { SceneEnvironment } from './r3d/SceneEnvironment.js';
import { SceneLighting } from './r3d/SceneLighting.js';
import { ScenePostFx } from './r3d/ScenePostFx.js';
import { ZoneRug } from './r3d/ZoneDressing.js';
import { BookshelfMesh3D } from './r3d/prefabs/BookshelfMesh3D.js';
import { DecorativeMesh3D } from './r3d/prefabs/DecorativeMesh3D.js';
import { MeetingTableMesh3D } from './r3d/prefabs/MeetingTableMesh3D.js';
import { Prefab3D } from './r3d/prefabs/Prefab3D.js';
import { RestAreaMesh3D } from './r3d/prefabs/RestAreaMesh3D.js';
import { ServerRackUnit3D } from './r3d/prefabs/ServerRackMesh3D.js';
import { WhiteboardMesh3D } from './r3d/prefabs/WhiteboardMesh3D.js';
import { WorkstationUnit3D } from './r3d/prefabs/WorkstationMesh3D.js';
import {
  OFFICE_CAMERA_DEPTH,
  OFFICE_CAMERA_PRESET,
  SCENE_CONTENT_SCALE,
} from './r3d/scene-art-direction.js';
import {
  LIGHT_SCENE_3D,
  OFFICE_TOY_SIGNAL_COLORS,
  OFFICE_TOY_STATE_COLORS,
} from './r3d/scene-colors.js';
import { compactSceneEmployeeName } from './scene-labels.js';
import {
  type EmployeePosture,
  type EmployeeScenePlacement,
  type ZoneDef,
  rotateLocal,
} from './scene-layout.js';
import type { OfficePathfinder, PathPoint } from './scene-pathfinding.js';
import {
  WORKLOAD_CHIP_INK,
  projectActiveFlowTargets,
  projectFlowLanes,
  projectFlowTargetPoint,
} from './scene-projection.js';
import {
  type SceneEmployeeDrag,
  type SceneEmployeeDrop,
  useEmployeeDrag,
} from './use-employee-drag.js';
import {
  type LocalChatterVisibleBubble,
  localChatterLifecycleScope,
  resolveRawChatterLocale,
  useLocalChatter,
} from './use-local-chatter.js';
import { useSceneStagingInputs } from './use-scene-staging-inputs.js';
import { WorkBench } from './work-bench/WorkBench.js';

// Warm the glTF loader cache the moment the scene module loads so first paint
// gets all character bodies/animations/accessories in parallel instead of a
// per-suspend waterfall (the Personnel preview shares the same cache).
preloadCharacterAssets();

const PIP_FRAME_INTERVAL_MS = 250;

/** Expanded PiP renders at a bounded 4fps. Full Game View keeps its continuous
 * loop; collapsed PiP is unmounted by OfficeStage and schedules zero frames. */
function PipFrameDriver({ active }: { active: boolean }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!active) return;
    invalidate();
    const timer = window.setInterval(invalidate, PIP_FRAME_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, invalidate]);
  return null;
}

interface SceneEmployeeReturn {
  readonly id: string;
  readonly employeeId: string;
  readonly x: number;
  readonly z: number;
}

interface SceneEmployeeEntry {
  readonly id: string;
  readonly employeeId: string;
  readonly x: number;
  readonly z: number;
}

interface SceneDropNotice {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly message: string;
}

interface SceneFlowLine {
  readonly id: string;
  readonly from: readonly [number, number, number];
  readonly to: readonly [number, number, number];
  readonly color: string;
  readonly ink: SceneInk;
  readonly pulse: boolean;
  readonly phase: number;
  /** Failure wording already lives on the actor workload; keep line/packet/target only. */
  readonly showLabel: boolean;
  /** Lane density text (the shared flowCueText rule: `×N · label` for bundles). */
  readonly label: string;
  /** Lane label anchor — the curve midpoint, stacked when lanes share endpoints. */
  readonly labelPosition: readonly [number, number, number];
  /** 1.6px base + the shared bundleEmphasis step (+1 when the cue bundles ≥2 signals). */
  readonly lineWidth: number;
}

function employeeMovePlan(
  pathfinder: OfficePathfinder | null,
  start: PathPoint,
  target: PathPoint,
  origin: CharacterMoveOrigin,
  currentPhase: CharacterMovementPhase,
  reducedMotion: boolean,
) {
  const routedWaypoints = pathfinder?.findWaypoints(start, target) ?? null;
  return planCharacterMove({
    start,
    target,
    origin,
    currentPhase,
    reducedMotion,
    pathfinderAvailable: pathfinder !== null,
    routedWaypoints,
  });
}

/** Stable inside-edge spawn point for a newly added employee. */
function employeeEntryPoint(
  placement: EmployeeScenePlacement,
  zones: readonly ZoneDef[],
): PathPoint {
  const zone = zones.find((candidate) => candidate.id === placement.zoneId);
  if (!zone) return [placement.x, placement.z];
  return [zone.cx, zone.cz + Math.max(0, zone.d / 2 - 0.8)];
}

/**
 * THE one 3D ink→hex table: every SceneCue ink role maps to exactly one
 * LIGHT_SCENE_3D token. Approval is the amber LED tone — never the risk hue
 * (PRD) — and neutral is the quiet muted-text tone used for recovery signals.
 */
const INK_3D: Record<SceneInk, string> = {
  work: OFFICE_TOY_STATE_COLORS.working,
  artifact: OFFICE_TOY_SIGNAL_COLORS.artifact,
  risk: OFFICE_TOY_STATE_COLORS.blocked,
  approval: OFFICE_TOY_STATE_COLORS.approval,
  neutral: OFFICE_TOY_SIGNAL_COLORS.neutral,
};

const CHIP_TONE_3D: Record<WorkloadChipTone, string> = {
  work: INK_3D[WORKLOAD_CHIP_INK.work],
  wait: INK_3D[WORKLOAD_CHIP_INK.wait],
  risk: INK_3D[WORKLOAD_CHIP_INK.risk],
  done: INK_3D[WORKLOAD_CHIP_INK.done],
};

function flowTarget3D(target: FlowCueTarget) {
  const [x, z] = projectFlowTargetPoint(target, { mode: '3d' });
  return [x, target === 'delivery' ? 0.055 : 0.1, z] as const;
}

function DeliveryShelf3D({ interactive, onOpen }: { interactive: boolean; onOpen: () => void }) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the physical mesh is a pointer convenience; the adjacent Html shelf and artifact buttons expose every action to keyboard users.
    <group
      position={[OFFICE_DELIVERY_WORLD.x, 0, OFFICE_DELIVERY_WORLD.z]}
      onClick={(event) => {
        if (!interactive) return;
        event.stopPropagation();
        onOpen();
      }}
      onPointerOver={() => {
        if (interactive) document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      <RoundedBox args={[2.2, 0.32, 0.68]} radius={0.08} smoothness={4} position={[0, 0.16, 0]}>
        <meshStandardMaterial
          color={LIGHT_SCENE_3D.furnitureLight}
          roughness={0.82}
          metalness={0}
        />
      </RoundedBox>
      <RoundedBox args={[1.72, 0.42, 0.14]} radius={0.055} smoothness={4} position={[0, 0.5, 0.24]}>
        <meshStandardMaterial color={LIGHT_SCENE_3D.furniture} roughness={0.78} metalness={0} />
      </RoundedBox>
      {[-0.92, 0.92].map((x) => (
        <RoundedBox
          key={x}
          args={[0.12, 0.24, 0.58]}
          radius={0.035}
          smoothness={3}
          position={[x, 0.36, 0]}
        >
          <meshStandardMaterial color={LIGHT_SCENE_3D.deskEdge} roughness={0.8} metalness={0} />
        </RoundedBox>
      ))}
    </group>
  );
}

/** Display-only placed prefab. All editing now lives in StudioScene3D. */
function ScenePrefabInstance3D({
  instance,
  definition,
}: {
  instance: PrefabInstanceRow;
  definition: PrefabDefinition;
}) {
  return (
    // SCENE_CONTENT_SCALE lives on the placement group (not a single scene-wide
    // root) on purpose: `position` stays in stored authoring coordinates while
    // ground raycasts hit the world-space y=0 plane, so scaling here keeps
    // stored coords == world coords.
    <group
      position={[instance.position_x, 0, instance.position_y]}
      rotation={[0, (instance.rotation * Math.PI) / 180, 0]}
      scale={SCENE_CONTENT_SCALE}
    >
      <Prefab3D definition={definition} />
    </group>
  );
}

function EmployeeUnit({
  employee,
  seniority,
  x,
  z,
  rotation,
  posture,
  withDesk,
  running,
  status,
  workload,
  resourceKind,
  reducedMotion,
  selected,
  hovered,
  attention,
  dragging,
  performance,
  pace,
  zones,
  pathfinder,
  entryFrom,
  returnFromDrop,
  chatter = null,
  onSelect,
  onDrilldown,
  onHoverChange,
  onHoverZone,
  onDrop,
  onDragState,
}: {
  employee: Employee;
  seniority: EmployeeSeniority | undefined;
  x: number;
  z: number;
  rotation: number;
  posture: EmployeePosture;
  withDesk: boolean;
  running: boolean;
  status: CharacterStatus;
  workload: WorkloadCue | null;
  /** Typed strain of the top issue (frame.resources) — the six-kind marker glyph. */
  resourceKind: ResourceKind | null;
  reducedMotion: boolean;
  selected: boolean;
  hovered: boolean;
  /** frame.attention targets this actor — a subtle sustained focus emphasis. */
  attention: boolean;
  dragging: boolean;
  performance?: CharacterPerformanceState;
  pace: PaceSignal;
  zones: ZoneDef[];
  /** Floor pathfinder (H1/H2); null → the straight-line lerp fallback. */
  pathfinder: OfficePathfinder | null;
  /** New hires walk in from a stable zone-edge source instead of mounting at the seat. */
  entryFrom: SceneEmployeeEntry | null;
  /** A non-zone drop re-seeds the real actor at the visible ghost position;
   *  it then walks back to its unchanged semantic seat. */
  returnFromDrop: SceneEmployeeReturn | null;
  /** Optional presentation-only local chatter bubble (independent of the name tag). */
  chatter?: LocalChatterVisibleBubble | null;
  onSelect: () => void;
  onDrilldown: () => void;
  onHoverChange: (hovered: boolean) => void;
  onHoverZone: (zoneId: string | null) => void;
  onDrop: (result: SceneEmployeeDrop) => void;
  onDragState: (drag: SceneEmployeeDrag | null) => void;
}) {
  // Walk to the target (home placement or a high-value staged anchor). A
  // standard target change enters the atomic sit.exit phase; GltfCharacter
  // promotes it to walk only after the one-shot finishes (or immediately when
  // the actor is already standing). No-pathfinder previews use the explicit
  // straight fallback; a real pathfinder returning no route never glides.
  const unitRef = useRef<Group>(null);
  /** Inner character wrapper whose Y rotation is frame-driven (walk heading /
   *  seat facing). NOT a JSX rotation prop: re-renders mid-walk would snap the
   *  walker back to its seat orientation. */
  const headingRef = useRef<Group>(null);
  const walkingRef = useRef<CharacterMovementPhase>('idle');
  const appliedReturnIdRef = useRef<string | null>(null);
  const targetRef = useRef<[number, number]>([x, z]);
  targetRef.current = [x, z];
  // Waypoint route toward the current target. Always holds at least the final
  // target, so useFrame walks the list in order; when routing is unavailable it
  // holds just [target] and the walk is the straight lerp — behavior-identical
  // to the pre-pathfinding scene (zero regression).
  const waypointsRef = useRef<PathPoint[]>([[x, z]]);
  const waypointIndexRef = useRef(0);
  const plannedTargetRef = useRef<[number, number]>([x, z]);
  const plannedPostureRef = useRef<EmployeePosture>(posture);
  const plannedPathfinderRef = useRef(pathfinder);
  // Mount at the final seat for a loaded roster, or at the explicit entry point
  // for a newly added employee. Subsequent target changes are never snapped by
  // this mount-only effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only seed; live target changes are owned by the effects below.
  useLayoutEffect(() => {
    const group = unitRef.current;
    if (!group) return;
    const start: PathPoint = entryFrom ? [entryFrom.x, entryFrom.z] : [x, z];
    group.position.set(start[0], 0, start[1]);
    headingRef.current?.rotation.set(0, (rotation * Math.PI) / 180, 0);
    if (entryFrom) {
      const plan = employeeMovePlan(
        pathfinder,
        start,
        [x, z],
        'entry',
        walkingRef.current,
        reducedMotion,
      );
      waypointsRef.current = [...plan.waypoints];
      waypointIndexRef.current = 0;
      if (plan.snapToTarget) group.position.set(x, 0, z);
      walkingRef.current = plan.phase;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Precompute the walk route when the target changes — NOT every frame. A drag
  // to a new seat or a dramaturgy relocation replans from where the character
  // actually stands (its live animated position) around the known obstacles; an
  // unobstructed move (or a null pathfinder) collapses to a single-waypoint
  // straight line, the safe fallback that matches the old glide exactly.
  useEffect(() => {
    const group = unitRef.current;
    if (reducedMotion && walkingRef.current !== 'idle') {
      group?.position.set(x, 0, z);
      walkingRef.current = 'idle';
      waypointsRef.current = [[x, z]];
      waypointIndexRef.current = 0;
      plannedTargetRef.current = [x, z];
      plannedPostureRef.current = posture;
      plannedPathfinderRef.current = pathfinder;
      return;
    }
    const [px, pz] = plannedTargetRef.current;
    const distanceFromPlan = Math.hypot(x - px, z - pz);
    if (
      distanceFromPlan < 0.05 &&
      plannedPostureRef.current === posture &&
      plannedPathfinderRef.current === pathfinder
    )
      return;
    plannedTargetRef.current = [x, z];
    plannedPostureRef.current = posture;
    plannedPathfinderRef.current = pathfinder;
    const start: PathPoint = group ? [group.position.x, group.position.z] : [x, z];
    const plan = employeeMovePlan(
      pathfinder,
      start,
      [x, z],
      'settled',
      walkingRef.current,
      reducedMotion,
    );
    waypointsRef.current = [...plan.waypoints];
    waypointIndexRef.current = 0;
    if (plan.snapToTarget) group?.position.set(x, 0, z);
    walkingRef.current = plan.phase;
  }, [x, z, pathfinder, posture, reducedMotion]);

  // A drag ghost is the visible position the user released. Seed the actual
  // actor there before paint, then route to the shared placement. This handles
  // both successful zone changes and non-zone fallbacks without teleporting.
  useLayoutEffect(() => {
    if (!returnFromDrop || appliedReturnIdRef.current === returnFromDrop.id) return;
    const group = unitRef.current;
    if (!group) return;
    appliedReturnIdRef.current = returnFromDrop.id;
    group.position.set(returnFromDrop.x, 0, returnFromDrop.z);
    plannedTargetRef.current = [x, z];
    plannedPostureRef.current = posture;
    const start: PathPoint = [returnFromDrop.x, returnFromDrop.z];
    const plan = employeeMovePlan(
      pathfinder,
      start,
      [x, z],
      'drop-return',
      walkingRef.current,
      reducedMotion,
    );
    waypointsRef.current = [...plan.waypoints];
    waypointIndexRef.current = 0;
    if (plan.snapToTarget) group.position.set(x, 0, z);
    walkingRef.current = plan.phase;
  }, [pathfinder, posture, reducedMotion, returnFromDrop, x, z]);
  useFrame((_, delta) => {
    const group = unitRef.current;
    if (!group) return;
    let moveDx = 0;
    let moveDz = 0;
    if (walkingRef.current === 'walk') {
      const waypoints = waypointsRef.current;
      const lastIndex = waypoints.length - 1;
      let index = waypointIndexRef.current;
      if (index > lastIndex) index = lastIndex;
      let wp = waypoints[index] ?? targetRef.current;
      let dx = wp[0] - group.position.x;
      let dz = wp[1] - group.position.z;
      let dist = Math.hypot(dx, dz);
      // Advance through intermediate waypoints once close enough; only the final
      // waypoint uses the fine arrival threshold below.
      while (dist <= 0.28 && index < lastIndex) {
        index += 1;
        const nextWaypoint = waypoints[index];
        if (!nextWaypoint) break;
        wp = nextWaypoint;
        dx = wp[0] - group.position.x;
        dz = wp[1] - group.position.z;
        dist = Math.hypot(dx, dz);
      }
      waypointIndexRef.current = index;
      if (dist > 0.04) {
        const step = Math.min(1, (CHARACTER_WALK_SPEED_UNITS_PER_SECOND * delta) / dist);
        group.position.x += dx * step;
        group.position.z += dz * step;
        moveDx = dx;
        moveDz = dz;
      } else {
        group.position.set(x, 0, z);
        walkingRef.current = 'idle';
      }
    }
    // Face the walk direction while moving; settle back to the seat/staged
    // facing on arrival. Shortest-arc smoothing — an un-turned walker slides
    // sideways/backwards along its route and reads as a rigid figurine.
    const heading = headingRef.current;
    if (heading) {
      const target =
        Math.hypot(moveDx, moveDz) > 0.001 ? Math.atan2(moveDx, moveDz) : characterRotation;
      let diff = (target - heading.rotation.y) % (Math.PI * 2);
      if (diff > Math.PI) diff -= Math.PI * 2;
      if (diff < -Math.PI) diff += Math.PI * 2;
      heading.rotation.y += reducedMotion
        ? diff
        : diff * Math.min(1, delta * CHARACTER_TURN_RATE_PER_SECOND);
    }
  });
  const appearance = useMemo(
    () => resolveAppearance(employee.id, employee.appearance),
    [employee.id, employee.appearance],
  );
  // Employee performance profile flavor — tempo scales animation speed only.
  const tempo = useMemo(
    () =>
      animationTempoForPace(
        animationTempoForRole((employee.roleSlug ?? 'developer') as RoleSlug),
        pace,
      ),
    [employee.roleSlug, pace],
  );
  const phase = useMemo(
    () => (employee.id.charCodeAt(employee.id.length - 1) % 10) * 0.6,
    [employee.id],
  );
  const labelSeed = employee.id
    .split('')
    .reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0);
  const labelLane = (labelSeed % 5) - 2;
  const labelTier = Math.floor(labelSeed / 5) % 3;
  const labelX = labelLane * 0.3;
  const labelY = 2.12 + labelTier * 0.18 + Math.abs(labelLane) * 0.06;
  const labelZ = (labelTier - 1) * 0.24 + labelLane * 0.07;
  const labelText = compactSceneEmployeeName(employee.name);
  // The tag is interactive when selectable/running; the Html host also needs
  // pointer events when the workload bubble carries a clickable badge/marker/
  // chip row (drilldown) even if the actor itself is idle.
  const hasClickableWorkload =
    workload != null &&
    (workload.countLabel != null || workload.topIssue != null || workload.chips.length > 0);
  const labelInteractive = selected || running;
  const htmlInteractive = labelInteractive || hasClickableWorkload;
  // Blocked primary slot (PRD): a blocked-severity issue owns the bubble — the
  // marker takes the primary (top-right) slot, the ×N count demotes to the
  // secondary (top-left) slot, and the working tell (typing dots + working
  // halo) never renders over the blocked actor.
  const blocked = status === 'blocked';
  const hasTypedResourceMarker = Boolean(
    workload?.topIssue && workload.topIssue.kind !== 'approval' && resourceKind,
  );
  const stateColor =
    status === 'idle' ? OFFICE_TOY_SIGNAL_COLORS.neutral : OFFICE_TOY_STATE_COLORS[status];
  const resourceColor = workload?.topIssue
    ? officeResourceMarkerColor(workload.topIssue.severity)
    : OFFICE_TOY_STATE_COLORS.blocked;
  const actorStyle = {
    '--off-scene-state-color': stateColor,
    '--off-scene-selected-color': OFFICE_TOY_STATE_COLORS.selected,
    '--off-scene-resource-color': resourceColor,
  } as CSSProperties;
  const actorLabelText = status === 'blocked' ? `${labelText} · BLOCKED` : labelText;
  const actorStatusClass = status === 'idle' ? '' : ` is-status-${status}`;
  const characterRotation = (rotation * Math.PI) / 180;
  // One desk-depth-ish step along the character's facing (prefab-local +z).
  const fallbackDeskOffset = rotateLocal(0, 0.99, rotation);

  const beginDrag = useEmployeeDrag({
    employeeId: employee.id,
    x,
    z,
    zones,
    onHoverZone,
    onDrop,
    onDragState,
  });

  return (
    // Scale the whole unit (character, selection ring, label, fallback desk)
    // together so they stay proportional; the seat position stays unscaled.
    <group ref={unitRef} scale={SCENE_CONTENT_SCALE}>
      {withDesk ? (
        // Fallback desk sits in front of the character (along their facing) and
        // turns its chair side toward them, so they read as seated at it.
        <WorkstationUnit3D
          position={[fallbackDeskOffset[0], 0, fallbackDeskOffset[1]]}
          rotation={rotation + 180}
          variant="compact"
        />
      ) : null}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: r3f raycaster on a 3D object; employees are keyboard-selectable via the team dock and thread list */}
      <group
        ref={headingRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          e.nativeEvent.preventDefault();
          beginDrag(e.nativeEvent);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'grab';
          // Feed the scene's hover state so the shared frame's ActorCue.hovered
          // carries it (the cue is the source; no per-scene hover derivation).
          onHoverChange(true);
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
          onHoverChange(false);
        }}
      >
        <mesh position={[0, 1.05, 0]}>
          <boxGeometry args={[1.2, 2.1, 1.2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {!dragging ? (
          // Per-actor Suspense: a still-loading glb suspends only this
          // character (the hitbox, rings, label, and the rest of the scene
          // stay mounted); assets are module-preloaded so this rarely shows.
          <Suspense fallback={null}>
            <GltfCharacter
              appearance={appearance}
              status={status}
              selected={selected}
              hasTypedResourceMarker={hasTypedResourceMarker}
              posture={posture}
              reducedMotion={reducedMotion}
              performance={performance}
              walkingRef={walkingRef}
              tempo={tempo}
              phase={phase}
              role={employee.roleSlug ?? employee.role}
            />
          </Suspense>
        ) : null}
      </group>
      {!dragging ? (
        <SceneAnnotation
          position={[labelX, labelY, labelZ]}
          priority={selected || blocked || running ? 'critical' : 'actor'}
          interactive={htmlInteractive}
          exclude={unitRef}
        >
          {/* Relative wrapper so the active-count badge can sit at the tag's
              top-right corner without being clipped by the tag's overflow. */}
          <div className="off-scene-actor" style={actorStyle}>
            {labelInteractive ? (
              <button
                type="button"
                aria-label={`Open ${employee.name}${status === 'blocked' ? ', blocked' : ''}`}
                title={employee.name}
                className={`off-scene-tag is-interactive${actorStatusClass}${
                  selected ? ' is-selected' : ''
                }${attention ? ' is-attention' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  e.nativeEvent.preventDefault();
                  beginDrag(e.nativeEvent);
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  e.nativeEvent.preventDefault();
                  beginDrag(e.nativeEvent);
                }}
                onDragStart={(e) => {
                  e.preventDefault();
                }}
                draggable={false}
              >
                {actorLabelText}
              </button>
            ) : (
              <span className={`off-scene-tag${actorStatusClass}`}>{actorLabelText}</span>
            )}
            {hovered && seniority ? (
              <span className={`off-scene-seniority is-level-${seniority.level}`}>
                {employeeSeniorityLabel(seniority)}
              </span>
            ) : null}
            {/* The frame's WorkloadCue drives the ×N badge, the resource-marker
                hierarchy, and the chip row, in lockstep with the 2D scene. When
                the cue's primary slot is 'issue' the marker and badge swap
                slots (blocked wins the primary top-right position). All static
                (deterministic): no motion-only signal, so reduced motion
                changes nothing here. */}
            {workload?.countLabel ? (
              <button
                type="button"
                className={`off-scene-count-badge is-interactive${blocked ? ' is-secondary' : ''}`}
                aria-label={`${workload.activeCount} active runs — inspect workload`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDrilldown();
                }}
              >
                {workload.countLabel}
              </button>
            ) : null}
            {hasTypedResourceMarker && workload?.topIssue && resourceKind ? (
              // Resource markers are only the six typed strains. Approval owns
              // its amber status marker; kindless flow failures are confirmed
              // by the actor's blocked marker instead of a fake `!` resource.
              <span
                className={`off-scene-resource-marker is-${workload.topIssue.severity}${
                  blocked ? ' is-primary' : ''
                }`}
                aria-label={workload.topIssue.label}
                title={workload.topIssue.label}
              >
                {RESOURCE_KIND_GLYPHS[resourceKind]}
              </span>
            ) : null}
            {workload && workload.chips.length > 0 ? (
              <div className="off-scene-workload-bubble" aria-label="Workload">
                {workload.chips.map((chip) => (
                  <span
                    key={`${chip.tone}:${chip.label}`}
                    className={`is-${chip.tone}`}
                    style={{ '--off-scene-chip-color': CHIP_TONE_3D[chip.tone] } as CSSProperties}
                    title={chip.count != null ? `${chip.label} ${chip.count}` : chip.label}
                  >
                    {workload.tier === 'small'
                      ? chip.label.slice(0, 10)
                      : chip.count != null
                        ? `${chip.label} ${chip.count}`
                        : chip.label}
                  </span>
                ))}
                {workload.overflow ? (
                  <button
                    type="button"
                    className="off-scene-workload-overflow is-interactive"
                    aria-label="More workload — inspect"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDrilldown();
                    }}
                  >
                    +…
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </SceneAnnotation>
      ) : null}
      {!dragging && chatter ? (
        // Independent ambient annotation above the name tag — never nested in
        // the interactive label, and never changes selection/drag/status truth.
        <SceneAnnotation
          position={[labelX, labelY + 0.42, labelZ]}
          priority="ambient"
          interactive={false}
          exclude={unitRef}
        >
          <div
            aria-hidden
            data-scene-chatter=""
            className={`off-scene-chatter is-${chatter.kind} is-${chatter.motion}`}
          >
            {chatter.text}
          </div>
        </SceneAnnotation>
      ) : null}
    </group>
  );
}

function EmployeeDragGhost({
  employee,
  drag,
  reducedMotion,
}: {
  employee: Employee;
  drag: SceneEmployeeDrag;
  reducedMotion: boolean;
}) {
  const appearance = useMemo(
    () => resolveAppearance(employee.id, employee.appearance),
    [employee.id, employee.appearance],
  );
  const wobble = Math.sin((drag.clientX + drag.clientY) * 0.035) * 0.16;
  const phase = (drag.clientX + drag.clientY) * 0.012;
  const ghostOpacity = 1;

  return (
    <group position={[drag.x, 0.16, drag.z]} rotation={[0, wobble, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.94, 44]} />
        <meshBasicMaterial
          color={OFFICE_TOY_STATE_COLORS.selected}
          transparent
          opacity={drag.moved ? 0.12 : 0.06}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.58, 0.98, 44]} />
        <meshBasicMaterial
          color={OFFICE_TOY_STATE_COLORS.selected}
          transparent
          opacity={drag.moved ? 0.42 : 0.24}
          depthWrite={false}
        />
      </mesh>
      <group scale={1.5}>
        {/* Ghost fade: GltfCharacter clones per-instance materials (body AND
            held props), so `opacity` fades the whole silhouette coherently. */}
        <Suspense fallback={null}>
          <GltfCharacter
            appearance={appearance}
            status="idle"
            dragging
            phase={phase}
            opacity={ghostOpacity}
            role={employee.roleSlug ?? employee.role}
            reducedMotion={reducedMotion}
          />
        </Suspense>
      </group>
      {drag.moved ? (
        <SceneAnnotation position={[0, 2.64, 0]} priority="critical">
          <span className="off-scene-drag-chip">Move</span>
        </SceneAnnotation>
      ) : null}
    </group>
  );
}

function SceneDropNoticeLabel({ notice }: { notice: SceneDropNotice }) {
  return (
    <SceneAnnotation position={[notice.x, 1.15, notice.z]} priority="critical">
      <span className="off-scene-drop-note">{notice.message}</span>
    </SceneAnnotation>
  );
}

/** Synthetic furniture for the fallback layout (no real prefab instances). */
function FallbackFurniture() {
  return (
    <group scale={SCENE_CONTENT_SCALE}>
      <WorkstationUnit3D position={[-14.8, 0, 8.6]} rotation={0} variant="dual" />
      <WorkstationUnit3D position={[-2.7, 0, 9.0]} rotation={0} />
      <WorkstationUnit3D position={[10.4, 0, 9.0]} rotation={0} variant="dual" />
      <BookshelfMesh3D position={[-15.7, 0, -2.1]} rotation={0} template="bookshelf-double" />
      <BookshelfMesh3D position={[-7.0, 0, -2.1]} rotation={0} template="bookshelf-double" />
      <BookshelfMesh3D position={[-11.3, 0, 1.2]} rotation={0} template="reading-table" />
      <RestAreaMesh3D position={[3.5, 0, 0.2]} rotation={0} />
      <DecorativeMesh3D position={[7.8, 0, -0.6]} rotation={0} template="coffee-table" />
      <DecorativeMesh3D position={[11.5, 0, -2.1]} rotation={180} template="water-cooler" />
      <MeetingTableMesh3D position={[-9.4, 0, -8.45]} rotation={0} capacity={8} />
      <WhiteboardMesh3D position={[-9.4, 0, -11.7]} rotation={0} />
      <ServerRackUnit3D position={[6.2, 0, -9.2]} rotation={0} heightScale={1.24} />
      <ServerRackUnit3D position={[9.4, 0, -9.2]} rotation={0} />
      <ServerRackUnit3D position={[12.6, 0, -9.2]} rotation={0} heightScale={1.24} />
      <DecorativeMesh3D position={[-18.2, 0, 14.0]} rotation={0} template="plant-large" />
      <DecorativeMesh3D position={[17.2, 0, 14.0]} rotation={0} template="plant-large" />
    </group>
  );
}

export function OfficeScene3D({ pip = false }: { pip?: boolean }) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const closeThread = useUiState((s) => s.closeThread);
  const openStageView = useUiState((s) => s.openStageView);
  const openWorkloadDrilldown = useUiState((s) => s.openWorkloadDrilldown);
  const recordSceneDropDiagnostic = useUiState((s) => s.recordSceneDropDiagnostic);
  const selectedRun = useConversationRun(selectedThreadId ?? '');
  const reassign = useReassignEmployee();
  const [employeeDrag, setEmployeeDrag] = useState<SceneEmployeeDrag | null>(null);
  const [returnFromDrop, setReturnFromDrop] = useState<SceneEmployeeReturn | null>(null);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<SceneDropNotice | null>(null);

  // Shared staging inputs — the same layout/roster/seat-planner facts the 2D
  // scene and the drilldown read (never re-derived per scene).
  const {
    ready: sceneInputsReady,
    layoutData,
    roster,
    zoneDefs,
    fallbackZone: defaultEmployeeZone,
    positions: placementsByEmployee,
    stagingPrefabs,
    pathfinder,
    routeFor,
    routeSignature,
  } = useSceneStagingInputs();
  const seniority = useEmployeeSeniorityRoster(companyId, roster);
  const knownEmployeeIdsRef = useRef<Set<string> | null>(null);
  const enteringEmployeeIds = new Set<string>();
  if (sceneInputsReady && knownEmployeeIdsRef.current) {
    for (const employee of roster) {
      if (!knownEmployeeIdsRef.current.has(employee.id)) enteringEmployeeIds.add(employee.id);
    }
  }
  useLayoutEffect(() => {
    knownEmployeeIdsRef.current = sceneInputsReady
      ? new Set(roster.map((employee) => employee.id))
      : null;
  }, [roster, sceneInputsReady]);
  const real = layoutData ?? null;
  // Only reachable with a real backend layout that has zero zones — the
  // no-backend preview path always resolves to the non-empty FALLBACK_ZONES.
  // OfficeStage owns the "No office layout yet" overlay (so Studio mounts of
  // this scene never see it); here zero zones just means zero seats.
  const emptyOffice = zoneDefs.length === 0;
  const scenePrefabs = real?.prefabs;

  // GltfCharacter's reducedMotion prop path (frozen mixer → static poses) is a
  // render concern; the frame separately carries staging=null under reduced motion.
  const reducedMotion = usePrefersReducedMotion();

  // THE render contract: one SceneCueFrame per render, shared with the 2D
  // scene and the drilldown. Staging, performance, flows, delivery, workload
  // bubbles, and selection all come from here — along with the shared
  // actorById index; hover + drag feed its input state so the cues carry
  // them. Only world geometry stays local.
  const { frame, actorById, pace, ambientActorIds, ambientDirections } = useSceneCueFrame({
    prefabs: stagingPrefabs,
    actorPositions: placementsByEmployee,
    routeFor,
    routeSignature,
    hoveredEmployeeId,
    draggingEmployeeId: employeeDrag?.employeeId ?? null,
  });
  const chatterScopeKey = localChatterLifecycleScope(companyId, projectId);
  const chatterEnabled = !pip && sceneInputsReady && !emptyOffice && Boolean(companyId?.trim());
  const chatterByActor = useLocalChatter({
    enabled: chatterEnabled,
    scopeKey: chatterScopeKey,
    locale: resolveRawChatterLocale(
      typeof navigator !== 'undefined' ? navigator.language : undefined,
    ),
    reducedMotion,
    frame,
    ambientActorIds,
    ambientDirections,
  });
  const companionActorPositions = useMemo(
    () =>
      new Map(
        [...placementsByEmployee.entries()].map(([employeeId, position]) => [
          employeeId,
          { x: position.x, z: position.z },
        ]),
      ),
    [placementsByEmployee],
  );
  const companionOccupied = useMemo(
    () => officeCompanionOccupiedPoints(frame, companionActorPositions, OFFICE_DELIVERY_WORLD),
    [companionActorPositions, frame],
  );
  const companionCandidates = useMemo(
    () => buildOfficeCompanionCandidates(zoneDefs, companionOccupied, pathfinder),
    [companionOccupied, pathfinder, zoneDefs],
  );
  const deliveryLatest = frame.delivery.latest;

  const sceneFlowLines = useMemo<SceneFlowLine[]>(() => {
    return projectFlowLanes<readonly [number, number, number]>(frame.flows, {
      sourceFor: (cue) => {
        const home = placementsByEmployee.get(cue.employeeId) ?? {
          x: defaultEmployeeZone.cx,
          z: defaultEmployeeZone.cz,
        };
        const staging = actorById.get(cue.employeeId)?.staging;
        return [staging?.x ?? home.x, 0.055, staging?.z ?? home.z] as const;
      },
      targetFor: flowTarget3D,
      phaseFor: (cue) => (cue.at % 1600) / 1600,
      labelPositionFor: (from, to, slot) =>
        [(from[0] + to[0]) / 2, 0.42 + slot * 0.28, (from[2] + to[2]) / 2] as const,
    }).map((lane) => ({
      id: lane.id,
      from: lane.from,
      to: lane.to,
      color: INK_3D[lane.cue.ink],
      ink: lane.cue.ink,
      pulse: lane.cue.pulse,
      phase: lane.phase,
      showLabel: lane.showLabel,
      label: lane.label,
      labelPosition: lane.labelPosition,
      lineWidth: 1.25 + lane.emphasis * 0.75,
    }));
  }, [actorById, defaultEmployeeZone, placementsByEmployee, frame.flows]);

  // Purpose-distinct target anchors (I4): every target a live lane points at
  // gets a small labeled chip so lanes visibly go somewhere; the delivery
  // shelf is itself the delivery anchor whenever it renders.
  const activeFlowTargets = useMemo(() => projectActiveFlowTargets(frame.flows), [frame.flows]);

  // employeeId → typed resource strain for the six-kind marker glyphs.
  const resourceKindByEmployee = useMemo(
    () => new Map(frame.resources.map((res) => [res.employeeId, res.resourceKind])),
    [frame.resources],
  );
  const attentionEmployeeId =
    frame.attention?.target === 'employee' ? (frame.attention.employeeId ?? null) : null;
  const deliveryAttention = frame.attention?.target === 'delivery';

  // Artifact arrival (I5): a brief shelf highlight when recentCount increases —
  // a CSS transition on the shelf head; reduced motion renders it without
  // transition (statically) via the media query. Seeded with the mount count
  // so pre-existing claims never flash.
  const [deliveryArrived, setDeliveryArrived] = useState(false);
  const prevRecentCountRef = useRef(frame.delivery.recentCount);
  useEffect(() => {
    const previous = prevRecentCountRef.current;
    prevRecentCountRef.current = frame.delivery.recentCount;
    if (frame.delivery.recentCount < previous) {
      // Claim beats expired after the bounded delivery choreography: clear any
      // reset timer below was cancelled by this effect's own cleanup, so
      // without this the shelf would stay highlighted forever.
      setDeliveryArrived(false);
      return;
    }
    if (frame.delivery.recentCount === previous) return;
    setDeliveryArrived(true);
    const timer = window.setTimeout(() => setDeliveryArrived(false), 1500);
    return () => window.clearTimeout(timer);
  }, [frame.delivery.recentCount]);

  // Delivery history route (I5): the shelf surface / head / +N overflow opens
  // the latest claim owner's workload drilldown when resolvable, else opens
  // the claim — the shared owner-routing helper both scenes use.
  const handleDeliveryHistory = () =>
    openDeliveryHistory(frame.delivery.latest, { openWorkloadDrilldown, openStageView, projectId });

  const draggedEmployee = employeeDrag
    ? (roster.find((employee) => employee.id === employeeDrag.employeeId) ?? null)
    : null;
  const selectedWorkBenchEntry = useMemo(
    () => [...selectedRun.activity].reverse().find((entry) => entry.richDetail) ?? null,
    [selectedRun.activity],
  );

  useEffect(() => {
    if (!dropNotice) return;
    const timer = window.setTimeout(() => setDropNotice(null), 1400);
    return () => window.clearTimeout(timer);
  }, [dropNotice]);

  return (
    <>
      <Canvas
        shadows={pip ? false : 'soft'}
        dpr={pip ? 1 : [1, 2]}
        camera={{
          position: OFFICE_CAMERA_PRESET.position,
          fov: OFFICE_CAMERA_PRESET.fov,
          near: OFFICE_CAMERA_DEPTH.near,
          far: OFFICE_CAMERA_DEPTH.far,
        }}
        frameloop={pip ? 'demand' : 'always'}
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.02 }}
        className="off-scene-canvas"
      >
        <PipFrameDriver active={pip} />
        <SceneAnnotationScheduler />
        <DioramaBackdrop />
        <SceneLighting />
        <SceneEnvironment />
        <RoomShell onFloorClick={closeThread} />

        {zoneDefs.map((zone) => (
          <ZoneRug
            key={zone.id}
            zone={zone}
            highlight={employeeDrag !== null && hoveredZoneId === zone.id}
            showLabel={!pip}
          />
        ))}
        <DioramaDressing zones={zoneDefs} prefabCount={scenePrefabs?.length ?? 0} />

        {real ? (
          scenePrefabs?.map(({ instance, definition }) => (
            <ScenePrefabInstance3D
              key={instance.instance_id}
              instance={instance}
              definition={definition}
            />
          ))
        ) : (
          <FallbackFurniture />
        )}

        <OfficeCompanion3D
          frame={frame}
          candidates={companionCandidates}
          occupiedPoints={companionOccupied}
          actorPositions={companionActorPositions}
          pathfinder={pathfinder}
          geometryRevision={routeSignature}
          reducedMotion={reducedMotion}
        />

        {/* Zero zones → zero seats: an honest empty office renders nobody, so
            the synthetic default-zone placement fallback below stays unused. */}
        {emptyOffice
          ? null
          : roster.map((employee) => {
              const placement = placementsByEmployee.get(employee.id) ?? {
                x: defaultEmployeeZone.cx,
                z: defaultEmployeeZone.cz,
                rotation: 0,
                posture: 'standing' as const,
                zoneId: defaultEmployeeZone.id,
              };
              // Every runtime fact for this actor comes from its cue: running,
              // selection, drag, the workload bubble, staging, performance.
              const cue = actorById.get(employee.id);
              const running = cue?.running ?? false;
              const workload = cue?.workload ?? null;
              // High-value movement beats relocate the actor to a reserved
              // anchor; everything else stays at the home placement (and only
              // the performance changes).
              const anchor = cue?.staging ?? null;
              const relocated = anchor != null && anchor.x != null && anchor.z != null;
              const target = relocated
                ? {
                    x: anchor.x as number,
                    z: anchor.z as number,
                    rotation: anchor.facing ?? placement.rotation,
                    posture: (anchor.posture ?? placement.posture) as EmployeePosture,
                  }
                : placement;
              // Unstaged actors carry performance: null (the cue contract);
              // map null to undefined so GltfCharacter's legacy action-driven
              // clip path (idle loop, talk loop) stays byte-identical.
              const performance = cue?.performance ?? undefined;
              const threadId = cue?.threadId ?? null;
              const entryPoint = enteringEmployeeIds.has(employee.id)
                ? employeeEntryPoint(placement, zoneDefs)
                : null;
              return (
                <EmployeeUnit
                  key={employee.id}
                  employee={employee}
                  seniority={seniorityForEmployee(seniority.data, employee.id)}
                  x={target.x}
                  z={target.z}
                  rotation={target.rotation}
                  posture={!real ? 'sitting' : target.posture}
                  withDesk={!real}
                  running={running}
                  status={cue?.status ?? 'idle'}
                  workload={pip ? null : workload}
                  resourceKind={resourceKindByEmployee.get(employee.id) ?? null}
                  reducedMotion={reducedMotion}
                  selected={cue?.selected ?? false}
                  hovered={cue?.hovered ?? false}
                  attention={attentionEmployeeId === employee.id}
                  dragging={cue?.dragging ?? false}
                  performance={performance}
                  pace={pace}
                  zones={zoneDefs}
                  pathfinder={pathfinder}
                  chatter={chatterByActor.get(employee.id) ?? null}
                  entryFrom={
                    entryPoint
                      ? {
                          id: `entry-${employee.id}`,
                          employeeId: employee.id,
                          x: entryPoint[0],
                          z: entryPoint[1],
                        }
                      : null
                  }
                  returnFromDrop={
                    returnFromDrop?.employeeId === employee.id ? returnFromDrop : null
                  }
                  onSelect={() => threadId && openThread(threadId)}
                  onDrilldown={() => openWorkloadDrilldown(employee.id)}
                  onHoverChange={(hovered) =>
                    setHoveredEmployeeId((prev) =>
                      hovered ? employee.id : prev === employee.id ? null : prev,
                    )
                  }
                  onHoverZone={setHoveredZoneId}
                  onDragState={setEmployeeDrag}
                  onDrop={(result) => {
                    const changesZone = result.zoneId != null && result.zoneId !== placement.zoneId;
                    if (result.moved && !changesZone && result.x != null && result.z != null) {
                      setReturnFromDrop({
                        id: `drop-return-${crypto.randomUUID()}`,
                        employeeId: employee.id,
                        x: result.x,
                        z: result.z,
                      });
                    }
                    if (changesZone && result.zoneId)
                      reassign.mutate({ employeeId: employee.id, zoneId: result.zoneId });
                    recordSceneDropDiagnostic({
                      id: `drop-${crypto.randomUUID()}`,
                      at: new Date().toISOString(),
                      employeeId: employee.id,
                      startX: result.startX,
                      startY: result.startY,
                      endX: result.endX,
                      endY: result.endY,
                      targetZoneId: result.zoneId,
                      decision: result.zoneId ? 'assigned' : result.moved ? 'missed' : 'not-moved',
                    });
                    if (result.moved && !result.zoneId) {
                      setDropNotice({
                        id: `drop-note-${crypto.randomUUID()}`,
                        x: result.x ?? placement.x,
                        z: result.z ?? placement.z,
                        message: 'Drop on a zone',
                      });
                    }
                  }}
                />
              );
            })}

        {employeeDrag && draggedEmployee ? (
          <EmployeeDragGhost
            employee={draggedEmployee}
            drag={employeeDrag}
            reducedMotion={reducedMotion}
          />
        ) : null}
        {dropNotice ? <SceneDropNoticeLabel key={dropNotice.id} notice={dropNotice} /> : null}
        <DeliveryShelf3D interactive={deliveryLatest !== null} onOpen={handleDeliveryHistory} />
        {sceneFlowLines.map((line) => (
          <Fragment key={line.id}>
            <Line
              points={[line.from, line.to]}
              color={line.color}
              lineWidth={line.lineWidth}
              transparent
              opacity={0.38}
            />
            <FlowPacket3D
              from={line.from}
              to={line.to}
              color={line.color}
              pulse={line.pulse}
              phase={line.phase}
              reducedMotion={reducedMotion}
            />
            {/* Lane density label — the shared flowCueText rule (`×N · label`
                for bundles), a compact pill at the line midpoint. */}
            {!pip && line.showLabel ? (
              <SceneAnnotation position={line.labelPosition} priority="ambient">
                <span
                  className={`off-scene-flow-label is-${line.ink}`}
                  style={{ '--off-scene-flow-color': line.color } as CSSProperties}
                >
                  {line.label}
                </span>
              </SceneAnnotation>
            ) : null}
          </Fragment>
        ))}
        {/* Purpose-distinct target anchors — a small labeled node per active
            flow target (dense HUD, not decoration); the delivery shelf below
            is itself the delivery anchor when it renders. */}
        {pip
          ? null
          : activeFlowTargets.map((target) =>
              target === 'delivery' ? null : (
                <SceneAnnotation key={target} position={flowTarget3D(target)} priority="ambient">
                  <span className="off-scene-flow-anchor">{FLOW_TARGET_LABELS[target]}</span>
                </SceneAnnotation>
              ),
            )}
        {deliveryLatest ? (
          <SceneAnnotation
            position={[OFFICE_DELIVERY_WORLD.x, 0.88, OFFICE_DELIVERY_WORLD.z]}
            priority="critical"
            interactive
          >
            {/* Delivery shelf (I5) — a claimable output surface: ×N total on
                the head, up to 3 claimable chips (kind tag + ellipsized title,
                newest emphasized), +N overflow to history/drilldown, and a
                brief arrival highlight when a new claim lands. Same click
                semantics as the 2D shelf: the WHOLE shelf surface (wrapper
                padding + inter-chip gaps included) routes to history like the
                old full-surface button; chips/head/overflow keep their own
                handlers and stop propagation. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the wrapper click is a pointer convenience covering gaps between the real buttons; the head/chip/overflow buttons inside are keyboard-focusable and cover every action */}
            <div
              className={`off-scene-delivery${deliveryArrived ? ' is-arrived' : ''}${
                deliveryAttention ? ' is-attention' : ''
              }`}
              style={
                {
                  '--off-scene-artifact-color': OFFICE_TOY_SIGNAL_COLORS.artifact,
                } as CSSProperties
              }
              onClick={handleDeliveryHistory}
            >
              <button
                type="button"
                className="off-scene-delivery-shelf is-interactive"
                aria-label={`Delivery — ${frame.delivery.recentCount} artifacts, open history`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeliveryHistory();
                }}
              >
                <span>Delivery</span>
                <b>×{frame.delivery.recentCount}</b>
              </button>
              <div className="off-scene-delivery-chips">
                {frame.delivery.chips.map((chip, index) => (
                  <button
                    key={`${chip.deliverableId ?? chip.path ?? chip.title}-${index}`}
                    type="button"
                    className={`off-scene-delivery-chip${
                      index === frame.delivery.chips.length - 1 ? ' is-new' : ''
                    }`}
                    title={chip.title}
                    aria-label={`Open ${chip.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void openArtifactClaim(chip, { openStageView, projectId });
                    }}
                  >
                    <i>{chip.kind.slice(0, 3).toUpperCase()}</i>
                    <span>{chip.title}</span>
                  </button>
                ))}
                {frame.delivery.overflowCount > 0 ? (
                  <button
                    type="button"
                    className="off-scene-delivery-overflow"
                    aria-label={`${frame.delivery.overflowCount} more artifacts — open history`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeliveryHistory();
                    }}
                  >
                    +{frame.delivery.overflowCount}
                  </button>
                ) : null}
              </div>
            </div>
          </SceneAnnotation>
        ) : null}

        {/* Free orbit camera: drag to rotate, two-finger / right-drag to pan,
          scroll to zoom. Damped for a premium feel. Polar clamps keep the user
          above the floor plane; OrbitControls is suspended mid-drag so employee
          and prefab dragging keep the camera still. */}
        <OrbitControls
          makeDefault
          target={OFFICE_CAMERA_PRESET.target}
          enabled={!employeeDrag}
          enableRotate
          enablePan
          enableDamping
          dampingFactor={0.075}
          minDistance={OFFICE_CAMERA_PRESET.minDistance}
          maxDistance={OFFICE_CAMERA_PRESET.maxDistance}
          minPolarAngle={OFFICE_CAMERA_PRESET.minPolarAngle}
          maxPolarAngle={OFFICE_CAMERA_PRESET.maxPolarAngle}
        />
        {pip ? null : <ScenePostFx />}
      </Canvas>
      {selectedThreadId && selectedWorkBenchEntry?.richDetail ? (
        <button
          type="button"
          className="off-scene-work-bench-peek off-focusable"
          aria-label="Open selected employee work bench"
          onClick={() => {
            const detail = selectedWorkBenchEntry.richDetail;
            if (!detail) return;
            if (detail.family === 'browser') {
              openStageView({
                kind: 'preview',
                ref: {
                  source: 'browser',
                  sourceId: selectedWorkBenchEntry.id,
                  url: detail.url,
                  detail,
                },
                title: detail.title ?? selectedWorkBenchEntry.tool,
              });
              return;
            }
            openStageView({
              kind: 'logs',
              sourceId: selectedWorkBenchEntry.id,
              title: selectedWorkBenchEntry.tool,
              tool: selectedWorkBenchEntry.tool,
              status: selectedWorkBenchEntry.state,
              detail,
            });
          }}
        >
          <div className="off-scene-work-bench-label">{selectedWorkBenchEntry.tool}</div>
          <WorkBench
            detail={selectedWorkBenchEntry.richDetail}
            status={selectedWorkBenchEntry.state}
            compact
          />
        </button>
      ) : null}
    </>
  );
}

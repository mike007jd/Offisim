import { useUiState } from '@/app/ui-state.js';
import { usePrefersReducedMotion } from '@/assistant/runtime/office-dramaturgy.js';
import { useSceneCueFrame } from '@/assistant/runtime/scene-cue-react.js';
import { employeeSeniorityLabel } from '@/data/employee-seniority.js';
import { seniorityForEmployee, useEmployeeSeniorityRoster } from '@/data/use-employee-seniority.js';
import { openArtifactClaim } from '@/surfaces/office/stage-viewer/artifact-claim.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { openDeliveryHistory } from './delivery-history.js';
import { useCodexPet } from './office-companion/CodexPetProvider.js';
import { CODEX_PET_ATLAS } from './office-companion/codex-pet-animation.js';
import {
  type OfficeCompanionPlan,
  buildOfficeCompanionCandidates,
  officeCompanionOccupiedPoints,
  officeCompanionSpatialRevision,
} from './office-companion/companion-projection.js';
import { OFFICE_DELIVERY_WORLD } from './office-visual-language.js';
import { type Hit, type OccupiedRect, drawBackground } from './render2d/background.js';
import { drawCompanion } from './render2d/companion.js';
import { createEmployeeProjection, drawEmployees } from './render2d/employees.js';
import { drawFlows } from './render2d/flows.js';
import { drawShelf } from './render2d/shelf.js';
import { drawZones } from './render2d/zones.js';
import { floorBounds } from './scene-layout.js';
import { useSceneStagingInputs } from './use-scene-staging-inputs.js';

export { syncOfficeCanvasBackingStore } from './render2d/background.js';

export function OfficeScene2D({ pip = false }: { pip?: boolean }) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const officeMode = useUiState((s) => s.officeMode);
  const companionEnabled = useUiState((s) => s.officeCompanionEnabled);
  const { atlasUrl: companionAtlasUrl } = useCodexPet();
  const openThread = useUiState((s) => s.openThread);
  const openStageView = useUiState((s) => s.openStageView);
  const openWorkloadDrilldown = useUiState((s) => s.openWorkloadDrilldown);

  // Shared staging inputs (real zones + real roster + seat planner); the
  // synthetic fallback only applies when there is no backend (dev preview).
  const { roster, zoneDefs, positions, stagingPrefabs, pathfinder, routeFor, routeSignature } =
    useSceneStagingInputs();
  const seniority = useEmployeeSeniorityRoster(companyId, roster);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);
  const { floorW, floorD } = useMemo(() => floorBounds(zoneDefs), [zoneDefs]);

  // THE render contract: one SceneCueFrame per render, shared with the 3D
  // scene and the drilldown. All runtime facts (staging, flows, delivery,
  // workload bubbles, selection) come from here — along with the shared
  // actorById index; only geometry stays local.
  const { frame, actorById } = useSceneCueFrame({
    prefabs: stagingPrefabs,
    actorPositions: positions,
    routeFor,
    routeSignature,
  });
  const selectedEmployeeId = useMemo(
    () => frame.actors.find((actor) => actor.selected)?.employeeId ?? null,
    [frame.actors],
  );

  // ── Hoisted draw inputs: the draw closure below runs on every RAF tick
  // (~60×/s while any flow pulses), so every per-frame join/sort lives up here
  // on its actual deps and the closure only reads.
  // Attention (frame.attention → employee): the attention actor draws right
  // after the selected one, so both always win a name-label slot.
  const attentionEmployeeId =
    frame.attention?.target === 'employee' ? (frame.attention.employeeId ?? null) : null;
  // employeeId → typed resource strain for the six-kind marker glyphs.
  const resourceKindByEmployee = useMemo(
    () => new Map(frame.resources.map((res) => [res.employeeId, res.resourceKind])),
    [frame.resources],
  );
  const zoneById = useMemo(() => new Map(zoneDefs.map((zone) => [zone.id, zone])), [zoneDefs]);
  // The selected employee draws first so its name label always wins a slot.
  const orderedRoster = useMemo(() => {
    if (selectedEmployeeId == null && attentionEmployeeId == null) return roster;
    const labelPriority = (id: string) =>
      id === selectedEmployeeId ? 0 : id === attentionEmployeeId ? 1 : 2;
    return [...roster].sort((a, b) => labelPriority(a.id) - labelPriority(b.id));
  }, [roster, selectedEmployeeId, attentionEmployeeId]);
  // Purpose-distinct anchor targets: a lane only draws when its employee has a
  // seat, so gating on the same membership keeps this set identical to what
  // the flow pass paints.
  // Reduced motion freezes the packet animation and the shelf arrival glow
  // while every lane/label/anchor/marker keeps rendering statically.
  const reducedMotion = usePrefersReducedMotion();
  const companionAtlas = useMemo(() => {
    if (!companionAtlasUrl) return null;
    const image = new Image();
    image.src = companionAtlasUrl;
    return image;
  }, [companionAtlasUrl]);
  const [companionAtlasReady, setCompanionAtlasReady] = useState(false);
  const companionActorPositions = useMemo(
    () =>
      new Map(
        [...positions.entries()].map(([employeeId, position]) => [
          employeeId,
          { x: position.x, z: position.z },
        ]),
      ),
    [positions],
  );
  const companionOccupied = useMemo(
    () => officeCompanionOccupiedPoints(frame, companionActorPositions, OFFICE_DELIVERY_WORLD),
    [companionActorPositions, frame],
  );
  const companionCandidates = useMemo(
    () => buildOfficeCompanionCandidates(zoneDefs, companionOccupied, pathfinder),
    [companionOccupied, pathfinder, zoneDefs],
  );
  const companionSpatialRevision = useMemo(
    () =>
      officeCompanionSpatialRevision(
        companionCandidates,
        companionOccupied,
        companionActorPositions,
      ),
    [companionActorPositions, companionCandidates, companionOccupied],
  );
  const companionPlanRef = useRef<OfficeCompanionPlan | null>(null);
  const companionAnimationRef = useRef<{ state: string | null; startedAt: number }>({
    state: null,
    startedAt: 0,
  });
  const companionAnimationWakeRef = useRef<number | null>(null);

  // Artifact arrival (I5): a short-lived shelf glow when recentCount increases.
  // Refs only — the draw effect below keeps a bounded RAF alive while the glow
  // is armed (pulsing flows share the same loop). Seeded with the mount count
  // so pre-existing claims never glow.
  const prevRecentCountRef = useRef(frame.delivery.recentCount);
  const shelfGlowUntilRef = useRef(0);
  useEffect(() => {
    const previous = prevRecentCountRef.current;
    prevRecentCountRef.current = frame.delivery.recentCount;
    if (frame.delivery.recentCount > previous) shelfGlowUntilRef.current = Date.now() + 1600;
  }, [frame.delivery.recentCount]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<Hit[]>([]);
  // Latest draw closure, refreshed every render. The ResizeObserver setup and
  // the frame-driven draw effect below both call through this ref, so neither
  // tears down when the frame identity changes.
  const drawRef = useRef<() => void>(() => {});

  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const surface = drawBackground(canvas, floorW, floorD);
    if (!surface) return;

    // Anything drawn opaquely registers a box here so later passes (name
    // labels) can dodge it: zone titles first, then each employee's disc.
    const occupied: OccupiedRect[] = [];
    drawZones(surface, zoneDefs, pip, occupied);

    const hits: Hit[] = [];
    const employeeProjection = createEmployeeProjection({
      surface,
      positions,
      actorById,
      zoneById,
    });
    const { screenForEmployee } = employeeProjection;

    drawFlows({
      surface,
      frame,
      floorW,
      floorD,
      pip,
      reducedMotion,
      occupied,
      screenForEmployee,
    });
    drawShelf({
      surface,
      frame,
      floorW,
      floorD,
      reducedMotion,
      shelfGlowUntil: shelfGlowUntilRef.current,
      hits,
      occupied,
    });

    const companionResult = drawCompanion({
      surface,
      atlas: companionAtlas,
      atlasReady: companionAtlasReady,
      input: {
        enabled: companionEnabled,
        companyId,
        projectId,
        mode: officeMode,
        reducedMotion,
        geometryRevision: routeSignature,
        frame,
        candidates: companionCandidates,
        occupiedPoints: companionOccupied,
        actorPositions: companionActorPositions,
        spatialRevision: companionSpatialRevision,
        deliveryPoint: OFFICE_DELIVERY_WORLD,
        pathfinder,
      },
      plan: companionPlanRef.current,
      animation: companionAnimationRef.current,
    });
    companionPlanRef.current = companionResult.plan;
    companionAnimationRef.current = companionResult.animation;
    if (companionResult.animationWakeAt == null) {
      companionAnimationWakeRef.current = null;
    } else {
      companionAnimationWakeRef.current = companionResult.animationWakeAt;
    }

    drawEmployees({
      surface,
      orderedRoster,
      positions,
      actorById,
      projection: employeeProjection,
      resourceKindByEmployee,
      pip,
      hoveredEmployeeId,
      careerLabelForEmployee: (employeeId) => {
        const employeeSeniority = seniorityForEmployee(seniority.data, employeeId);
        return employeeSeniority ? employeeSeniorityLabel(employeeSeniority) : null;
      },
      occupied,
      hits,
    });
    hitsRef.current = hits;
  };

  useEffect(() => {
    setCompanionAtlasReady(false);
    if (!companionAtlas) return;
    if (
      companionAtlas.complete &&
      companionAtlas.naturalWidth === CODEX_PET_ATLAS.width &&
      companionAtlas.naturalHeight === CODEX_PET_ATLAS.height
    ) {
      setCompanionAtlasReady(true);
      drawRef.current();
      return;
    }
    const redraw = () =>
      setCompanionAtlasReady(
        companionAtlas.naturalWidth === CODEX_PET_ATLAS.width &&
          companionAtlas.naturalHeight === CODEX_PET_ATLAS.height,
      );
    companionAtlas.addEventListener('load', redraw, { once: true });
    return () => companionAtlas.removeEventListener('load', redraw);
  }, [companionAtlas]);

  // Setup effect: canvas mount only — resize redraws through drawRef, so the
  // observer never re-subscribes on frame identity changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const widthOwner = canvas?.closest<HTMLElement>('.off-office-center');
    if (!parent || !widthOwner) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(parent);
    observer.observe(widthOwner);
    return () => observer.disconnect();
  }, []);

  // Draw effect: one draw per decorated frame; while any flow pulses, a RAF
  // loop keeps the packet animation moving. An armed arrival glow keeps the
  // loop alive on its own when no flow pulses — bounded by glowUntil (≤1.6s),
  // so the glow can never freeze mid-fade — and the loop stops itself once
  // both animations are done. Reduced motion never loops — everything renders
  // once, statically (and the glow is skipped entirely).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the atlas/store/mode values intentionally invalidate this timer loop even though the live draw closure reads them through drawRef.
  useEffect(() => {
    let raf = 0;
    let timer = 0;
    const hasPulsingFlow = !reducedMotion && frame.flows.some((cue) => cue.pulse);
    const glowActive = () => !reducedMotion && shelfGlowUntilRef.current > Date.now();
    const tick = () => {
      drawRef.current();
      if (hasPulsingFlow || glowActive()) {
        raf = window.requestAnimationFrame(tick);
        return;
      }
      const companionPlan = companionPlanRef.current;
      const animationWakeAt = companionAnimationWakeRef.current;
      if (!companionPlan?.nextWakeAt && !animationWakeAt) return;
      const delay =
        companionPlan && !companionPlan.static
          ? 84
          : Math.max(
              16,
              Math.min(
                companionPlan?.nextWakeAt ?? Number.POSITIVE_INFINITY,
                animationWakeAt ?? Number.POSITIVE_INFINITY,
              ) - Date.now(),
            );
      timer = window.setTimeout(() => {
        raf = window.requestAnimationFrame(tick);
      }, delay);
    };
    tick();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [
    companionAtlasReady,
    companionEnabled,
    frame,
    hoveredEmployeeId,
    officeMode,
    reducedMotion,
    seniority.data,
  ]);

  // Hit testing walks registration order in REVERSE so the topmost-drawn
  // target wins — later employees' chip rows paint over earlier ones, so a
  // pointer on an overlap must resolve to what the user actually sees.
  // Employee-body hits are still authoritative: they win over ANY overlapping
  // bubble/shelf rect, so a wide neighbour chip row can never steal a body
  // click (thread selection is never hijacked). Index loops: this runs on
  // every pointermove, so no per-move slice().reverse() allocation.
  const hitAt = (px: number, py: number): Hit | null => {
    const hits = hitsRef.current;
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const h = hits[i];
      if (h?.kind === 'employee' && Math.hypot(px - h.sx, py - h.sy) <= h.r) return h;
    }
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const h = hits[i];
      if (h && h.kind !== 'employee' && px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) {
        return h;
      }
    }
    return null;
  };

  // A zero-zone (empty) office draws the bare floor slab with nobody seated —
  // employeePlacements returns no seats for zero zones; OfficeStage owns the
  // "No office layout yet" overlay for both render modes.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: canvas hit-test is a pointer convenience; employees are keyboard-selectable via the team dock and thread list
    <canvas
      ref={canvasRef}
      className="off-scene-canvas"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const hit = hitAt(e.clientX - rect.left, e.clientY - rect.top);
        // Interactive hits (employee, bubble, shelf) read as clickable.
        e.currentTarget.style.cursor = hit ? 'pointer' : '';
        setHoveredEmployeeId(hit?.kind === 'employee' ? hit.employeeId : null);
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.cursor = '';
        setHoveredEmployeeId(null);
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const hit = hitAt(e.clientX - rect.left, e.clientY - rect.top);
        if (!hit) return;
        if (hit.kind === 'employee') {
          if (hit.threadId) openThread(hit.threadId);
          return;
        }
        if (hit.kind === 'drilldown') {
          if (hit.employeeId) openWorkloadDrilldown(hit.employeeId);
          return;
        }
        // delivery chip — open exactly THAT claim on the stage (carries
        // threadId so the output surface loads in-thread, like the 3D shelf).
        if (hit.kind === 'delivery-chip') {
          const chip = frame.delivery.chips[hit.chipIndex ?? -1];
          if (chip) void openArtifactClaim(chip, { openStageView, projectId });
          return;
        }
        // delivery body / +N overflow — the shared history route (owner
        // drilldown via the claim's projection-stamped employeeId, else open
        // the claim itself).
        openDeliveryHistory(frame.delivery.latest, {
          openWorkloadDrilldown,
          openStageView,
          projectId,
        });
      }}
    />
  );
}

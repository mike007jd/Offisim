/**
 * Office2DCanvasView — HTML5 Canvas-based 2D office top-down view.
 *
 * Replaces the SVG-based Office2DView for rendering. Consumes the same
 * data hooks and props, but draws everything via Canvas 2D API through
 * the drawScene() renderer. No per-entity React elements.
 *
 * Redraw strategy: a `needsRedraw` ref flag is set when any input changes.
 * A single rAF loop checks the flag and calls drawScene if set.
 */
import { UNASSIGNED_ZONE_ID } from '@offisim/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator';
import {
  DEFAULT_BUBBLE_TEXT,
  getPhaseColor,
  prepareWaitingDisplay,
} from '../../lib/ceremony-visuals';
import { SeatRegistry } from '../../lib/seat-registry.js';
import { STATE_LABELS } from '../../lib/state-labels';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { useCompany } from '../company/CompanyContext.js';
import { usePrefabInstances } from '../../hooks/usePrefabInstances.js';
import { getAvatarUri } from './office-2d-avatar-cache';
import {
  type ViewportTransform,
  DRAG_THRESHOLD,
  EMPLOYEE_RADIUS,
  applyPan,
  applyWheelZoom,
  computeFitViewport,
  preserveViewportOnResize,
  screenToCanvas,
  worldToCanvas,
  zoneToCanvasRect,
} from './office-2d-canvas-geometry';
import { SceneHitMap } from './office-2d-hitmap';
import {
  type EmployeeRenderData,
  type InteractionState,
  type PrefabRenderData,
  type SceneSnapshot,
  type ZoneRenderData,
  drawScene,
  getStatusColor,
} from './office-2d-canvas-renderer';
import { ARCHETYPE_FALLBACK_MAP } from './office-2d-render-registry';
import { resolveEmployeeSceneZoneId } from './office3d-shared.js';

// ── Avatar Image Cache ──────────────────────────────────────────────

const avatarImageCache = new Map<string, HTMLImageElement>();

// ── Props ───────────────────────────────────────────────────────────

interface Office2DCanvasViewProps {
  ceremony: CeremonyState;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

// ── Component ───────────────────────────────────────────────────────

export default function Office2DCanvasView({
  ceremony,
  selectedEmployeeId: externalSelectedId = null,
  onSelectEmployee: _onSelectEmployee,
  onDeselectEmployee: _onDeselectEmployee,
}: Office2DCanvasViewProps) {
  const agents = useAgentStates();
  const { activeCompanyId } = useCompany();
  const { eventBus } = useOffisimRuntime();
  const companyId = activeCompanyId ?? '';
  const { zones } = useCompanyZones();
  const { instances: prefabInstances } = usePrefabInstances();

  // ── Canvas refs ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [hasCanvasContextError, setHasCanvasContextError] = useState(false);

  // ── Viewport (ref, not state — avoids re-renders on pan/zoom) ──
  const viewportRef = useRef<ViewportTransform>({ x: 0, y: 0, scale: 1 });

  // ── Redraw flag + rAF id ──
  const needsRedrawRef = useRef(true);
  const rafIdRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // ── Pan state refs ──
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing'>('default');

  // ── Drag-to-assign state refs ──
  const dragPhaseRef = useRef<'idle' | 'pending' | 'active'>('idle');
  const dragEmployeeRef = useRef<{
    employeeId: string;
    name: string;
    avatarImage: HTMLImageElement | ImageBitmap | null;
    statusColor: string;
    sourceZoneId: string;
  } | null>(null);
  const dragStartScreenRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // ── Build SeatRegistry (memoized) ──
  const seatRegistry = useMemo(
    () =>
      SeatRegistry.build(
        prefabInstances.map((entry) => entry.instance),
        zones,
      ),
    [prefabInstances, zones],
  );

  // ── Resolve employee zone ──
  const resolveEmployeeZone = useCallback(
    (agent: { role: string; workstationId?: string | null }): string => {
      return resolveEmployeeSceneZoneId(agent, zones);
    },
    [zones],
  );

  // ── Group employees by zone ──
  const zoneEmployees = useMemo(() => {
    const map = new Map<string, Array<{ empId: string; agent: { name: string; role: string; state: string; workstationId?: string | null }; seed: string }>>();
    for (const z of zones) map.set(z.zoneId, []);
    for (const [empId, agent] of agents) {
      const restZone = zones.find((z) => z.archetype === 'rest');
      const restId = restZone?.zoneId ?? UNASSIGNED_ZONE_ID;
      const zId = agent.state === 'idle' ? restId : resolveEmployeeZone(agent);
      map.get(zId)?.push({ agent, seed: agent.name, empId });
    }
    return map;
  }, [agents, zones, resolveEmployeeZone]);

  // ── Build zone render data ──
  const zoneRenderData: ReadonlyArray<ZoneRenderData> = useMemo(
    () =>
      zones.map((z) => {
        const rect = zoneToCanvasRect(z.cx, z.cz, z.w, z.d);
        return {
          zoneId: z.zoneId,
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          accentColor: z.accentColor,
          label: z.label,
          isInfrastructure: z.deskSlots === 0,
        };
      }),
    [zones],
  );

  // ── Build prefab render data ──
  const prefabRenderData: ReadonlyArray<PrefabRenderData> = useMemo(() => {
    if (prefabInstances.length > 0) {
      return prefabInstances.map((inst) => {
        const pos = worldToCanvas(inst.instance.position_x, inst.instance.position_y);
        return {
          prefabId: inst.definition.prefabId,
          category: inst.definition.category,
          x: pos.x,
          y: pos.y,
          rotation: inst.instance.rotation,
        };
      });
    }
    // Fallback: generate from zone archetypes
    return zones.map((z) => {
      const rect = zoneToCanvasRect(z.cx, z.cz, z.w, z.d);
      const archetype = z.archetype as string;
      const fallbackType = ARCHETYPE_FALLBACK_MAP[archetype] ?? 'workstation';
      const fallbackCategory =
        archetype === 'server'
          ? 'compute'
          : archetype === 'meeting'
            ? 'meeting'
            : archetype === 'library'
              ? 'knowledge'
              : archetype === 'rest'
                ? 'rest'
                : 'workspace';
      return {
        prefabId: `${fallbackType}-fallback`,
        category: fallbackCategory,
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        rotation: 0,
      };
    });
  }, [prefabInstances, zones]);

  // ── Avatar image adapter ──
  // Loads data URIs into HTMLImageElement objects with caching.
  // Triggers redraw on load.
  const getAvatarImage = useCallback(
    (seed: string, cId: string): HTMLImageElement | null => {
      const key = `${cId}:${seed}`;
      const cached = avatarImageCache.get(key);
      if (cached) return cached.complete ? cached : null;

      const uri = getAvatarUri(seed, cId);
      const img = new Image();
      img.src = uri;
      avatarImageCache.set(key, img);

      if (img.complete) return img;

      img.onload = () => {
        needsRedrawRef.current = true;
      };
      // Don't set needsRedraw on error to avoid infinite retry loops
      return null;
    },
    [],
  );

  // ── Ceremony-aware positions (mirrors Office2DView logic) ──
  const ceremonyActive = ceremony.phase !== 'idle';
  const dispatchedIds = useMemo(
    () => Array.from(ceremony.dispatchedIds).sort(),
    [ceremony.dispatchedIds],
  );
  const participantIds = useMemo(
    () => Array.from(ceremony.participantIds).sort(),
    [ceremony.participantIds],
  );

  const employeeCeremonyPositions = useMemo(() => {
    if (!ceremonyActive) return new Map<string, { x: number; y: number }>();

    const positions = new Map<string, { x: number; y: number }>();
    const mtgRect = zoneToCanvasRect(-10, -8, 14, 6);
    const mtgCx = mtgRect.x + mtgRect.w / 2;
    const mtgCy = mtgRect.y + mtgRect.h / 2;
    const restRect = zoneToCanvasRect(8, 2, 14, 8);
    const restCx = restRect.x + restRect.w / 2;
    const restCy = restRect.y + restRect.h / 2;

    const allEmps = [...agents.entries()];
    const mtgRadius = 100;

    allEmps.forEach(([empId], idx) => {
      const isDispatched = dispatchedIds.includes(empId);
      const isParticipant = participantIds.includes(empId);

      if (ceremony.phase === 'dismissing') {
        const angle = (idx / Math.max(allEmps.length, 1)) * Math.PI * 1.5 + 0.3;
        positions.set(empId, {
          x: restCx + Math.cos(angle) * 60,
          y: restCy + Math.sin(angle) * 40,
        });
      } else if (ceremony.phase === 'working' && isDispatched) {
        // Dispatched at workstations — no override
      } else if (isDispatched && ceremony.phase === 'dispatching') {
        const agent = agents.get(empId);
        const zoneId = agent ? resolveEmployeeZone(agent) : UNASSIGNED_ZONE_ID;
        const zone = zones.find((z) => z.zoneId === zoneId);
        if (zone) {
          const zoneEmps = zoneEmployees.get(zoneId) ?? [];
          const zoneIndex = zoneEmps.findIndex((entry) => entry.empId === empId);
          const seatIdx = Math.max(zoneIndex, 0);
          const seat = seatRegistry.getSeat(zone.zoneId, seatIdx);
          const [worldX, , worldZ] = seat?.position ?? [zone.cx, 0, zone.cz];
          const pos = worldToCanvas(worldX, worldZ);
          positions.set(empId, pos);
        }
      } else if (
        isParticipant ||
        ceremony.phase === 'gathering' ||
        ceremony.phase === 'analyzing' ||
        ceremony.phase === 'planning'
      ) {
        const angle = Math.PI * ((idx + 1) / (allEmps.length + 2));
        positions.set(empId, {
          x: mtgCx + Math.cos(angle) * mtgRadius,
          y: mtgCy + Math.sin(angle) * mtgRadius * 0.6,
        });
      }
    });

    return positions;
  }, [
    ceremonyActive,
    ceremony.phase,
    dispatchedIds,
    participantIds,
    agents,
    zones,
    resolveEmployeeZone,
    seatRegistry,
    zoneEmployees,
  ]);

  // ── Build employee render data ──
  const employeeRenderData: ReadonlyArray<EmployeeRenderData> = useMemo(() => {
    const result: EmployeeRenderData[] = [];
    const dropTargetZones = zones.filter((z) => z.deskSlots > 0);

    // Rest area employees (idle)
    const restZone = zones.find((z) => z.archetype === 'rest');
    if (restZone) {
      const restEmps = zoneEmployees.get(restZone.zoneId) ?? [];
      restEmps.forEach((emp, idx) => {
        // Skip if ceremony overrides position
        if (employeeCeremonyPositions.has(emp.empId)) return;
        const [worldX, , worldZ] = seatRegistry.getRestSeat(zones, idx);
        const pos = worldToCanvas(worldX, worldZ);
        const statusColor = getStatusColor(emp.agent.state);
        const stateLabel = STATE_LABELS[emp.agent.state] ?? null;
        result.push({
          employeeId: emp.empId,
          x: pos.x,
          y: pos.y,
          name: emp.agent.name,
          avatarImage: getAvatarImage(emp.seed, companyId),
          statusColor,
          state: emp.agent.state,
          stateLabel,
          isBlocked: emp.agent.state === 'blocked' || emp.agent.state === 'failed',
          isSuccess: emp.agent.state === 'success',
          isWorking:
            emp.agent.state === 'executing' ||
            emp.agent.state === 'thinking' ||
            emp.agent.state === 'searching',
          isActive: emp.agent.state !== 'idle',
        });
      });
    }

    // Department employees (active, at desks)
    for (const z of dropTargetZones) {
      const emps = zoneEmployees.get(z.zoneId) ?? [];
      emps.forEach((emp, idx) => {
        // Skip if ceremony overrides position
        if (employeeCeremonyPositions.has(emp.empId)) return;
        const seat = seatRegistry.getSeat(z.zoneId, idx);
        const [worldX, , worldZ] = seat?.position ?? [z.cx, 0, z.cz];
        const pos = worldToCanvas(worldX, worldZ);
        const statusColor = getStatusColor(emp.agent.state);
        const stateLabel = STATE_LABELS[emp.agent.state] ?? null;
        result.push({
          employeeId: emp.empId,
          x: pos.x,
          y: pos.y + 32, // offset below desk, matching SVG layout
          name: emp.agent.name,
          avatarImage: getAvatarImage(emp.seed, companyId),
          statusColor,
          state: emp.agent.state,
          stateLabel,
          isBlocked: emp.agent.state === 'blocked' || emp.agent.state === 'failed',
          isSuccess: emp.agent.state === 'success',
          isWorking:
            emp.agent.state === 'executing' ||
            emp.agent.state === 'thinking' ||
            emp.agent.state === 'searching',
          isActive: emp.agent.state !== 'idle',
        });
      });
    }

    // Ceremony-positioned employees
    for (const [empId, pos] of employeeCeremonyPositions) {
      const agent = agents.get(empId);
      if (!agent) continue;
      const statusColor = getStatusColor(agent.state);
      const stateLabel = STATE_LABELS[agent.state] ?? null;
      result.push({
        employeeId: empId,
        x: pos.x,
        y: pos.y,
        name: agent.name,
        avatarImage: getAvatarImage(agent.name, companyId),
        statusColor,
        state: agent.state,
        stateLabel,
        isBlocked: agent.state === 'blocked' || agent.state === 'failed',
        isSuccess: agent.state === 'success',
        isWorking:
          agent.state === 'executing' ||
          agent.state === 'thinking' ||
          agent.state === 'searching',
        isActive: agent.state !== 'idle',
      });
    }

    return result;
  }, [
    zones,
    zoneEmployees,
    employeeCeremonyPositions,
    seatRegistry,
    agents,
    companyId,
    getAvatarImage,
  ]);

  // ── Build SceneSnapshot ──
  const snapshot: SceneSnapshot = useMemo(() => {
    // Manager marker
    let managerMarker = null;
    if (ceremony.managerVisible && ceremony.managerPosition) {
      const pos = worldToCanvas(ceremony.managerPosition[0], ceremony.managerPosition[2]);
      managerMarker = { x: pos.x, y: pos.y };
    }

    // Meeting bubble
    let meetingBubble = null;
    if (
      ceremony.phase !== 'idle' &&
      (ceremony.bubbleText || ceremony.waitingRelationships.length > 0)
    ) {
      const mtgRect = zoneToCanvasRect(-10, -8, 14, 6);
      const bx = mtgRect.x + mtgRect.w / 2;
      const by = mtgRect.y - 30;
      const { labels, extraCount } = prepareWaitingDisplay(ceremony.waitingRelationships);
      meetingBubble = {
        x: bx,
        y: by,
        phaseColor: getPhaseColor(ceremony.phase),
        bubbleText: ceremony.bubbleText || DEFAULT_BUBBLE_TEXT,
        participantCount: ceremony.participantIds.size,
        waitingLabels: labels,
        extraWaitingCount: extraCount,
      };
    }

    return {
      zones: zoneRenderData,
      prefabs: prefabRenderData,
      employees: employeeRenderData,
      ceremony: {
        phase: ceremony.phase,
        isActive: ceremonyActive,
      },
      managerMarker,
      meetingBubble,
    };
  }, [
    zoneRenderData,
    prefabRenderData,
    employeeRenderData,
    ceremony.phase,
    ceremony.managerVisible,
    ceremony.managerPosition,
    ceremony.bubbleText,
    ceremony.waitingRelationships,
    ceremony.participantIds.size,
    ceremonyActive,
  ]);

  // ── Build SceneHitMap (memoized, rebuilt when employee/zone data changes) ──
  const hitMap = useMemo(() => {
    const employees = employeeRenderData.map((emp) => ({
      employeeId: emp.employeeId,
      cx: emp.x,
      cy: emp.y,
      radius: EMPLOYEE_RADIUS,
    }));
    const zones_ = zoneRenderData.map((z) => ({
      zoneId: z.zoneId,
      x: z.x,
      y: z.y,
      w: z.w,
      h: z.h,
    }));
    return new SceneHitMap(employees, zones_);
  }, [employeeRenderData, zoneRenderData]);

  // ── Drop target zone IDs (zones with deskSlots > 0) ──
  const dropTargetZoneIds = useMemo(
    () => zones.filter((z) => z.deskSlots > 0).map((z) => z.zoneId),
    [zones],
  );

  // ── Interaction state ──
  const interactionRef = useRef<InteractionState>({
    selectedEmployeeId: null,
    hoveredEmployeeId: null,
    drag: null,
  });
  // Keep selectedEmployeeId in sync with prop
  interactionRef.current.selectedEmployeeId = externalSelectedId ?? null;

  // ── Mark redraw needed when snapshot or selection changes ──
  const prevSnapshotRef = useRef(snapshot);
  const prevSelectedRef = useRef(externalSelectedId);
  if (prevSnapshotRef.current !== snapshot || prevSelectedRef.current !== externalSelectedId) {
    needsRedrawRef.current = true;
    prevSnapshotRef.current = snapshot;
    prevSelectedRef.current = externalSelectedId;
  }

  // ── Obtain 2D context on mount ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setHasCanvasContextError(true);
      return;
    }
    ctxRef.current = ctx;
    setHasCanvasContextError(false);
  }, []);

  // ── Compute fit viewport on mount ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    containerSizeRef.current = { width: rect.width, height: rect.height };
    viewportRef.current = computeFitViewport(rect.width, rect.height);
    needsRedrawRef.current = true;
  }, []);

  // ── ResizeObserver: update canvas resolution on container resize ──
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      if (!mountedRef.current) return;
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      viewportRef.current = preserveViewportOnResize(
        viewportRef.current,
        containerSizeRef.current.width,
        containerSizeRef.current.height,
        width,
        height,
      );
      containerSizeRef.current = { width, height };
      needsRedrawRef.current = true;
    });

    observer.observe(container);
    // Initial sizing
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    containerSizeRef.current = { width: rect.width, height: rect.height };

    return () => {
      observer.disconnect();
    };
  }, []);

  // ── rAF loop: check needsRedraw flag, call drawScene if set ──
  // Store latest snapshot/interaction in refs so the rAF callback reads current values
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    mountedRef.current = true;

    const loop = () => {
      if (!mountedRef.current) return;

      const hasAnimatedEmployees = snapshotRef.current.employees.some(
        (employee) => employee.isBlocked || employee.state === 'failed',
      );

      if (needsRedrawRef.current || hasAnimatedEmployees) {
        needsRedrawRef.current = false;
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) {
          const dpr = window.devicePixelRatio || 1;
          // Scale context for DPR
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawScene(
            ctx,
            snapshotRef.current,
            viewportRef.current,
            interactionRef.current,
            canvas.width / dpr,
            canvas.height / dpr,
            performance.now(),
          );
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ── Drag cancel helper ──
  const cancelDrag = useCallback(() => {
    dragPhaseRef.current = 'idle';
    dragEmployeeRef.current = null;
    interactionRef.current.drag = null;
    needsRedrawRef.current = true;
  }, []);

  const emitEmployeeSelected = useCallback(
    (employeeId: string) => {
      _onSelectEmployee?.(employeeId);
      eventBus.emit({
        type: 'scene.employee.selected',
        entityId: employeeId,
        entityType: 'employee',
        companyId,
        timestamp: Date.now(),
        payload: { employeeId, source: 'scene' },
      });
    },
    [_onSelectEmployee, companyId, eventBus],
  );

  const emitSceneDeselected = useCallback(() => {
    _onDeselectEmployee?.();
    eventBus.emit({
      type: 'ui.selection.changed',
      entityId: '',
      entityType: 'employee',
      companyId,
      timestamp: Date.now(),
      payload: { entityId: null, source: 'scene' },
    });
  }, [_onDeselectEmployee, companyId, eventBus]);

  // ── Wheel zoom handler ──
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      viewportRef.current = applyWheelZoom(viewportRef.current, e.deltaY, pointerX, pointerY);
      needsRedrawRef.current = true;
    },
    [],
  );

  // ── Pan handlers ──
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // Only left button

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const canvasPos = screenToCanvas(e.clientX, e.clientY, rect as DOMRect, viewportRef.current);
      const hit = hitMap.hitTest(canvasPos.x, canvasPos.y);

      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

      // If hit is an employee, enter pending drag state
      if (hit.type === 'employee') {
        const empData = employeeRenderData.find((emp) => emp.employeeId === hit.employeeId);
        if (empData) {
          const sourceZoneId =
            Array.from(zoneEmployees.entries()).find(([, emps]) =>
              emps.some((entry) => entry.empId === hit.employeeId),
            )?.[0] ?? '';

          dragPhaseRef.current = 'pending';
          dragEmployeeRef.current = {
            employeeId: empData.employeeId,
            name: empData.name,
            avatarImage: empData.avatarImage,
            statusColor: empData.statusColor,
            sourceZoneId,
          };
          dragStartScreenRef.current = { x: e.clientX, y: e.clientY };
        }
        setCursor('grab');
      } else {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setCursor('grabbing');
      }

      // Clear hover state
      if (interactionRef.current.hoveredEmployeeId !== null) {
        interactionRef.current.hoveredEmployeeId = null;
        needsRedrawRef.current = true;
      }
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [hitMap, employeeRenderData, zoneEmployees],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      // ── Active drag: update ghost position and hovered zone ──
      if (dragPhaseRef.current === 'active') {
        const canvasPos = screenToCanvas(e.clientX, e.clientY, rect as DOMRect, viewportRef.current);
        const zoneHit = hitMap.hitTestZone(canvasPos.x, canvasPos.y);
        const hoveredZoneId = zoneHit.type === 'zone' ? zoneHit.zoneId : null;
        const emp = dragEmployeeRef.current;
        if (emp) {
          interactionRef.current.drag = {
            ghostX: canvasPos.x,
            ghostY: canvasPos.y,
            ghostAvatarImage: emp.avatarImage,
            ghostName: emp.name,
            ghostStatusColor: emp.statusColor,
            sourceZoneId: emp.sourceZoneId,
            hoveredZoneId,
            dropTargetZoneIds,
          };
          needsRedrawRef.current = true;
        }
        setCursor('grabbing');
        return;
      }

      // ── Pending drag: check threshold ──
      if (dragPhaseRef.current === 'pending') {
        const dx = e.clientX - dragStartScreenRef.current.x;
        const dy = e.clientY - dragStartScreenRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= DRAG_THRESHOLD) {
          // Transition to active drag — stop panning
          dragPhaseRef.current = 'active';
          isPanningRef.current = false;
          const canvasPos = screenToCanvas(e.clientX, e.clientY, rect as DOMRect, viewportRef.current);
          const zoneHit = hitMap.hitTestZone(canvasPos.x, canvasPos.y);
          const hoveredZoneId = zoneHit.type === 'zone' ? zoneHit.zoneId : null;
          const emp = dragEmployeeRef.current;
          if (emp) {
            interactionRef.current.drag = {
              ghostX: canvasPos.x,
              ghostY: canvasPos.y,
              ghostAvatarImage: emp.avatarImage,
              ghostName: emp.name,
              ghostStatusColor: emp.statusColor,
              sourceZoneId: emp.sourceZoneId,
              hoveredZoneId,
              dropTargetZoneIds,
            };
            needsRedrawRef.current = true;
          }
          setCursor('grabbing');
          return;
        }
        // Still below threshold — fall through to pan handling
      }

      // ── Panning ──
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        viewportRef.current = applyPan(viewportRef.current, dx, dy);
        needsRedrawRef.current = true;
        return;
      }

      // ── Not panning or dragging — do hover hit testing ──
      const canvasPos = screenToCanvas(e.clientX, e.clientY, rect as DOMRect, viewportRef.current);
      const hit = hitMap.hitTest(canvasPos.x, canvasPos.y);

      const prevHovered = interactionRef.current.hoveredEmployeeId;
      const newHovered = hit.type === 'employee' ? hit.employeeId : null;

      if (prevHovered !== newHovered) {
        interactionRef.current.hoveredEmployeeId = newHovered;
        needsRedrawRef.current = true;
      }

      // Update cursor: grab on employee, default otherwise
      setCursor(newHovered ? 'grab' : 'default');
    },
    [hitMap, dropTargetZoneIds],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const wasPanning = isPanningRef.current;
      isPanningRef.current = false;
      const currentDragPhase = dragPhaseRef.current;
      const currentDragEmployee = dragEmployeeRef.current;

      const container = containerRef.current;
      // Compute hit results for cursor restoration, click, and drop handling
      let hit: ReturnType<typeof hitMap.hitTest> | null = null;
      let zoneHit: ReturnType<typeof hitMap.hitTestZone> | null = null;
      if (container) {
        const rect = container.getBoundingClientRect();
        const canvasPos = screenToCanvas(e.clientX, e.clientY, rect as DOMRect, viewportRef.current);
        hit = hitMap.hitTest(canvasPos.x, canvasPos.y);
        // Zone-only hit for drag drop (matches old SVG behavior)
        if (currentDragPhase === 'active') {
          zoneHit = hitMap.hitTestZone(canvasPos.x, canvasPos.y);
        }
      }

      // ── Active drag: handle drop ──
      if (currentDragPhase === 'active' && currentDragEmployee) {
        // Check if dropped on a valid target zone (different from source)
        // Use zone-only hit test to avoid employees blocking zone detection
        if (
          zoneHit?.type === 'zone' &&
          dropTargetZoneIds.includes(zoneHit.zoneId) &&
          zoneHit.zoneId !== currentDragEmployee.sourceZoneId
        ) {
          eventBus.emit({
            type: 'employee.workstation.drop-requested',
            entityId: currentDragEmployee.employeeId,
            entityType: 'employee',
            companyId,
            timestamp: Date.now(),
            payload: {
              employeeId: currentDragEmployee.employeeId,
              targetWorkstationId: zoneHit.zoneId,
            },
          });
        }
        // Cancel drag state regardless of drop validity
        cancelDrag();
        // Restore cursor
        setCursor(hit?.type === 'employee' ? 'grab' : 'default');
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        return;
      }

      // ── Pending drag (sub-threshold): treat as click ──
      if (currentDragPhase === 'pending' && currentDragEmployee) {
        dragPhaseRef.current = 'idle';
        dragEmployeeRef.current = null;
        emitEmployeeSelected(currentDragEmployee.employeeId);
        // Restore cursor
        setCursor(hit?.type === 'employee' ? 'grab' : 'default');
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        return;
      }

      // ── No drag — restore cursor and release capture ──
      setCursor(hit?.type === 'employee' ? 'grab' : 'default');
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);

      // Check if pointer movement was sub-threshold (click, not pan)
      if (!wasPanning) return;
      const dx = e.clientX - pointerDownPosRef.current.x;
      const dy = e.clientY - pointerDownPosRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= DRAG_THRESHOLD) return;
      if (!hit) return;

      // Sub-threshold movement → treat as click
      if (hit.type === 'employee') {
        emitEmployeeSelected(hit.employeeId);
      } else {
        emitSceneDeselected();
      }
    },
    [hitMap, dropTargetZoneIds, cancelDrag, emitEmployeeSelected, emitSceneDeselected],
  );

  // ── Attach wheel handler (needs { passive: false } to preventDefault) ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // ── Escape key: cancel active drag ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragPhaseRef.current !== 'idle') {
        cancelDrag();
        setCursor('default');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelDrag]);

  // ── Pointer leave: cancel active drag ──
  const handlePointerLeave = useCallback(() => {
    if (dragPhaseRef.current !== 'idle') {
      cancelDrag();
      setCursor('default');
    }
    isPanningRef.current = false;
  }, [cancelDrag]);

  // ── Render ──
  if (hasCanvasContextError) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#020617] text-white">
        <div className="text-center p-4">
          <p className="text-sm text-red-400">Canvas Error</p>
          <p className="text-xs text-gray-400 mt-1">
            Unable to obtain 2D rendering context. Your browser may not support Canvas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-[#020617] overflow-hidden select-none relative"
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        role="img"
        aria-label="2D office layout"
      />
      {/* Screen-reader accessible overlay: focusable employee nodes for keyboard navigation */}
      <div
        aria-label="Office employees"
        role="group"
        className="sr-only"
      >
        {employeeRenderData.map((emp) => (
          <button
            key={emp.employeeId}
            type="button"
            aria-label={`${emp.name} employee node`}
            aria-pressed={externalSelectedId === emp.employeeId}
            onClick={() => emitEmployeeSelected(emp.employeeId)}
          >
            {emp.name}
          </button>
        ))}
        <button
          type="button"
          aria-label="Deselect office scene"
          onClick={emitSceneDeselected}
        >
          Deselect
        </button>
      </div>
    </div>
  );
}

/**
 * Drag-to-assign hook for the 2D office view.
 * Encapsulates the drag state machine: threshold detection, ghost tracking,
 * drop target hit-testing, and event emission on successful drop.
 *
 * Returns handler functions that return `true` when they consumed the event,
 * so Office2DView can fall through to pan/zoom when drag is inactive.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAG_THRESHOLD, type ZoneSvgBound, hitTestZone } from './office-2d-geometry';

// ── Drag State ────────────────────────────────────────────────────────

export interface DragState {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  sourceZoneId: string;
  avatarSeed: string;
  statusColor: string;
  startScreenX: number;
  startScreenY: number;
  currentSvgX: number;
  currentSvgY: number;
  /** Whether the drag threshold has been exceeded (true drag vs potential click). */
  active: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────

export interface UseOffice2DDragOptions {
  /** Convert screen coords → SVG coords. Provided by the view. */
  screenToSvg: (clientX: number, clientY: number) => { x: number; y: number };
  /** Pre-computed zone bounding boxes in SVG space. */
  zoneSvgBounds: ReadonlyArray<ZoneSvgBound>;
  // biome-ignore lint/suspicious/noExplicitAny: matches EventBus.emit(RuntimeEvent<any>) signature — using `unknown` breaks contravariance
  eventBus: { emit: (event: any) => void };
  companyId: string;
  /** Called when a drag didn't exceed threshold — treat as click. */
  onEmployeeClick: (employeeId: string) => void;
}

export interface UseOffice2DDragResult {
  dragState: DragState | null;
  isDragging: boolean;
  hoveredZoneId: string | null;
  /** Call from EmployeeNode onPointerDown to begin a potential drag. */
  startDrag: (
    employeeId: string,
    employeeName: string,
    employeeRole: string,
    sourceZoneId: string,
    avatarSeed: string,
    statusColor: string,
    e: React.PointerEvent,
  ) => void;
  /** Feed pointer-move events. Returns true if consumed (drag active). */
  onPointerMove: (e: React.PointerEvent) => boolean;
  /** Feed pointer-up events. Returns true if consumed (drag active). */
  onPointerUp: (e: React.PointerEvent) => boolean;
  /** Cancel any in-progress drag (e.g. pointer leave, Escape). */
  cancelDrag: () => void;
}

export function useOffice2DDrag({
  screenToSvg,
  zoneSvgBounds,
  eventBus,
  companyId,
  onEmployeeClick,
}: UseOffice2DDragOptions): UseOffice2DDragResult {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);

  const isDragging = dragState?.active ?? false;

  // Ref to read current dragState inside stable callbacks without re-creating them.
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  // Cancel on Escape — only bind/unbind when drag starts/ends, not every move.
  const hasDrag = dragState !== null;
  useEffect(() => {
    if (!hasDrag) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDragState(null);
        setHoveredZoneId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasDrag]);

  const startDrag = useCallback(
    (
      employeeId: string,
      employeeName: string,
      employeeRole: string,
      sourceZoneId: string,
      avatarSeed: string,
      statusColor: string,
      e: React.PointerEvent,
    ) => {
      if (e.button !== 0) return;
      const svgPos = screenToSvg(e.clientX, e.clientY);
      setDragState({
        employeeId,
        employeeName,
        employeeRole,
        sourceZoneId,
        avatarSeed,
        statusColor,
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        currentSvgX: svgPos.x,
        currentSvgY: svgPos.y,
        active: false,
      });
    },
    [screenToSvg],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent): boolean => {
      if (!dragStateRef.current) return false;

      const svgPos = screenToSvg(e.clientX, e.clientY);

      setDragState((prev) => {
        if (!prev) return null;
        const dx = e.clientX - prev.startScreenX;
        const dy = e.clientY - prev.startScreenY;
        const active = prev.active || Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD;
        return { ...prev, currentSvgX: svgPos.x, currentSvgY: svgPos.y, active };
      });

      const hitZone = hitTestZone(svgPos.x, svgPos.y, zoneSvgBounds);
      setHoveredZoneId(hitZone?.zoneId ?? null);
      return true;
    },
    [screenToSvg, zoneSvgBounds],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent): boolean => {
      const current = dragStateRef.current;
      if (!current) return false;

      if (current.active) {
        const svgPos = screenToSvg(e.clientX, e.clientY);
        const targetZone = hitTestZone(svgPos.x, svgPos.y, zoneSvgBounds);

        if (targetZone && targetZone.zoneId !== current.sourceZoneId) {
          eventBus.emit({
            type: 'employee.workstation.drop-requested',
            entityId: current.employeeId,
            entityType: 'employee',
            companyId,
            timestamp: Date.now(),
            payload: {
              employeeId: current.employeeId,
              targetWorkstationId: targetZone.zoneId,
            },
          });
        }
      } else {
        // Didn't exceed threshold — treat as click
        onEmployeeClick(current.employeeId);
      }

      setDragState(null);
      setHoveredZoneId(null);
      return true;
    },
    [screenToSvg, zoneSvgBounds, eventBus, companyId, onEmployeeClick],
  );

  const cancelDrag = useCallback(() => {
    setDragState(null);
    setHoveredZoneId(null);
  }, []);

  return { dragState, isDragging, hoveredZoneId, startDrag, onPointerMove, onPointerUp, cancelDrag };
}

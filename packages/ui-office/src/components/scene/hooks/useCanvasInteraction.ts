import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import {
  DRAG_THRESHOLD,
  type ViewportTransform,
  screenToCanvas,
} from '../office-2d-canvas-geometry';
import type { EmployeeRenderData, InteractionState } from '../office-2d-canvas-renderer';
import {
  recordCancellation,
  recordPointerDown as recordDiagnosticDown,
  recordPointerMoveActive as recordDiagnosticMove,
  recordPointerUp as recordDiagnosticUp,
} from '../office-2d-drop-diagnostic';
import type { SceneHitMap } from '../office-2d-hitmap';

function genAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type Cursor = 'default' | 'grab' | 'grabbing';

type DragPhase = 'idle' | 'pending' | 'active';

interface DragEmployee {
  employeeId: string;
  name: string;
  avatarImage: HTMLImageElement | ImageBitmap | null;
  statusColor: string;
  sourceZoneId: string;
}

interface Params {
  containerRef: RefObject<HTMLDivElement | null>;
  viewportRef: MutableRefObject<ViewportTransform>;
  interactionRef: MutableRefObject<InteractionState>;
  needsRedrawRef: MutableRefObject<boolean>;
  panBy: (dx: number, dy: number) => void;
  hitMap: SceneHitMap;
  employeeRenderData: ReadonlyArray<EmployeeRenderData>;
  zoneEmployees: ReadonlyMap<string, ReadonlyArray<{ empId: string }>>;
  dropTargetZoneIds: string[];
  onEmployeeClick: (employeeId: string) => void;
  onSceneDeselect: () => void;
  onDropOnZone: (employeeId: string, zoneId: string) => void;
}

interface Handlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
}

interface Returns {
  cursor: Cursor;
  handlers: Handlers;
}

export function useCanvasInteraction(params: Params): Returns {
  const {
    containerRef,
    viewportRef,
    interactionRef,
    needsRedrawRef,
    panBy,
    hitMap,
    employeeRenderData,
    zoneEmployees,
    dropTargetZoneIds,
    onEmployeeClick,
    onSceneDeselect,
    onDropOnZone,
  } = params;

  const [cursor, setCursor] = useState<Cursor>('default');
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragPhaseRef = useRef<DragPhase>('idle');
  const dragEmployeeRef = useRef<DragEmployee | null>(null);
  const dragStartScreenRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const attemptIdRef = useRef<string | null>(null);

  const cancelDrag = useCallback(() => {
    dragPhaseRef.current = 'idle';
    dragEmployeeRef.current = null;
    interactionRef.current.drag = null;
    needsRedrawRef.current = true;
  }, [interactionRef, needsRedrawRef]);

  const writeDragGhost = useCallback(
    (canvasX: number, canvasY: number, hoveredZoneId: string | null) => {
      const emp = dragEmployeeRef.current;
      if (!emp) return;
      interactionRef.current.drag = {
        ghostX: canvasX,
        ghostY: canvasY,
        ghostAvatarImage: emp.avatarImage,
        ghostName: emp.name,
        ghostStatusColor: emp.statusColor,
        sourceZoneId: emp.sourceZoneId,
        hoveredZoneId,
        dropTargetZoneIds,
      };
      needsRedrawRef.current = true;
    },
    [dropTargetZoneIds, interactionRef, needsRedrawRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const canvasPos = screenToCanvas(e.clientX, e.clientY, rect as DOMRect, viewportRef.current);
      const hit = hitMap.hitTest(canvasPos.x, canvasPos.y);
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

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
          const attemptId = genAttemptId();
          attemptIdRef.current = attemptId;
          recordDiagnosticDown(
            attemptId,
            e,
            canvasPos.x,
            canvasPos.y,
            empData.employeeId,
            sourceZoneId,
            dropTargetZoneIds,
          );
        }
        setCursor('grab');
      } else {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        setCursor('grabbing');
      }

      if (interactionRef.current.hoveredEmployeeId !== null) {
        interactionRef.current.hoveredEmployeeId = null;
        needsRedrawRef.current = true;
      }
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [
      containerRef,
      employeeRenderData,
      hitMap,
      interactionRef,
      needsRedrawRef,
      viewportRef,
      zoneEmployees,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      if (dragPhaseRef.current === 'active') {
        const canvasPos = screenToCanvas(
          e.clientX,
          e.clientY,
          rect as DOMRect,
          viewportRef.current,
        );
        const zoneHit = hitMap.hitTestZone(canvasPos.x, canvasPos.y);
        writeDragGhost(canvasPos.x, canvasPos.y, zoneHit.type === 'zone' ? zoneHit.zoneId : null);
        if (attemptIdRef.current) {
          recordDiagnosticMove(attemptIdRef.current, e, canvasPos.x, canvasPos.y);
        }
        setCursor('grabbing');
        return;
      }

      if (dragPhaseRef.current === 'pending') {
        const dx = e.clientX - dragStartScreenRef.current.x;
        const dy = e.clientY - dragStartScreenRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
          dragPhaseRef.current = 'active';
          isPanningRef.current = false;
          const canvasPos = screenToCanvas(
            e.clientX,
            e.clientY,
            rect as DOMRect,
            viewportRef.current,
          );
          const zoneHit = hitMap.hitTestZone(canvasPos.x, canvasPos.y);
          writeDragGhost(canvasPos.x, canvasPos.y, zoneHit.type === 'zone' ? zoneHit.zoneId : null);
          setCursor('grabbing');
          return;
        }
      }

      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panBy(dx, dy);
        return;
      }

      const canvasPos = screenToCanvas(e.clientX, e.clientY, rect as DOMRect, viewportRef.current);
      const hit = hitMap.hitTest(canvasPos.x, canvasPos.y);
      const prevHovered = interactionRef.current.hoveredEmployeeId;
      const newHovered = hit.type === 'employee' ? hit.employeeId : null;
      if (prevHovered !== newHovered) {
        interactionRef.current.hoveredEmployeeId = newHovered;
        needsRedrawRef.current = true;
      }
      setCursor(newHovered ? 'grab' : 'default');
    },
    [containerRef, hitMap, interactionRef, needsRedrawRef, panBy, viewportRef, writeDragGhost],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const wasPanning = isPanningRef.current;
      isPanningRef.current = false;
      const phase = dragPhaseRef.current;
      const dragEmployee = dragEmployeeRef.current;

      const container = containerRef.current;
      let hit: ReturnType<SceneHitMap['hitTest']> | null = null;
      let zoneHit: ReturnType<SceneHitMap['hitTestZone']> | null = null;
      let canvasPosForDiag: { x: number; y: number } | null = null;
      if (container) {
        const rect = container.getBoundingClientRect();
        const canvasPos = screenToCanvas(
          e.clientX,
          e.clientY,
          rect as DOMRect,
          viewportRef.current,
        );
        canvasPosForDiag = canvasPos;
        hit = hitMap.hitTest(canvasPos.x, canvasPos.y);
        if (phase === 'active') zoneHit = hitMap.hitTestZone(canvasPos.x, canvasPos.y);
      }

      if (phase === 'active' && dragEmployee) {
        const hitZone = zoneHit?.type === 'zone' ? zoneHit.zoneId : null;
        const isDroppable = hitZone !== null && dropTargetZoneIds.includes(hitZone);
        const isDifferentZone = hitZone !== null && hitZone !== dragEmployee.sourceZoneId;
        const willEmit = hitZone !== null && isDroppable && isDifferentZone;
        if (willEmit && hitZone) {
          onDropOnZone(dragEmployee.employeeId, hitZone);
        }
        const outcome: import('../office-2d-drop-diagnostic').DropAttemptOutcome = willEmit
          ? 'drop-emitted'
          : hitZone === null
            ? 'drop-suppressed-empty'
            : !isDroppable
              ? 'drop-suppressed-not-droppable'
              : 'drop-suppressed-source-zone';
        if (attemptIdRef.current) {
          recordDiagnosticUp(
            attemptIdRef.current,
            e,
            canvasPosForDiag?.x ?? null,
            canvasPosForDiag?.y ?? null,
            zoneHit ?? hit,
            dropTargetZoneIds,
            outcome,
            willEmit,
          );
          attemptIdRef.current = null;
        }
        cancelDrag();
        setCursor(hit?.type === 'employee' ? 'grab' : 'default');
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        return;
      }

      if (phase === 'pending' && dragEmployee) {
        dragPhaseRef.current = 'idle';
        dragEmployeeRef.current = null;
        if (attemptIdRef.current) {
          recordDiagnosticUp(
            attemptIdRef.current,
            e,
            canvasPosForDiag?.x ?? null,
            canvasPosForDiag?.y ?? null,
            hit,
            dropTargetZoneIds,
            'click',
            false,
          );
          attemptIdRef.current = null;
        }
        onEmployeeClick(dragEmployee.employeeId);
        setCursor(hit?.type === 'employee' ? 'grab' : 'default');
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        return;
      }

      setCursor(hit?.type === 'employee' ? 'grab' : 'default');
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);

      if (!wasPanning) return;
      const dx = e.clientX - pointerDownPosRef.current.x;
      const dy = e.clientY - pointerDownPosRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) return;
      if (!hit) return;
      if (hit.type === 'employee') onEmployeeClick(hit.employeeId);
      else onSceneDeselect();
    },
    [
      cancelDrag,
      containerRef,
      dropTargetZoneIds,
      hitMap,
      onDropOnZone,
      onEmployeeClick,
      onSceneDeselect,
      viewportRef,
    ],
  );

  const onPointerLeave = useCallback(() => {
    if (dragPhaseRef.current !== 'idle') {
      if (attemptIdRef.current) {
        recordCancellation(attemptIdRef.current, 'leave');
        attemptIdRef.current = null;
      }
      cancelDrag();
      setCursor('default');
    }
    isPanningRef.current = false;
  }, [cancelDrag]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragPhaseRef.current !== 'idle') {
        if (attemptIdRef.current) {
          recordCancellation(attemptIdRef.current, 'escape');
          attemptIdRef.current = null;
        }
        cancelDrag();
        setCursor('default');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelDrag]);

  return {
    cursor,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerLeave },
  };
}

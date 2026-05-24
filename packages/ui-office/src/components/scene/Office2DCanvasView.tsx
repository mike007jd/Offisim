/**
 * Office2DCanvasView — HTML5 Canvas-based 2D office top-down view.
 *
 * Thin composition barrel. Drawing work lives in `./canvas-layers/*.ts`
 * and runtime wiring lives in `./hooks/useCanvas*.ts`. This file only:
 *   - pulls scene data via `useSceneSnapshot`
 *   - mounts refs + obtains the 2D context
 *   - wires the 3 view hooks (viewport / redraw / interaction)
 *   - emits selection / deselect / drop-requested events
 *   - renders the <canvas> + a screen-reader accessible overlay
 */
import { Button } from '@offisim/ui-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator';
import type { EmployeePerformanceCueMap } from '../../runtime/employee-performance-cues.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
import { useSceneColors } from '../../theme/use-scene-colors.js';
import { useCompany } from '../company/CompanyContext.js';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useCanvasRedrawLoop } from './hooks/useCanvasRedrawLoop';
import { useCanvasViewport } from './hooks/useCanvasViewport';
import type { InteractionState } from './office-2d-canvas-renderer';
import { useSceneSnapshot } from './use-scene-snapshot';

interface Office2DCanvasViewProps {
  ceremony: CeremonyState;
  employeePerformanceCues: EmployeePerformanceCueMap;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

export default function Office2DCanvasView({
  ceremony,
  employeePerformanceCues,
  selectedEmployeeId: externalSelectedId = null,
  onSelectEmployee,
  onDeselectEmployee,
}: Office2DCanvasViewProps) {
  const { activeCompanyId } = useCompany();
  const { eventBus } = useOffisimRuntimeServices();
  const sceneColors = useSceneColors();
  const companyId = activeCompanyId ?? '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const needsRedrawRef = useRef(true);
  const interactionRef = useRef<InteractionState>({
    selectedEmployeeId: null,
    hoveredEmployeeId: null,
    drag: null,
  });
  const [hasCanvasContextError, setHasCanvasContextError] = useState(false);

  const { sceneData, hitMap, dropTargetZoneIds, employeeRenderData, zoneEmployees } =
    useSceneSnapshot({ ceremony, employeePerformanceCues, needsRedrawRef });

  // Keep interactionRef.selectedEmployeeId in sync with the controlled prop
  // and request a redraw when selection changes.
  useEffect(() => {
    const next = externalSelectedId ?? null;
    if (interactionRef.current.selectedEmployeeId !== next) {
      interactionRef.current.selectedEmployeeId = next;
      needsRedrawRef.current = true;
    }
  }, [externalSelectedId]);

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

  const { viewportRef, panBy } = useCanvasViewport({ containerRef, canvasRef, needsRedrawRef });

  useCanvasRedrawLoop({
    canvasRef,
    ctxRef,
    sceneData,
    viewportRef,
    interactionRef,
    needsRedrawRef,
  });

  const emitEmployeeSelected = useCallback(
    (employeeId: string) => {
      onSelectEmployee?.(employeeId);
      eventBus.emit({
        type: 'scene.employee.selected',
        entityId: employeeId,
        entityType: 'employee',
        companyId,
        timestamp: Date.now(),
        payload: { employeeId, source: 'scene' },
      });
    },
    [onSelectEmployee, companyId, eventBus],
  );

  const emitSceneDeselected = useCallback(() => {
    onDeselectEmployee?.();
    eventBus.emit({
      type: 'ui.selection.changed',
      entityId: '',
      entityType: 'employee',
      companyId,
      timestamp: Date.now(),
      payload: { entityId: null, source: 'scene' },
    });
  }, [onDeselectEmployee, companyId, eventBus]);

  const emitDropOnZone = useCallback(
    (employeeId: string, zoneId: string) => {
      eventBus.emit({
        type: 'employee.workstation.drop-requested',
        entityId: employeeId,
        entityType: 'employee',
        companyId,
        timestamp: Date.now(),
        payload: { employeeId, targetWorkstationId: zoneId },
      });
    },
    [companyId, eventBus],
  );

  const { cursor, handlers } = useCanvasInteraction({
    containerRef,
    viewportRef,
    interactionRef,
    needsRedrawRef,
    panBy,
    hitMap,
    employeeRenderData,
    zoneEmployees,
    dropTargetZoneIds,
    onEmployeeClick: emitEmployeeSelected,
    onSceneDeselect: emitSceneDeselected,
    onDropOnZone: emitDropOnZone,
  });

  if (hasCanvasContextError) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-ink-1"
        style={{ backgroundColor: sceneColors.canvasBackground }}
      >
        <div className="p-4 text-center">
          <p className="text-fs-sm text-danger">Canvas Error</p>
          <p className="mt-1 text-fs-meta text-ink-4">
            Unable to obtain 2D rendering context. Your browser may not support Canvas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden select-none relative"
      style={{ cursor, backgroundColor: sceneColors.canvasBackground }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerLeave={handlers.onPointerLeave}
    >
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        role="img"
        aria-label="2D office layout"
      />
      <div aria-label="Office employees" className="sr-only">
        {employeeRenderData.map((emp) => (
          <Button
            key={emp.employeeId}
            type="button"
            aria-label={`${emp.name} employee node`}
            aria-pressed={externalSelectedId === emp.employeeId}
            onClick={() => emitEmployeeSelected(emp.employeeId)}
          >
            {emp.name}
          </Button>
        ))}
        <Button type="button" aria-label="Deselect office scene" onClick={emitSceneDeselected}>
          Deselect
        </Button>
      </div>
    </div>
  );
}

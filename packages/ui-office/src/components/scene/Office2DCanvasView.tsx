// raw-hex-allowed-file: asset renderer palette; non-design-token content colors.
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
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';
import { useCanvasInteraction } from './hooks/useCanvasInteraction';
import { useCanvasRedrawLoop } from './hooks/useCanvasRedrawLoop';
import { useCanvasViewport } from './hooks/useCanvasViewport';
import type { InteractionState } from './office-2d-canvas-renderer';
import { useSceneSnapshot } from './use-scene-snapshot';

interface Office2DCanvasViewProps {
  ceremony: CeremonyState;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

export default function Office2DCanvasView({
  ceremony,
  selectedEmployeeId: externalSelectedId = null,
  onSelectEmployee,
  onDeselectEmployee,
}: Office2DCanvasViewProps) {
  const { activeCompanyId } = useCompany();
  const { eventBus } = useOffisimRuntime();
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
    useSceneSnapshot({ ceremony, needsRedrawRef });

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
        <button type="button" aria-label="Deselect office scene" onClick={emitSceneDeselected}>
          Deselect
        </button>
      </div>
    </div>
  );
}

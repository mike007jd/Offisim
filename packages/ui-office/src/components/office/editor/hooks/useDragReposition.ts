import type { ZonePreset } from '@offisim/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../../../studio/StudioState.js';
import type { DragState, EditorZone } from '../types.js';
import { SCALE, SVG_H, SVG_W, fromSVG } from '../types.js';

export interface UseDragRepositionParams {
  placingPreset: ZonePreset | null;
  editorZones: EditorZone[];
  zoomRef: React.RefObject<number>;
  panXRef: React.RefObject<number>;
  panYRef: React.RefObject<number>;
  setSelectedZoneId: React.Dispatch<React.SetStateAction<string | null>>;
  setDirty: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface UseDragRepositionReturn {
  svgRef: React.RefObject<SVGSVGElement | null>;
  drag: DragState | null;
  ghostPos: { x: number; y: number } | null;
  handleCanvasPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  handleCanvasMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  handleCanvasPointerUp: () => void;
  handleCanvasMouseLeave: () => void;
  handleZonePointerDown: (zoneId: string, e: React.PointerEvent) => void;
}

export function useDragReposition({
  placingPreset,
  editorZones,
  zoomRef,
  panXRef,
  panYRef,
  setSelectedZoneId,
  setDirty,
}: UseDragRepositionParams): UseDragRepositionReturn {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const editorZonesRef = useRef<EditorZone[]>(editorZones);
  useEffect(() => {
    editorZonesRef.current = editorZones;
  }, [editorZones]);

  const svgCoords = useCallback(
    (e: React.MouseEvent): { svgX: number; svgY: number } => {
      if (!svgRef.current) return { svgX: 0, svgY: 0 };
      const rect = svgRef.current.getBoundingClientRect();
      return {
        svgX: panXRef.current + ((e.clientX - rect.left) / rect.width) * (SVG_W / zoomRef.current),
        svgY: panYRef.current + ((e.clientY - rect.top) / rect.height) * (SVG_H / zoomRef.current),
      };
    },
    [panXRef, panYRef, zoomRef],
  );

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (drag) return;
      if (!placingPreset) {
        setSelectedZoneId(null);
        return;
      }
      const { svgX, svgY } = svgCoords(e);
      const { wx, wz } = fromSVG(svgX, svgY);
      const snappedPosition = [Math.round(wx * 2) / 2, 0, Math.round(wz * 2) / 2] as [
        number,
        number,
        number,
      ];
      useStudioStore.getState().addZoneFromPreset(placingPreset, snappedPosition);
      setDirty(true);
    },
    [drag, placingPreset, svgCoords, setSelectedZoneId, setDirty],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (drag) {
        const { svgX, svgY } = svgCoords(e);
        const newCx = Math.round((drag.startCx + (svgX - drag.startMouseX) / SCALE) * 2) / 2;
        const newCz = Math.round((drag.startCz + (svgY - drag.startMouseY) / SCALE) * 2) / 2;
        useStudioStore.getState().updateZonePosition(drag.zoneId, newCx, newCz);
        setDirty(true);
        return;
      }
      if (!placingPreset) {
        setGhostPos(null);
        return;
      }
      const { svgX, svgY } = svgCoords(e);
      setGhostPos({ x: svgX, y: svgY });
    },
    [drag, placingPreset, svgCoords, setDirty],
  );

  const handleZonePointerDown = useCallback(
    (zoneId: string, e: React.PointerEvent) => {
      if (placingPreset) return;
      e.stopPropagation();
      const { svgX, svgY } = svgCoords(e);
      const zone = editorZonesRef.current.find((z) => z.id === zoneId);
      if (!zone) return;
      setSelectedZoneId(zoneId);
      setDrag({
        zoneId,
        startMouseX: svgX,
        startMouseY: svgY,
        startCx: zone.cx,
        startCz: zone.cz,
        startItemPositions: new Map(),
      });
    },
    [placingPreset, svgCoords, setSelectedZoneId],
  );

  const handleCanvasPointerUp = useCallback(() => {
    if (drag) setDrag(null);
  }, [drag]);

  const handleCanvasMouseLeave = useCallback(() => {
    setGhostPos(null);
    if (drag) setDrag(null);
  }, [drag]);

  return {
    svgRef,
    drag,
    ghostPos,
    handleCanvasPointerDown,
    handleCanvasMouseMove,
    handleCanvasPointerUp,
    handleCanvasMouseLeave,
    handleZonePointerDown,
  };
}

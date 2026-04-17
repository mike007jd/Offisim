import type { ZonePreset } from '@offisim/shared-types';
import { computeOverlapMap, findOverlaps } from '@offisim/shared-types';
import { useEffect, useMemo, useRef } from 'react';
import type { DragState, EditorZone } from '../types.js';
import { fromSVG } from '../types.js';

export interface UseZoneValidationParams {
  editorZones: EditorZone[];
  drag: DragState | null;
  placingPreset: ZonePreset | null;
  ghostPos: { x: number; y: number } | null;
}

export interface UseZoneValidationReturn {
  overlapMap: Map<string, string[]>;
  ghostOverlaps: string[];
}

export function useZoneValidation({
  editorZones,
  drag,
  placingPreset,
  ghostPos,
}: UseZoneValidationParams): UseZoneValidationReturn {
  const lastOverlapMap = useRef<Map<string, string[]>>(new Map());

  const overlapMap = useMemo(() => {
    if (drag) return lastOverlapMap.current;
    const result = computeOverlapMap(editorZones);
    lastOverlapMap.current = result;
    return result;
  }, [editorZones, drag]);

  const editorZonesRef = useRef<EditorZone[]>(editorZones);
  useEffect(() => {
    editorZonesRef.current = editorZones;
  }, [editorZones]);

  const ghostOverlaps = useMemo(() => {
    if (!placingPreset || !ghostPos) return [];
    const { wx, wz } = fromSVG(ghostPos.x, ghostPos.y);
    const candidate = {
      id: '__ghost__',
      cx: Math.round(wx * 2) / 2,
      cz: Math.round(wz * 2) / 2,
      w: placingPreset.w,
      d: placingPreset.d,
    };
    return findOverlaps(candidate, editorZonesRef.current).map((z) => z.label);
  }, [placingPreset, ghostPos]);

  return { overlapMap, ghostOverlaps };
}

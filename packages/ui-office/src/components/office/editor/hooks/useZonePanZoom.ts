import { useCallback, useEffect, useRef, useState } from 'react';
import { SVG_H, SVG_W } from '../types.js';

export interface UseZonePanZoomReturn {
  zoom: number;
  panX: number;
  panY: number;
  viewBox: string;
  zoomRef: React.RefObject<number>;
  panXRef: React.RefObject<number>;
  panYRef: React.RefObject<number>;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleZoomFit: () => void;
  handleWheel: (e: React.WheelEvent) => void;
}

export function useZonePanZoom(open: boolean): UseZonePanZoomReturn {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const zoomRef = useRef(zoom);
  const panXRef = useRef(panX);
  const panYRef = useRef(panY);

  useEffect(() => {
    zoomRef.current = zoom;
    panXRef.current = panX;
    panYRef.current = panY;
  }, [zoom, panX, panY]);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, [open]);

  const viewBox = `${panX} ${panY} ${SVG_W / zoom} ${SVG_H / zoom}`;

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.3, Math.min(4, prev * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(4, z * 1.2)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(0.3, z / 1.2)), []);
  const handleZoomFit = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  return {
    zoom,
    panX,
    panY,
    viewBox,
    zoomRef,
    panXRef,
    panYRef,
    handleZoomIn,
    handleZoomOut,
    handleZoomFit,
    handleWheel,
  };
}

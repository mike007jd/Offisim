import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import {
  type ViewportTransform,
  applyPan,
  applyWheelZoom,
  computeFitViewport,
  preserveViewportOnResize,
} from '../office-2d-canvas-geometry';

interface Params {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  needsRedrawRef: MutableRefObject<boolean>;
}

interface Returns {
  viewportRef: MutableRefObject<ViewportTransform>;
  panBy: (dx: number, dy: number) => void;
}

/**
 * Owns pan / zoom / transform matrix for the 2D canvas. Attaches the
 * ResizeObserver that sizes the canvas (dpr-aware) and the wheel handler
 * that zooms toward the pointer. Returns the live viewport ref and a
 * `panBy` helper for interaction handlers.
 */
export function useCanvasViewport({ containerRef, canvasRef, needsRedrawRef }: Params): Returns {
  const viewportRef = useRef<ViewportTransform>({ x: 0, y: 0, scale: 1 });
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const hasInitialSizedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      if (!mountedRef.current) return;
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      if (!hasInitialSizedRef.current) {
        viewportRef.current = computeFitViewport(width, height);
        hasInitialSizedRef.current = true;
      } else {
        viewportRef.current = preserveViewportOnResize(
          viewportRef.current,
          containerSizeRef.current.width,
          containerSizeRef.current.height,
          width,
          height,
        );
      }
      containerSizeRef.current = { width, height };
      needsRedrawRef.current = true;
    });

    observer.observe(container);
    return () => {
      mountedRef.current = false;
      observer.disconnect();
    };
  }, [containerRef, canvasRef, needsRedrawRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      viewportRef.current = applyWheelZoom(
        viewportRef.current,
        e.deltaY,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      needsRedrawRef.current = true;
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef, needsRedrawRef]);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      viewportRef.current = applyPan(viewportRef.current, dx, dy);
      needsRedrawRef.current = true;
    },
    [needsRedrawRef],
  );

  return { viewportRef, panBy };
}

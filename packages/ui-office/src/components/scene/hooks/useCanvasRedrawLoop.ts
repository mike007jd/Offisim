import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { ViewportTransform } from '../office-2d-canvas-geometry';
import { type InteractionState, type SceneSnapshot, drawScene } from '../office-2d-canvas-renderer';

export type SceneFrameData = Omit<SceneSnapshot, 'interaction' | 'animationTime' | 'canvasSize'>;

interface Params {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  ctxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  sceneDataRef: MutableRefObject<SceneFrameData>;
  viewportRef: MutableRefObject<ViewportTransform>;
  interactionRef: MutableRefObject<InteractionState>;
  needsRedrawRef: MutableRefObject<boolean>;
}

/**
 * Owns the single rAF loop that drives canvas redraws. Invokes `drawScene`
 * when `needsRedrawRef` is set, or continuously while blocked/failed
 * employees are on screen (their pulse animation needs per-frame updates).
 */
export function useCanvasRedrawLoop({
  canvasRef,
  ctxRef,
  sceneDataRef,
  viewportRef,
  interactionRef,
  needsRedrawRef,
}: Params): void {
  const mountedRef = useRef(true);
  const rafIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;

    const loop = () => {
      if (!mountedRef.current) return;

      const scene = sceneDataRef.current;
      const hasAnimated = scene.employees.some(
        (employee) => employee.isBlocked || employee.state === 'failed',
      );

      if (needsRedrawRef.current || hasAnimated) {
        const ctx = ctxRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas && canvas.width > 0 && canvas.height > 0) {
          needsRedrawRef.current = false;
          const dpr = window.devicePixelRatio || 1;
          const snapshot: SceneSnapshot = {
            ...scene,
            interaction: interactionRef.current,
            animationTime: performance.now(),
            canvasSize: {
              width: canvas.width / dpr,
              height: canvas.height / dpr,
              devicePixelRatio: dpr,
            },
          };
          drawScene(ctx, snapshot, viewportRef.current);
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [canvasRef, ctxRef, sceneDataRef, viewportRef, interactionRef, needsRedrawRef]);
}

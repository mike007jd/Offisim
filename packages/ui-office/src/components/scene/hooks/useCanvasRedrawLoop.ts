import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { ViewportTransform } from '../office-2d-canvas-geometry';
import {
  type FrameContext,
  type InteractionState,
  type SceneSnapshot,
  drawScene,
} from '../office-2d-canvas-renderer';

interface Params {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  ctxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  sceneData: SceneSnapshot;
  viewportRef: MutableRefObject<ViewportTransform>;
  interactionRef: MutableRefObject<InteractionState>;
  needsRedrawRef: MutableRefObject<boolean>;
}

/**
 * Owns the single rAF loop that drives canvas redraws. Takes `sceneData` as
 * a regular value — the hook mirrors it into a ref via `useEffect` so the
 * rAF callback always reads the latest snapshot without capturing stale
 * closures. Invokes `drawScene` when `needsRedrawRef` is set, or every
 * frame while blocked/failed employees need their pulse animation.
 */
export function useCanvasRedrawLoop({
  canvasRef,
  ctxRef,
  sceneData,
  viewportRef,
  interactionRef,
  needsRedrawRef,
}: Params): void {
  const sceneDataRef = useRef<SceneSnapshot>(sceneData);

  useEffect(() => {
    sceneDataRef.current = sceneData;
    needsRedrawRef.current = true;
  }, [sceneData, needsRedrawRef]);

  useEffect(() => {
    let mounted = true;
    let rafId = 0;

    const loop = () => {
      if (!mounted) return;
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
          const frame: FrameContext = {
            interaction: interactionRef.current,
            animationTime: performance.now(),
            canvasSize: {
              width: canvas.width / dpr,
              height: canvas.height / dpr,
              devicePixelRatio: dpr,
            },
            transform: viewportRef.current,
          };
          drawScene(ctx, scene, frame);
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafId);
    };
  }, [canvasRef, ctxRef, interactionRef, needsRedrawRef, viewportRef]);
}

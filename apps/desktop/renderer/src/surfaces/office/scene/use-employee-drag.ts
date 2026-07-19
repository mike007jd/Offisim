import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type ScenePlacementPoint, groundPointFromClient } from './scene-ground.js';
import type { ZoneDef } from './scene-layout.js';

export interface SceneEmployeeDrop {
  readonly zoneId: string | null;
  readonly x: number | null;
  readonly z: number | null;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly moved: boolean;
}

export interface SceneEmployeeDrag {
  readonly employeeId: string;
  readonly x: number;
  readonly z: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly moved: boolean;
}

export function useEmployeeDrag({
  employeeId,
  x,
  z,
  zones,
  onHoverZone,
  onDrop,
  onDragState,
}: {
  employeeId: string;
  x: number;
  z: number;
  zones: ZoneDef[];
  onHoverZone: (zoneId: string | null) => void;
  onDrop: (result: SceneEmployeeDrop) => void;
  onDragState: (drag: SceneEmployeeDrag | null) => void;
}) {
  const { camera, gl } = useThree();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  return (event: PointerEvent | MouseEvent) => {
    if (cleanupRef.current) return;

    const pointerId = 'pointerId' in event ? event.pointerId : null;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let complete = false;
    let lastPoint: ScenePlacementPoint | null = null;
    let lastClientX = startX;
    let lastClientY = startY;

    const releasePointer = () => {
      try {
        if (pointerId !== null) gl.domElement.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture is best-effort; WebView can release it before cleanup runs.
      }
    };

    const cleanup = () => {
      if (complete) return;
      complete = true;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('mouseup', onMouseUp);
      gl.domElement.removeEventListener('pointerup', onPointerUp);
      gl.domElement.removeEventListener('pointercancel', onPointerCancel);
      gl.domElement.removeEventListener('mouseup', onMouseUp);
      gl.domElement.removeEventListener('lostpointercapture', onLostPointerCapture);
      window.removeEventListener('blur', onPointerCancel);
      releasePointer();
      document.body.style.cursor = '';
      onHoverZone(null);
      onDragState(null);
      cleanupRef.current = null;
    };

    const toGround = (e: PointerEvent | MouseEvent) =>
      groundPointFromClient(e.clientX, e.clientY, gl.domElement, camera, zones);

    const updateDragPreview = (e: PointerEvent | MouseEvent, nextMoved: boolean) => {
      const point = toGround(e);
      lastPoint = point;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      onDragState({
        employeeId,
        x: point?.x ?? x,
        z: point?.z ?? z,
        clientX: e.clientX,
        clientY: e.clientY,
        moved: nextMoved,
      });
      return point;
    };

    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) moved = true;
      const point = updateDragPreview(e, moved);
      onHoverZone(moved ? (point?.zoneId ?? null) : null);
    };

    const finishDrop = (e: PointerEvent | MouseEvent) => {
      e.preventDefault();
      const ground = moved ? toGround(e) : null;
      onDrop({
        zoneId: ground?.zoneId ?? null,
        x: ground?.x ?? null,
        z: ground?.z ?? null,
        startX,
        startY,
        endX: e.clientX,
        endY: e.clientY,
        moved,
      });
      cleanup();
    };

    const finishLatestDrop = () => {
      if (complete) return;
      onDrop({
        zoneId: moved ? (lastPoint?.zoneId ?? null) : null,
        x: moved ? (lastPoint?.x ?? null) : null,
        z: moved ? (lastPoint?.z ?? null) : null,
        startX,
        startY,
        endX: lastClientX,
        endY: lastClientY,
        moved,
      });
      cleanup();
    };

    const onPointerUp = (e: PointerEvent) => finishDrop(e);
    const onMouseUp = (e: MouseEvent) => finishDrop(e);
    const onLostPointerCapture = () => finishLatestDrop();
    const onPointerCancel = () => {
      onDrop({
        zoneId: null,
        x: null,
        z: null,
        startX,
        startY,
        endX: startX,
        endY: startY,
        moved,
      });
      cleanup();
    };

    try {
      if (pointerId !== null) gl.domElement.setPointerCapture(pointerId);
    } catch {
      // Window/document listeners still own the drag lifecycle if capture is unavailable.
    }

    onDragState({
      employeeId,
      x,
      z,
      clientX: startX,
      clientY: startY,
      moved: false,
    });
    document.body.style.cursor = 'grabbing';
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('mouseup', onMouseUp);
    gl.domElement.addEventListener('pointerup', onPointerUp);
    gl.domElement.addEventListener('pointercancel', onPointerCancel);
    gl.domElement.addEventListener('mouseup', onMouseUp);
    gl.domElement.addEventListener('lostpointercapture', onLostPointerCapture);
    window.addEventListener('blur', onPointerCancel);
  };
}

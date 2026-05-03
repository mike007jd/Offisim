import { drawRoundedRect } from '../canvas-primitives';
import type { FrameContext, SceneSnapshot } from '../office-2d-canvas-renderer';
import { DEGRADED_THRESHOLD } from '../office-2d-canvas-renderer';
import { getPrefabDrawFn } from '../office-2d-render-registry';

export function drawPrefabs(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  const degraded = snapshot.employees.length > DEGRADED_THRESHOLD;
  for (const prefab of snapshot.prefabs) {
    if (degraded) {
      drawRoundedRect(ctx, prefab.x - 12, prefab.y - 12, 24, 24, {
        fill: frame.palette.prefabSilhouetteDegraded,
        radius: 3,
      });
    } else {
      const drawFn = getPrefabDrawFn(prefab.prefabId, prefab.category);
      drawFn(ctx, prefab.x, prefab.y, prefab.rotation, frame.sceneColors);
    }
  }
}

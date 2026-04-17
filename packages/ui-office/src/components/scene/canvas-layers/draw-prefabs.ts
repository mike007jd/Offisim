import type { SceneSnapshot, ViewportTransform } from '../office-2d-canvas-renderer';
import { getPrefabDrawFn } from '../office-2d-render-registry';

const DEGRADED_THRESHOLD = 50;

export function drawPrefabs(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  _transform: ViewportTransform,
): void {
  const degraded = snapshot.employees.length > DEGRADED_THRESHOLD;
  for (const prefab of snapshot.prefabs) {
    if (degraded) {
      ctx.fillStyle = 'rgba(100, 116, 139, 0.1)';
      ctx.beginPath();
      ctx.roundRect(prefab.x - 12, prefab.y - 12, 24, 24, 3);
      ctx.fill();
    } else {
      const drawFn = getPrefabDrawFn(prefab.prefabId, prefab.category);
      drawFn(ctx, prefab.x, prefab.y, prefab.rotation);
    }
  }
}

import { EMPLOYEE_RADIUS } from '../office-2d-canvas-geometry';
import type {
  DragRenderState,
  SceneSnapshot,
  ViewportTransform,
} from '../office-2d-canvas-renderer';

export function drawDragOverlay(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  _transform: ViewportTransform,
): void {
  const drag = snapshot.interaction.drag;
  if (!drag) return;
  drawDragGhost(ctx, drag);
}

function drawDragGhost(ctx: CanvasRenderingContext2D, drag: DragRenderState): void {
  const r = EMPLOYEE_RADIUS + 2;
  ctx.save();
  ctx.globalAlpha = 0.7;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(drag.ghostX + 2, drag.ghostY + 2, r + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = drag.ghostStatusColor;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(drag.ghostX, drag.ghostY, r + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(drag.ghostX, drag.ghostY, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = drag.ghostStatusColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(drag.ghostX, drag.ghostY, r, 0, Math.PI * 2);
  ctx.stroke();

  if (drag.ghostAvatarImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(drag.ghostX, drag.ghostY, r - 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(
        drag.ghostAvatarImage,
        drag.ghostX - (r - 2),
        drag.ghostY - (r - 2),
        (r - 2) * 2,
        (r - 2) * 2,
      );
    } catch {
      /* image not loaded — solid ring fallback */
    }
    ctx.restore();
  }

  const nameY = drag.ghostY + r + 16;
  const firstName = drag.ghostName.split(' ')[0] ?? drag.ghostName;
  ctx.fillStyle = '#1e293b';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(drag.ghostX - 36, nameY - 8, 72, 16, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(drag.ghostX - 36, nameY - 8, 72, 16, 8);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(firstName, drag.ghostX, nameY);
  ctx.restore();
}

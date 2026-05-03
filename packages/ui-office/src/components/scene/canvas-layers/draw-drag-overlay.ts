import { drawAvatarCircle, drawNamePill } from '../canvas-primitives';
import { EMPLOYEE_RADIUS } from '../office-2d-canvas-geometry';
import type {
  DragRenderState,
  FrameContext,
  SceneCanvasPalette,
  SceneSnapshot,
} from '../office-2d-canvas-renderer';

export function drawDragOverlay(
  ctx: CanvasRenderingContext2D,
  _snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  const drag = frame.interaction.drag;
  if (!drag) return;
  drawDragGhost(ctx, drag, frame.palette);
}

function drawDragGhost(
  ctx: CanvasRenderingContext2D,
  drag: DragRenderState,
  palette: SceneCanvasPalette,
): void {
  const r = EMPLOYEE_RADIUS + 2;
  ctx.save();
  ctx.globalAlpha = 0.7;

  ctx.fillStyle = palette.dragGhostShadow;
  ctx.beginPath();
  ctx.arc(drag.ghostX + 2, drag.ghostY + 2, r + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = drag.ghostStatusColor;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(drag.ghostX, drag.ghostY, r + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;

  drawAvatarCircle(ctx, drag.ghostX, drag.ghostY, r, {
    statusColor: drag.ghostStatusColor,
    avatarImage: drag.ghostAvatarImage,
    lineWidth: 3,
    bgFill: palette.pillBg,
  });

  ctx.globalAlpha = 0.9;
  drawNamePill(ctx, drag.ghostX, drag.ghostY + r + 16, drag.ghostName, 72, palette, {
    bgAlpha: 0.9,
  });
  ctx.restore();
}

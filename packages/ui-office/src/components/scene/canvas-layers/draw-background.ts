import type { FrameContext, SceneSnapshot } from '../office-2d-canvas-renderer';

const BACKGROUND_COLOR = '#020617';
const GRID_SPACING = 50;
const GRID_COLOR = 'rgba(148, 163, 184, 0.06)';
const ROOM_W = 2000;
const ROOM_H = 1500;

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  _snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  const { width, height, devicePixelRatio } = frame.canvasSize;
  const { transform } = frame;

  // Pass 1: clear in dpr-only coord space so viewport pan/zoom cannot leave stale pixels.
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);

  // Switch to world transform (dpr * scale + dpr * pan); subsequent layers trust this state.
  ctx.setTransform(
    devicePixelRatio * transform.scale,
    0,
    0,
    devicePixelRatio * transform.scale,
    devicePixelRatio * transform.x,
    devicePixelRatio * transform.y,
  );

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= ROOM_W; x += GRID_SPACING) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ROOM_H);
  }
  for (let y = 0; y <= ROOM_H; y += GRID_SPACING) {
    ctx.moveTo(0, y);
    ctx.lineTo(ROOM_W, y);
  }
  ctx.stroke();
}

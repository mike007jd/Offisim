/**
 * Shared canvas drawing primitives used by multiple layers. Lives next to
 * the layer files (not in `office-2d-canvas-renderer.ts`) so layers can
 * import these without pulling the orchestrator, and so orchestrator stays
 * minimal. Functions here are pure — they only touch `ctx`.
 */

import type { SceneCanvasPalette } from './office-2d-canvas-renderer';

interface RoundedRectOpts {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  alpha?: number;
  dash?: number[];
  radius?: number;
}

/** Fill + optional stroke of a rounded rect, alpha-scoped so caller is untouched. */
export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: RoundedRectOpts,
): void {
  const r = opts.radius ?? 8;
  const prevAlpha = ctx.globalAlpha;
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  if (opts.stroke) {
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.lineWidth ?? 1;
    if (opts.dash) ctx.setLineDash(opts.dash);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
    if (opts.dash) ctx.setLineDash([]);
  }
  if (opts.alpha !== undefined) ctx.globalAlpha = prevAlpha;
}

interface AvatarCircleOpts {
  statusColor: string;
  avatarImage: HTMLImageElement | ImageBitmap | null;
  lineWidth?: number;
  /** Pill background fill. Required — caller pulls from `palette.pillBg`. */
  bgFill: string;
}

/**
 * Draw the "employee circle" shape: pill-bg base circle + colored status
 * stroke + clipped avatar. The blank-fallback branch mirrors the old
 * `drawEmployeeNode` / `drawDragGhost` behaviour (image-not-yet-decoded).
 */
export function drawAvatarCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  opts: AvatarCircleOpts,
): void {
  ctx.fillStyle = opts.bgFill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = opts.statusColor;
  ctx.lineWidth = opts.lineWidth ?? 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  if (opts.avatarImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(opts.avatarImage, cx - (r - 2), cy - (r - 2), (r - 2) * 2, (r - 2) * 2);
    } catch {
      // Image not yet decoded — ctx.drawImage throws InvalidStateError; the solid
      // status ring above is the graceful fallback until `onload` fires.
    }
    ctx.restore();
  }
}

type NamePillPalette = Pick<SceneCanvasPalette, 'pillBg' | 'pillBgStroke' | 'pillText'>;

/** Name pill (rounded rect + label text) used under employee + drag-ghost circles. */
export function drawNamePill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  width: number,
  palette: NamePillPalette,
  opts: { bgAlpha?: number } = {},
): void {
  const first = text.split(' ')[0] ?? text;
  drawRoundedRect(ctx, cx - width / 2, cy - 8, width, 16, {
    fill: palette.pillBg,
    stroke: palette.pillBgStroke,
    lineWidth: 0.5,
    alpha: opts.bgAlpha ?? 0.85,
    radius: 8,
  });
  ctx.fillStyle = palette.pillText;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(first, cx, cy);
}

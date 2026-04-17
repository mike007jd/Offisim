import { drawRoundedRect } from '../canvas-primitives';
import type { FrameContext, SceneSnapshot, ZoneRenderData } from '../office-2d-canvas-renderer';

export function drawZones(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  const drag = frame.interaction.drag;
  drawZoneSurfaces(ctx, snapshot.zones, drag);
  drawZoneLabels(ctx, snapshot.zones);
}

function drawZoneSurfaces(
  ctx: CanvasRenderingContext2D,
  zones: ReadonlyArray<ZoneRenderData>,
  drag: FrameContext['interaction']['drag'],
): void {
  for (const zone of zones) {
    const isDragging = drag !== null;
    const isDropTarget = isDragging && drag.dropTargetZoneIds.includes(zone.zoneId);
    const isHovered = isDragging && drag.hoveredZoneId === zone.zoneId;
    const isSourceZone = isDragging && drag.sourceZoneId === zone.zoneId;
    const strokeWidth = isDropTarget ? (isHovered && !isSourceZone ? 3 : 2) : 1.5;
    const strokeAlpha = isDropTarget ? (isHovered && !isSourceZone ? 0.8 : 0.5) : 0.3;
    const dash = zone.isInfrastructure
      ? [8, 4]
      : isDropTarget && !isSourceZone
        ? [6, 3]
        : undefined;

    drawRoundedRect(ctx, zone.x, zone.y, zone.w, zone.h, {
      fill: zone.accentColor,
      alpha: isHovered && !isSourceZone ? 0.18 : 0.06,
      radius: 16,
    });
    drawRoundedRect(ctx, zone.x, zone.y, zone.w, zone.h, {
      stroke: zone.accentColor,
      lineWidth: strokeWidth,
      alpha: strokeAlpha,
      dash,
      radius: 16,
    });

    if (isDropTarget && !isSourceZone) {
      const prevAlpha = ctx.globalAlpha;
      ctx.fillStyle = zone.accentColor;
      ctx.globalAlpha = isHovered ? 0.9 : 0.4;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Drop here', zone.x + zone.w / 2, zone.y + zone.h / 2 + 5);
      ctx.globalAlpha = prevAlpha;
    }
  }
}

function drawZoneLabels(ctx: CanvasRenderingContext2D, zones: ReadonlyArray<ZoneRenderData>): void {
  for (const zone of zones) {
    const prevAlpha = ctx.globalAlpha;
    ctx.fillStyle = zone.accentColor;
    ctx.globalAlpha = 0.5;
    ctx.font = '900 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = zone.label.toUpperCase();
    const letterSpacing = 6;
    const chars = Array.from(label);
    let charWidths = 0;
    for (const ch of chars) charWidths += ctx.measureText(ch).width;
    const fullWidth = charWidths + (chars.length - 1) * letterSpacing;
    let cx = zone.x + zone.w / 2 - fullWidth / 2;
    for (const ch of chars) {
      const cw = ctx.measureText(ch).width;
      ctx.fillText(ch, cx + cw / 2, zone.y + 20);
      cx += cw + letterSpacing;
    }
    ctx.globalAlpha = prevAlpha;
  }
}

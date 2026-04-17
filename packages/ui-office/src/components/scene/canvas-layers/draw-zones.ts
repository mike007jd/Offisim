import type {
  SceneSnapshot,
  ViewportTransform,
  ZoneRenderData,
} from '../office-2d-canvas-renderer';

export function drawZones(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  _transform: ViewportTransform,
): void {
  const drag = snapshot.interaction.drag;
  drawZoneSurfaces(ctx, snapshot.zones, drag);
  drawZoneLabels(ctx, snapshot.zones);
}

function drawZoneSurfaces(
  ctx: CanvasRenderingContext2D,
  zones: ReadonlyArray<ZoneRenderData>,
  drag: SceneSnapshot['interaction']['drag'],
): void {
  for (const zone of zones) {
    const isDragging = drag !== null;
    const isDropTarget = isDragging && drag.dropTargetZoneIds.includes(zone.zoneId);
    const isHovered = isDragging && drag.hoveredZoneId === zone.zoneId;
    const isSourceZone = isDragging && drag.sourceZoneId === zone.zoneId;

    ctx.fillStyle = zone.accentColor;
    ctx.globalAlpha = isHovered && !isSourceZone ? 0.18 : 0.06;
    ctx.beginPath();
    ctx.roundRect(zone.x, zone.y, zone.w, zone.h, 16);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.strokeStyle = zone.accentColor;
    ctx.lineWidth = isDropTarget ? (isHovered && !isSourceZone ? 3 : 2) : 1.5;
    ctx.globalAlpha = isDropTarget ? (isHovered && !isSourceZone ? 0.8 : 0.5) : 0.3;

    if (zone.isInfrastructure) {
      ctx.setLineDash([8, 4]);
    } else if (isDropTarget && !isSourceZone) {
      ctx.setLineDash([6, 3]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.roundRect(zone.x, zone.y, zone.w, zone.h, 16);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    if (isDropTarget && !isSourceZone) {
      ctx.fillStyle = zone.accentColor;
      ctx.globalAlpha = isHovered ? 0.9 : 0.4;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Drop here', zone.x + zone.w / 2, zone.y + zone.h / 2 + 5);
      ctx.globalAlpha = 1.0;
    }
  }
}

function drawZoneLabels(ctx: CanvasRenderingContext2D, zones: ReadonlyArray<ZoneRenderData>): void {
  for (const zone of zones) {
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
    ctx.globalAlpha = 1.0;
  }
}

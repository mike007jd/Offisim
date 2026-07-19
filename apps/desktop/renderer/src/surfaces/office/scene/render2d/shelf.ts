import type { SceneCueFrame } from '@/assistant/runtime/scene-cue-projection.js';
import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import { CANVAS_FONT_TOKENS, CANVAS_RADIUS_TOKENS } from '@/styles/visual-tokens.js';
import { type Hit, type OccupiedRect, type Render2DSurface, roundRect } from './background.js';
import { ellipsizeToWidth, flowTarget2D } from './flows.js';

export function drawShelf({
  surface,
  frame,
  floorW,
  floorD,
  reducedMotion,
  shelfGlowUntil,
  hits,
  occupied,
}: {
  surface: Render2DSurface;
  frame: SceneCueFrame;
  floorW: number;
  floorD: number;
  reducedMotion: boolean;
  shelfGlowUntil: number;
  hits: Hit[];
  occupied: OccupiedRect[];
}) {
  if (!frame.delivery.latest) return;
  const { ctx } = surface;
  const shelf = flowTarget2D('delivery', surface, floorW, floorD);
  const chips = frame.delivery.chips;
  const shelfW = 132;
  const headH = 18;
  const chipH = 15;
  const chipGap = 3;
  const overflowH = frame.delivery.overflowCount > 0 ? 14 : 0;
  const shelfH = headH + chips.length * (chipH + chipGap) + overflowH + 6;
  const x0 = shelf.sx - shelfW / 2;
  const y1 = shelf.sy + 17;
  const y0 = y1 - shelfH;
  const attentionShelf = frame.attention?.target === 'delivery';
  ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
  roundRect(ctx, x0, y0, shelfW, shelfH, CANVAS_RADIUS_TOKENS.deliveryShelf);
  ctx.fill();
  ctx.strokeStyle = attentionShelf
    ? OFFICE_SCENE_2D_COLORS.artifactLine
    : OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
  ctx.lineWidth = attentionShelf ? 1.6 : 1;
  ctx.stroke();
  ctx.lineWidth = 1;
  const glowLeft = shelfGlowUntil - Date.now();
  if (!reducedMotion && glowLeft > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, glowLeft / 1600);
    ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.artifactPacket;
    ctx.lineWidth = 2.5;
    roundRect(
      ctx,
      x0 - 2.5,
      y0 - 2.5,
      shelfW + 5,
      shelfH + 5,
      CANVAS_RADIUS_TOKENS.deliveryShelfGlow,
    );
    ctx.stroke();
    ctx.restore();
  }
  ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
  ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
  ctx.fillText('DELIVERY', x0 + 8, y0 + 13);
  ctx.fillStyle = OFFICE_SCENE_2D_COLORS.artifactPacket;
  ctx.textAlign = 'right';
  ctx.fillText(`×${frame.delivery.recentCount}`, x0 + shelfW - 8, y0 + 13);
  ctx.textAlign = 'left';
  hits.push({ kind: 'delivery', x0, y0, x1: x0 + shelfW, y1 });
  let chipY = y0 + headH + 1;
  chips.forEach((chip, chipIndex) => {
    const newest = chipIndex === chips.length - 1;
    const cx0 = x0 + 6;
    const cw = shelfW - 12;
    ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
    roundRect(ctx, cx0, chipY, cw, chipH, CANVAS_RADIUS_TOKENS.chip);
    ctx.fill();
    ctx.strokeStyle = newest
      ? OFFICE_SCENE_2D_COLORS.artifactPacket
      : OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
    ctx.stroke();
    ctx.font = CANVAS_FONT_TOKENS.officeSceneMarkerGlyph;
    const kindTag = chip.kind.slice(0, 3).toUpperCase();
    ctx.fillStyle = OFFICE_SCENE_2D_COLORS.artifactPacket;
    ctx.fillText(kindTag, cx0 + 5, chipY + 10.5);
    const kindW = ctx.measureText(kindTag).width;
    ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
    ctx.fillStyle = newest ? OFFICE_SCENE_2D_COLORS.name : OFFICE_SCENE_2D_COLORS.zoneLabel;
    const titleX = cx0 + 5 + kindW + 5;
    ctx.fillText(ellipsizeToWidth(ctx, chip.title, cx0 + cw - 5 - titleX), titleX, chipY + 11.5);
    hits.push({
      kind: 'delivery-chip',
      chipIndex,
      x0: cx0,
      y0: chipY,
      x1: cx0 + cw,
      y1: chipY + chipH,
    });
    chipY += chipH + chipGap;
  });
  if (frame.delivery.overflowCount > 0) {
    ctx.font = CANVAS_FONT_TOKENS.officeSceneMarkerGlyph;
    ctx.fillStyle = OFFICE_SCENE_2D_COLORS.zoneLabel;
    ctx.textAlign = 'center';
    ctx.fillText(`+${frame.delivery.overflowCount} MORE`, shelf.sx, chipY + 9);
    ctx.textAlign = 'left';
  }
  occupied.push({ x0, x1: x0 + shelfW, y0, y1 });
}

import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import type { ZoneKind } from '@/data/types.js';
import { CANVAS_FONT_TOKENS, CANVAS_RADIUS_TOKENS } from '@/styles/visual-tokens.js';
import { type ZoneDef, archetypeToKind } from '../scene-layout.js';
import { type OccupiedRect, type Render2DSurface, roundRect } from './background.js';

const ZONE_TINT: Record<ZoneKind, string> = {
  workspace: OFFICE_SCENE_2D_COLORS.zoneWorkspace,
  meeting: OFFICE_SCENE_2D_COLORS.zoneMeeting,
  lounge: OFFICE_SCENE_2D_COLORS.zoneLounge,
};

export function drawZones(
  surface: Render2DSurface,
  zoneDefs: readonly ZoneDef[],
  pip: boolean,
  occupied: OccupiedRect[],
) {
  const { ctx, scale, wx, wy } = surface;
  ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
  for (const zone of zoneDefs) {
    ctx.fillStyle = ZONE_TINT[archetypeToKind(zone.archetype)];
    roundRect(
      ctx,
      wx(zone.cx - zone.w / 2),
      wy(zone.cz - zone.d / 2),
      zone.w * scale,
      zone.d * scale,
      CANVAS_RADIUS_TOKENS.zone,
    );
    ctx.fill();
    if (!pip) {
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.zoneLabel;
      const title = zone.label.toUpperCase();
      const titleX = wx(zone.cx - zone.w / 2) + 10;
      const titleY = wy(zone.cz - zone.d / 2) + 18;
      ctx.fillText(title, titleX, titleY);
      const titleW = ctx.measureText(title).width;
      occupied.push({
        x0: titleX - 2,
        x1: titleX + titleW + 2,
        y0: titleY - 10,
        y1: titleY + 4,
      });
    }
  }
}

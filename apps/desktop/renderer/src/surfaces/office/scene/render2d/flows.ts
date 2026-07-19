import {
  FLOW_TARGET_LABELS,
  type FlowCueTarget,
  type SceneCueFrame,
  type SceneInk,
} from '@/assistant/runtime/scene-cue-projection.js';
import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import { CANVAS_FONT_TOKENS, CANVAS_RADIUS_TOKENS } from '@/styles/visual-tokens.js';
import {
  projectActiveFlowTargets,
  projectFlowLanes,
  projectFlowTargetPoint,
} from '../scene-projection.js';
import { type OccupiedRect, type Render2DSurface, roundRect } from './background.js';

export const INK_2D: Record<SceneInk, { readonly line: string; readonly packet: string }> = {
  work: { line: OFFICE_SCENE_2D_COLORS.flowLine, packet: OFFICE_SCENE_2D_COLORS.flowPacket },
  artifact: {
    line: OFFICE_SCENE_2D_COLORS.artifactLine,
    packet: OFFICE_SCENE_2D_COLORS.artifactPacket,
  },
  risk: {
    line: OFFICE_SCENE_2D_COLORS.resourceLine,
    packet: OFFICE_SCENE_2D_COLORS.resourcePacket,
  },
  approval: {
    line: OFFICE_SCENE_2D_COLORS.approvalLine,
    packet: OFFICE_SCENE_2D_COLORS.approvalPacket,
  },
  neutral: {
    line: OFFICE_SCENE_2D_COLORS.neutralLine,
    packet: OFFICE_SCENE_2D_COLORS.neutralPacket,
  },
};

export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

export function flowTarget2D(
  target: FlowCueTarget,
  surface: Render2DSurface,
  floorW: number,
  floorD: number,
): ScreenPoint {
  const [x, z] = projectFlowTargetPoint(target, { mode: '2d', floorW, floorD });
  return { sx: surface.wx(x), sy: surface.wy(z) };
}

export function ellipsizeToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

export function drawFlows({
  surface,
  frame,
  floorW,
  floorD,
  pip,
  reducedMotion,
  occupied,
  screenForEmployee,
}: {
  surface: Render2DSurface;
  frame: SceneCueFrame;
  floorW: number;
  floorD: number;
  pip: boolean;
  reducedMotion: boolean;
  occupied: OccupiedRect[];
  screenForEmployee: (employeeId: string) => ScreenPoint | null;
}) {
  const { ctx } = surface;
  const targetFor = (target: FlowCueTarget) => flowTarget2D(target, surface, floorW, floorD);
  const lanes = projectFlowLanes<ScreenPoint>(frame.flows, {
    sourceFor: (cue) => screenForEmployee(cue.employeeId),
    targetFor,
    phaseFor: (cue) => (reducedMotion || !cue.pulse ? 0.35 : ((Date.now() - cue.at) % 1400) / 1400),
    labelPositionFor: (source, target, slot) => {
      const mx = (source.sx + target.sx) / 2;
      const my = Math.min(source.sy, target.sy) - 30;
      return {
        sx: 0.25 * source.sx + 0.5 * mx + 0.25 * target.sx,
        sy: 0.25 * source.sy + 0.5 * my + 0.25 * target.sy + slot * 17,
      };
    },
  });

  for (const lane of lanes) {
    const { cue, from: source, to: target } = lane;
    const ink = INK_2D[cue.ink];
    ctx.save();
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = Math.min(3, (cue.ink === 'risk' ? 2.2 : 1.6) + lane.emphasis);
    ctx.setLineDash(cue.pulse ? [] : [4, 5]);
    ctx.beginPath();
    const mx = (source.sx + target.sx) / 2;
    const my = Math.min(source.sy, target.sy) - 30;
    ctx.moveTo(source.sx, source.sy);
    ctx.quadraticCurveTo(mx, my, target.sx, target.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    const t = lane.phase;
    const px = (1 - t) ** 2 * source.sx + 2 * (1 - t) * t * mx + t ** 2 * target.sx;
    const py = (1 - t) ** 2 * source.sy + 2 * (1 - t) * t * my + t ** 2 * target.sy;
    ctx.fillStyle = ink.packet;
    ctx.beginPath();
    ctx.arc(px, py, cue.ink === 'risk' ? 4.2 : 3.4, 0, Math.PI * 2);
    ctx.fill();
    if (!pip) {
      ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
      const text = ellipsizeToWidth(ctx, lane.label, 132);
      const textW = ctx.measureText(text).width;
      const lx = lane.labelPosition.sx;
      const ly = lane.labelPosition.sy;
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
      roundRect(ctx, lx - textW / 2 - 5, ly - 8, textW + 10, 15, CANVAS_RADIUS_TOKENS.label);
      ctx.fill();
      ctx.fillStyle = ink.packet;
      ctx.textAlign = 'center';
      ctx.fillText(text, lx, ly + 3.5);
      ctx.textAlign = 'left';
      occupied.push({
        x0: lx - textW / 2 - 5,
        x1: lx + textW / 2 + 5,
        y0: ly - 8,
        y1: ly + 7,
      });
    }
    ctx.restore();
  }

  const activeFlowTargets = projectActiveFlowTargets(frame.flows, (cue) =>
    Boolean(screenForEmployee(cue.employeeId)),
  );
  for (const anchorTarget of activeFlowTargets) {
    if (anchorTarget === 'delivery' && frame.delivery.latest) continue;
    const anchor = targetFor(anchorTarget);
    ctx.fillStyle = OFFICE_SCENE_2D_COLORS.neutralPacket;
    ctx.beginPath();
    ctx.arc(anchor.sx, anchor.sy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
    const anchorText = FLOW_TARGET_LABELS[anchorTarget].toUpperCase();
    const anchorW = ctx.measureText(anchorText).width;
    const ax = anchor.sx;
    const ay = anchor.sy + 15;
    ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
    roundRect(ctx, ax - anchorW / 2 - 4, ay - 8, anchorW + 8, 14, CANVAS_RADIUS_TOKENS.label);
    ctx.fill();
    ctx.fillStyle = OFFICE_SCENE_2D_COLORS.zoneLabel;
    ctx.textAlign = 'center';
    ctx.fillText(anchorText, ax, ay + 3);
    ctx.textAlign = 'left';
    occupied.push({
      x0: ax - anchorW / 2 - 4,
      x1: ax + anchorW / 2 + 4,
      y0: anchor.sy - 4,
      y1: ay + 6,
    });
  }
}

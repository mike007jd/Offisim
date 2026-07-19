import {
  RESOURCE_KIND_GLYPHS,
  type SceneCueFrame,
  type WorkloadChipTone,
} from '@/assistant/runtime/scene-cue-projection.js';
import { OFFICE_SCENE_2D_COLORS } from '@/data/color-palette.js';
import type { Employee } from '@/data/types.js';
import { resolveAppearance } from '@/lib/avatar.js';
import { CANVAS_FONT_TOKENS, CANVAS_RADIUS_TOKENS } from '@/styles/visual-tokens.js';
import type { ResourceKind } from '@offisim/shared-types';
import { officeResourceMarkerColor } from '../office-visual-language.js';
import { compactSceneEmployeeName } from '../scene-labels.js';
import { type EmployeeScenePlacement, type ZoneDef, clamp } from '../scene-layout.js';
import { WORKLOAD_CHIP_INK } from '../scene-projection.js';
import { type Hit, type OccupiedRect, type Render2DSurface, roundRect } from './background.js';
import { INK_2D, type ScreenPoint } from './flows.js';

type ActorCue = SceneCueFrame['actors'][number];

const CHIP_TONE_2D: Record<WorkloadChipTone, string> = {
  work: INK_2D[WORKLOAD_CHIP_INK.work].packet,
  wait: INK_2D[WORKLOAD_CHIP_INK.wait].packet,
  risk: INK_2D[WORKLOAD_CHIP_INK.risk].packet,
  done: INK_2D[WORKLOAD_CHIP_INK.done].packet,
};

export interface EmployeeProjection2D {
  readonly r: number;
  readonly ringPad: number;
  readonly screenForEmployee: (employeeId: string) => ScreenPoint | null;
}

export function createEmployeeProjection({
  surface,
  positions,
  actorById,
  zoneById,
}: {
  surface: Render2DSurface;
  positions: ReadonlyMap<string, EmployeeScenePlacement>;
  actorById: ReadonlyMap<string, ActorCue>;
  zoneById: ReadonlyMap<string, ZoneDef>;
}): EmployeeProjection2D {
  const { scale, wx, wy } = surface;
  const r = Math.min(16, Math.max(9, scale * 0.42));
  const ringPad = 6;
  const titleBand = 22;
  const labelBand = 16;
  const clampSpan = (v: number, min: number, max: number) =>
    min > max ? (min + max) / 2 : clamp(v, min, max);
  const screenForEmployee = (employeeId: string) => {
    const pos = positions.get(employeeId);
    if (!pos) return null;
    const staging = actorById.get(employeeId)?.staging;
    const staged = staging?.x != null && staging.z != null ? { x: staging.x, z: staging.z } : null;
    let sx = wx(staged ? staged.x : pos.x);
    let sy = wy(staged ? staged.z : pos.z);
    const zone = staged ? undefined : zoneById.get(pos.zoneId);
    if (zone) {
      sx = clampSpan(
        sx,
        wx(zone.cx - zone.w / 2) + r + ringPad,
        wx(zone.cx + zone.w / 2) - r - ringPad,
      );
      sy = clampSpan(
        sy,
        wy(zone.cz - zone.d / 2) + titleBand + r + ringPad,
        wy(zone.cz + zone.d / 2) - r - ringPad - labelBand,
      );
    }
    return { sx, sy };
  };
  return { r, ringPad, screenForEmployee };
}

export function drawEmployees({
  surface,
  orderedRoster,
  positions,
  actorById,
  projection,
  resourceKindByEmployee,
  pip,
  hoveredEmployeeId,
  careerLabelForEmployee,
  occupied,
  hits,
}: {
  surface: Render2DSurface;
  orderedRoster: readonly Employee[];
  positions: ReadonlyMap<string, EmployeeScenePlacement>;
  actorById: ReadonlyMap<string, ActorCue>;
  projection: EmployeeProjection2D;
  resourceKindByEmployee: ReadonlyMap<string, ResourceKind | null>;
  pip: boolean;
  hoveredEmployeeId: string | null;
  careerLabelForEmployee: (employeeId: string) => string | null;
  occupied: OccupiedRect[];
  hits: Hit[];
}) {
  const { ctx, scale } = surface;
  const { r, ringPad, screenForEmployee } = projection;
  for (const employee of orderedRoster) {
    const pos = positions.get(employee.id);
    if (!pos) continue;
    const cue = actorById.get(employee.id);
    const selected = cue?.selected ?? false;
    const wl = cue?.workload ?? null;
    const status = cue?.status ?? 'idle';
    const blocked = status === 'blocked';
    const colors = resolveAppearance(employee.id, employee.appearance);
    const screen = screenForEmployee(employee.id);
    if (!screen) continue;
    const { sx, sy } = screen;

    if (scale >= 14) {
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.desk;
      roundRect(ctx, sx - r * 1.1, sy + r * 0.5, r * 2.2, r * 0.9, CANVAS_RADIUS_TOKENS.desk);
      ctx.fill();
    }

    if (status !== 'idle') {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle =
        status === 'working'
          ? OFFICE_SCENE_2D_COLORS.stateWorking
          : status === 'approval'
            ? OFFICE_SCENE_2D_COLORS.stateApproval
            : OFFICE_SCENE_2D_COLORS.stateBlocked;
      ctx.lineWidth = status === 'blocked' ? 2 : 2.4;
      if (status === 'blocked') ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (selected) {
      ctx.beginPath();
      ctx.arc(sx, sy, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.stateSelected;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (wl?.countLabel) {
      const bx = blocked ? sx - r - 3 : sx + r + 3;
      const by = sy - r - 3;
      ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
      ctx.textAlign = 'center';
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.neutralPacket;
      ctx.fillText(wl.countLabel, bx, by);
      ctx.textAlign = 'left';
      occupied.push({ x0: bx - 9, x1: bx + 9, y0: by - 9, y1: by + 5 });
    }

    const topIssue = wl?.topIssue ?? null;
    const strainKind = resourceKindByEmployee.get(employee.id) ?? null;
    if (topIssue && topIssue.kind !== 'approval' && strainKind) {
      const mx = blocked ? sx + r + 5 : sx - r - 5;
      const my = sy - r - 4;
      const glyph = RESOURCE_KIND_GLYPHS[strainKind];
      const filled = topIssue.severity !== 'warning';
      const markerColor = officeResourceMarkerColor(topIssue.severity);
      if (filled) {
        ctx.fillStyle = markerColor;
        roundRect(ctx, mx - 6, my - 6, 12, 12, CANVAS_RADIUS_TOKENS.resourceMarker);
        ctx.fill();
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
      } else {
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = 1.4;
        roundRect(ctx, mx - 6, my - 6, 12, 12, CANVAS_RADIUS_TOKENS.resourceMarker);
        ctx.stroke();
        ctx.fillStyle = markerColor;
      }
      ctx.font = CANVAS_FONT_TOKENS.officeSceneMarkerGlyph;
      ctx.textAlign = 'center';
      ctx.fillText(glyph, mx, my + 3);
      ctx.textAlign = 'left';
    } else if (blocked) {
      const mx = sx + r + 5;
      const my = sy - r - 4;
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.stateBlocked;
      roundRect(ctx, mx - 5, my - 5, 10, 10, CANVAS_RADIUS_TOKENS.blockedMarker);
      ctx.fill();
    }

    if (!pip && wl && wl.chips.length > 0) {
      const isGrouped = wl.tier !== 'small';
      ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
      ctx.textAlign = 'center';
      const cy = sy + r + 32;
      const chipPad = 7;
      const chipH = 12;
      const gap = 4;
      const overflowW = 24;
      type ChipCell = { text: string; tone: (typeof wl.chips)[number]['tone']; w: number };
      const cells: ChipCell[] = wl.chips.map((chip) => {
        const text = isGrouped
          ? chip.count != null
            ? `${chip.label} ${chip.count}`
            : chip.label
          : chip.label.slice(0, 3);
        const w = isGrouped ? ctx.measureText(text).width + chipPad * 2 : 22;
        return { text, tone: chip.tone, w };
      });
      const totalW =
        cells.reduce((sum, c) => sum + c.w, 0) +
        (cells.length - 1) * gap +
        (wl.overflow ? overflowW + gap : 0);
      let cx = sx - totalW / 2;
      const cyTop = cy - chipH / 2;
      for (const cell of cells) {
        ctx.fillStyle = CHIP_TONE_2D[cell.tone];
        roundRect(ctx, cx, cyTop, cell.w, chipH, CANVAS_RADIUS_TOKENS.chip);
        ctx.fill();
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.floor;
        ctx.fillText(cell.text, cx + cell.w / 2, cy + 4);
        cx += cell.w + gap;
      }
      if (wl.overflow) {
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelfLine;
        roundRect(ctx, cx, cyTop, overflowW, chipH, CANVAS_RADIUS_TOKENS.chip);
        ctx.fill();
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
        ctx.fillText('+…', cx + overflowW / 2, cy + 4);
      }
      ctx.textAlign = 'left';
      hits.push({
        kind: 'drilldown',
        employeeId: employee.id,
        x0: sx - totalW / 2,
        y0: cyTop,
        x1: sx + totalW / 2,
        y1: cyTop + chipH,
      });
    }

    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle =
      employee.kind === 'external' ? OFFICE_SCENE_2D_COLORS.externalClothing : colors.clothing;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy - r * 0.12, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle =
      employee.kind === 'external' ? OFFICE_SCENE_2D_COLORS.externalSkin : colors.skin;
    ctx.fill();

    const labelText = compactSceneEmployeeName(employee.name);
    ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
    const labelW = ctx.measureText(labelText).width;
    const boxAt = (ly: number) => ({
      x0: sx - labelW / 2 - 2,
      x1: sx + labelW / 2 + 2,
      y0: ly - 10,
      y1: ly + 4,
    });
    const slots = [sy + r + 18, sy - r - 8];
    const slot = slots.find((ly) => {
      const box = boxAt(ly);
      return !occupied.some(
        (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0,
      );
    });
    if (slot !== undefined) {
      occupied.push(boxAt(slot));
      ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
      ctx.textAlign = 'center';
      ctx.fillText(labelText, sx, slot);
      ctx.textAlign = 'left';
    }
    if (hoveredEmployeeId === employee.id) {
      const career = careerLabelForEmployee(employee.id);
      if (career) {
        ctx.font = CANVAS_FONT_TOKENS.officeSceneLabel;
        const careerW = ctx.measureText(career).width + 14;
        const careerH = 20;
        const careerX = sx - careerW / 2;
        const careerY = sy - r - 42;
        roundRect(ctx, careerX, careerY, careerW, careerH, CANVAS_RADIUS_TOKENS.deliveryShelf);
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.deliveryShelf;
        ctx.fill();
        ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.activeRing;
        ctx.stroke();
        ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name;
        ctx.textAlign = 'center';
        ctx.fillText(career, sx, careerY + 14);
        ctx.textAlign = 'left';
      }
    }
    occupied.push({
      x0: sx - r - ringPad,
      x1: sx + r + ringPad,
      y0: sy - r - ringPad,
      y1: sy + r + ringPad,
    });
    hits.push({
      kind: 'employee',
      employeeId: employee.id,
      threadId: cue?.threadId ?? null,
      sx,
      sy,
      r: r + 6,
    });
  }
}

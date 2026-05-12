import { drawAvatarCircle, drawNamePill, drawRoundedRect } from '../canvas-primitives';
import { EMPLOYEE_RADIUS } from '../office-2d-canvas-geometry';
import {
  DEGRADED_THRESHOLD,
  type EmployeeRenderData,
  type FrameContext,
  type SceneCanvasPalette,
  type SceneSnapshot,
} from '../office-2d-canvas-renderer';

export function drawEmployees(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  const degraded = snapshot.employees.length > DEGRADED_THRESHOLD;
  drawDeskBackgrounds(ctx, snapshot.employees, degraded, frame.palette);
  const dragSourceName = frame.interaction.drag?.ghostName ?? null;
  for (const emp of snapshot.employees) {
    const isDragSource = dragSourceName !== null && dragSourceName === emp.name;
    const prevAlpha = ctx.globalAlpha;
    if (isDragSource) ctx.globalAlpha = 0.35;
    drawEmployeeNode(ctx, emp, degraded, frame.animationTime, frame.palette);
    if (isDragSource) ctx.globalAlpha = prevAlpha;
  }
}

function drawDeskBackgrounds(
  ctx: CanvasRenderingContext2D,
  employees: ReadonlyArray<EmployeeRenderData>,
  degraded: boolean,
  palette: SceneCanvasPalette,
): void {
  if (degraded) return;
  for (const emp of employees) {
    if (!emp.isActive) continue;
    drawRoundedRect(ctx, emp.x - 28, emp.y - 22 - 32, 56, 44, {
      fill: palette.deskSurface,
      radius: 4,
    });
    ctx.fillStyle = palette.deskScreen;
    ctx.fillRect(emp.x - 14, emp.y - 4 - 32, 28, 3);
    drawRoundedRect(ctx, emp.x - 16, emp.y - 2 - 32, 32, 6, {
      fill: palette.deskBezel,
      radius: 1,
    });
  }
}

function drawEmployeeNode(
  ctx: CanvasRenderingContext2D,
  emp: EmployeeRenderData,
  degraded: boolean,
  animationTime: number,
  palette: SceneCanvasPalette,
): void {
  const r = EMPLOYEE_RADIUS;
  const isPulsing = emp.isBlocked || emp.state === 'failed';
  const pulseAlpha = isPulsing ? 0.5 + 0.5 * Math.sin(animationTime / 300) : 1.0;
  const prevAlpha = ctx.globalAlpha;

  if (emp.isActive && !degraded) {
    ctx.fillStyle = emp.statusColor;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = prevAlpha;
  }

  if (isPulsing) ctx.globalAlpha = pulseAlpha;
  drawAvatarCircle(ctx, emp.x, emp.y, r, {
    statusColor: emp.statusColor,
    avatarImage: degraded ? null : emp.avatarImage,
    lineWidth: emp.isActive ? 3 : 2.5,
    bgFill: palette.pillBg,
  });
  if (isPulsing) ctx.globalAlpha = prevAlpha;

  if (degraded) {
    ctx.fillStyle = emp.statusColor;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = prevAlpha;
  }

  const dotX = emp.x + 12;
  const dotY = emp.y + 12;
  ctx.fillStyle = emp.statusColor;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.dotRing;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.stroke();

  if (emp.isActive && emp.stateLabel && !degraded) {
    drawStateBadge(ctx, emp, r, palette);
  } else if (emp.isActive && degraded) {
    ctx.fillStyle = emp.statusColor;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y - r - 6, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (emp.performanceCue) {
    if (degraded) drawCueCategoryDot(ctx, emp, r, palette);
    else drawEmployeeBubble(ctx, emp, r, palette);
  }

  if (degraded) {
    ctx.fillStyle = palette.nameLabelMuted;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const firstName = emp.name.split(' ')[0] ?? emp.name;
    ctx.fillText(firstName, emp.x, emp.y + r + 12);
  } else {
    drawNamePill(ctx, emp.x, emp.y + r + 12, emp.name, 64, palette);
  }
}

function drawEmployeeBubble(
  ctx: CanvasRenderingContext2D,
  emp: EmployeeRenderData,
  r: number,
  palette: SceneCanvasPalette,
): void {
  if (!emp.performanceCue) return;
  const label = `${emp.performanceCue.icon ? `${emp.performanceCue.icon} ` : ''}${
    emp.performanceCue.text
  }`;
  ctx.save();
  ctx.font = '8px monospace';
  const maxWidth = 118;
  const textWidth = Math.min(maxWidth, Math.ceil(ctx.measureText(label).width + 14));
  const bubbleW = Math.max(46, textWidth);
  const bubbleH = 17;
  const bubbleY = emp.y - r - 38;
  const paletteForCue = cuePalette(emp.performanceCue.category, palette);
  drawRoundedRect(ctx, emp.x - bubbleW / 2, bubbleY - bubbleH / 2, bubbleW, bubbleH, {
    fill: paletteForCue.bg,
    stroke: paletteForCue.stroke,
    lineWidth: 0.7,
    radius: 8,
  });
  ctx.fillStyle = paletteForCue.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, emp.x, bubbleY, bubbleW - 10);
  ctx.restore();
}

function drawCueCategoryDot(
  ctx: CanvasRenderingContext2D,
  emp: EmployeeRenderData,
  r: number,
  palette: SceneCanvasPalette,
): void {
  if (!emp.performanceCue) return;
  const p = cuePalette(emp.performanceCue.category, palette);
  ctx.save();
  ctx.fillStyle = p.text;
  ctx.strokeStyle = p.stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(emp.x, emp.y - r - 10, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function cuePalette(
  category: NonNullable<EmployeeRenderData['performanceCue']>['category'],
  palette: SceneCanvasPalette,
): { bg: string; stroke: string; text: string } {
  if (category === 'blocked') {
    return {
      bg: palette.stateBadgeBgBlocked,
      stroke: palette.stateBadgeStrokeBlocked,
      text: palette.stateBadgeTextBlocked,
    };
  }
  if (category === 'success') {
    return {
      bg: palette.stateBadgeBgSuccess,
      stroke: palette.stateBadgeStrokeSuccess,
      text: palette.stateBadgeTextSuccess,
    };
  }
  return {
    bg: palette.stateBadgeBg,
    stroke: palette.stateBadgeStroke,
    text: palette.stateBadgeText,
  };
}

function drawStateBadge(
  ctx: CanvasRenderingContext2D,
  emp: EmployeeRenderData,
  r: number,
  palette: SceneCanvasPalette,
): void {
  const badgeY = emp.y - r - 16;
  const badgeW = 44;
  const badgeH = 14;
  const bgFill = emp.isBlocked
    ? palette.stateBadgeBgBlocked
    : emp.isSuccess
      ? palette.stateBadgeBgSuccess
      : palette.stateBadgeBg;
  const bgStroke = emp.isBlocked
    ? palette.stateBadgeStrokeBlocked
    : emp.isSuccess
      ? palette.stateBadgeStrokeSuccess
      : palette.stateBadgeStroke;
  drawRoundedRect(ctx, emp.x - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, {
    fill: bgFill,
    stroke: bgStroke,
    lineWidth: 0.5,
    radius: 7,
  });

  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = emp.isBlocked
    ? palette.stateBadgeTextBlocked
    : emp.isSuccess
      ? palette.stateBadgeTextSuccess
      : palette.stateBadgeText;
  const prefix = emp.isBlocked ? '⚠ ' : emp.isSuccess ? '✓ ' : '';
  ctx.fillText(prefix + (emp.stateLabel ?? ''), emp.x, badgeY);
}

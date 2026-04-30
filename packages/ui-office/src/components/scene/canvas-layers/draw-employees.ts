// raw-hex-allowed-file: asset renderer palette; non-design-token content colors.
import { drawAvatarCircle, drawNamePill, drawRoundedRect } from '../canvas-primitives';
import { EMPLOYEE_RADIUS } from '../office-2d-canvas-geometry';
import {
  DEGRADED_THRESHOLD,
  type EmployeeRenderData,
  type FrameContext,
  type SceneSnapshot,
} from '../office-2d-canvas-renderer';

export function drawEmployees(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  const degraded = snapshot.employees.length > DEGRADED_THRESHOLD;
  drawDeskBackgrounds(ctx, snapshot.employees, degraded);
  const dragSourceName = frame.interaction.drag?.ghostName ?? null;
  for (const emp of snapshot.employees) {
    const isDragSource = dragSourceName !== null && dragSourceName === emp.name;
    const prevAlpha = ctx.globalAlpha;
    if (isDragSource) ctx.globalAlpha = 0.35;
    drawEmployeeNode(ctx, emp, degraded, frame.animationTime);
    if (isDragSource) ctx.globalAlpha = prevAlpha;
  }
}

function drawDeskBackgrounds(
  ctx: CanvasRenderingContext2D,
  employees: ReadonlyArray<EmployeeRenderData>,
  degraded: boolean,
): void {
  if (degraded) return;
  for (const emp of employees) {
    if (!emp.isActive) continue;
    drawRoundedRect(ctx, emp.x - 28, emp.y - 22 - 32, 56, 44, {
      fill: 'rgba(30, 41, 59, 0.6)',
      radius: 4,
    });
    ctx.fillStyle = 'rgba(14, 165, 233, 0.5)';
    ctx.fillRect(emp.x - 14, emp.y - 4 - 32, 28, 3);
    drawRoundedRect(ctx, emp.x - 16, emp.y - 2 - 32, 32, 6, {
      fill: 'rgba(51, 65, 85, 1)',
      radius: 1,
    });
  }
}

function drawEmployeeNode(
  ctx: CanvasRenderingContext2D,
  emp: EmployeeRenderData,
  degraded: boolean,
  animationTime: number,
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
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.stroke();

  if (emp.isActive && emp.stateLabel && !degraded) {
    drawStateBadge(ctx, emp, r);
  } else if (emp.isActive && degraded) {
    ctx.fillStyle = emp.statusColor;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y - r - 6, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (degraded) {
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const firstName = emp.name.split(' ')[0] ?? emp.name;
    ctx.fillText(firstName, emp.x, emp.y + r + 12);
  } else {
    drawNamePill(ctx, emp.x, emp.y + r + 12, emp.name, 64);
  }
}

function drawStateBadge(ctx: CanvasRenderingContext2D, emp: EmployeeRenderData, r: number): void {
  const badgeY = emp.y - r - 16;
  const badgeW = 44;
  const badgeH = 14;
  const bgFill = emp.isBlocked
    ? 'rgba(239, 68, 68, 0.25)'
    : emp.isSuccess
      ? 'rgba(34, 197, 94, 0.25)'
      : 'rgba(0, 0, 0, 0.7)';
  const bgStroke = emp.isBlocked
    ? 'rgba(239, 68, 68, 0.4)'
    : emp.isSuccess
      ? 'rgba(34, 197, 94, 0.4)'
      : 'rgba(255, 255, 255, 0.1)';
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
    ? '#fca5a5'
    : emp.isSuccess
      ? '#86efac'
      : 'rgba(255, 255, 255, 0.8)';
  const prefix = emp.isBlocked ? '⚠ ' : emp.isSuccess ? '✓ ' : '';
  ctx.fillText(prefix + (emp.stateLabel ?? ''), emp.x, badgeY);
}

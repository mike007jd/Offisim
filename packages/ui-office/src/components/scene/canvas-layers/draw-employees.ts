import { EMPLOYEE_RADIUS } from '../office-2d-canvas-geometry';
import type {
  EmployeeRenderData,
  SceneSnapshot,
  ViewportTransform,
} from '../office-2d-canvas-renderer';

const DEGRADED_THRESHOLD = 50;

export function drawEmployees(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  _transform: ViewportTransform,
): void {
  const degraded = snapshot.employees.length > DEGRADED_THRESHOLD;
  drawDeskBackgrounds(ctx, snapshot.employees, degraded);
  const dragSourceName = snapshot.interaction.drag?.ghostName ?? null;
  for (const emp of snapshot.employees) {
    const isDragSource = dragSourceName !== null && dragSourceName === emp.name;
    if (isDragSource) ctx.globalAlpha = 0.35;
    drawEmployeeNode(ctx, emp, degraded, snapshot.animationTime);
    if (isDragSource) ctx.globalAlpha = 1.0;
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
    ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
    ctx.beginPath();
    ctx.roundRect(emp.x - 28, emp.y - 22 - 32, 56, 44, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(14, 165, 233, 0.5)';
    ctx.fillRect(emp.x - 14, emp.y - 4 - 32, 28, 3);
    ctx.fillStyle = 'rgba(51, 65, 85, 1)';
    ctx.beginPath();
    ctx.roundRect(emp.x - 16, emp.y - 2 - 32, 32, 6, 1);
    ctx.fill();
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

  if (emp.isActive && !degraded) {
    ctx.fillStyle = emp.statusColor;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(emp.x, emp.y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = emp.statusColor;
  ctx.lineWidth = emp.isActive ? 3 : 2.5;
  if (isPulsing) ctx.globalAlpha = pulseAlpha;
  ctx.beginPath();
  ctx.arc(emp.x, emp.y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (isPulsing) ctx.globalAlpha = 1.0;

  if (!degraded && emp.avatarImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r - 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(emp.avatarImage, emp.x - (r - 2), emp.y - (r - 2), (r - 2) * 2, (r - 2) * 2);
    } catch {
      /* image not loaded yet — solid circle fallback */
    }
    ctx.restore();
  } else if (degraded) {
    ctx.fillStyle = emp.statusColor;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
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

  drawNameLabel(ctx, emp, r, degraded);
}

function drawStateBadge(ctx: CanvasRenderingContext2D, emp: EmployeeRenderData, r: number): void {
  const badgeY = emp.y - r - 16;
  const badgeW = 44;
  const badgeH = 14;
  if (emp.isBlocked) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
  } else if (emp.isSuccess) {
    ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.4)';
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  }
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(emp.x - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, 7);
  ctx.fill();
  ctx.stroke();

  ctx.font = '7px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (emp.isBlocked) ctx.fillStyle = '#fca5a5';
  else if (emp.isSuccess) ctx.fillStyle = '#86efac';
  else ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  const prefix = emp.isBlocked ? '⚠ ' : emp.isSuccess ? '✓ ' : '';
  ctx.fillText(prefix + (emp.stateLabel ?? ''), emp.x, badgeY);
}

function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  emp: EmployeeRenderData,
  r: number,
  degraded: boolean,
): void {
  const nameY = emp.y + r + 12;
  const firstName = emp.name.split(' ')[0] ?? emp.name;
  if (!degraded) {
    ctx.fillStyle = '#1e293b';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(emp.x - 32, nameY - 8, 64, 16, 8);
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.roundRect(emp.x - 32, nameY - 8, 64, 16, 8);
    ctx.stroke();
  }
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(firstName, emp.x, nameY);
}

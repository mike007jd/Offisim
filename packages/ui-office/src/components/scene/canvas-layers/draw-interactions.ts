import { EMPLOYEE_RADIUS } from '../office-2d-canvas-geometry';
import type { FrameContext, SceneSnapshot } from '../office-2d-canvas-renderer';

export function drawInteractions(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  frame: FrameContext,
): void {
  const { selectedEmployeeId, hoveredEmployeeId } = frame.interaction;
  if (selectedEmployeeId === null && hoveredEmployeeId === null) return;
  const r = EMPLOYEE_RADIUS;
  const prevAlpha = ctx.globalAlpha;
  for (const emp of snapshot.employees) {
    const isSelected = selectedEmployeeId === emp.employeeId;
    const isHovered = hoveredEmployeeId === emp.employeeId;
    if (isSelected) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(emp.x, emp.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (isHovered && !isSelected) {
      ctx.strokeStyle = emp.statusColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(emp.x, emp.y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = prevAlpha;
}

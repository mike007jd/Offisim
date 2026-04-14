/**
 * office-2d-canvas-renderer.ts — Pure drawing module for the 2D office Canvas view.
 *
 * Receives a CanvasRenderingContext2D and scene data, draws everything.
 * No React, no state management, no side effects beyond canvas drawing.
 *
 * Draw order (back to front):
 * 1. Clear canvas with background (#020617)
 * 2. Floor grid (50px spacing, low opacity)
 * 3. Zone fills and strokes (rounded rects, dashed for infrastructure)
 * 4. Zone labels (centered, uppercase, letter-spaced)
 * 5. Prefab silhouettes via Render Registry
 * 6. Employee desk backgrounds
 * 7. Employee nodes (avatar circle, status ring, status dot, name label)
 */

import type { ViewportTransform } from './office-2d-canvas-geometry';
import { EMPLOYEE_RADIUS } from './office-2d-canvas-geometry';
import { getPrefabDrawFn } from './office-2d-render-registry';
import { truncate } from '../../lib/format-time';

// ── Status Colors (inline, matching design doc palette) ─────────────

export const STATUS_COLORS: Record<string, string> = {
  idle: '#64748b',
  assigned: '#3b82f6',
  thinking: '#818cf8',
  searching: '#c084fc',
  executing: '#10b981',
  blocked: '#ef4444',
  waiting: '#f59e0b',
  reporting: '#06b6d4',
  success: '#22c55e',
  failed: '#ef4444',
};

const DEFAULT_STATUS_COLOR = '#64748b';

/** Return the status color for a given agent state, defaulting to #64748b. */
export function getStatusColor(state: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_COLORS, state)
    ? (STATUS_COLORS[state] as string)
    : DEFAULT_STATUS_COLOR;
}

// ── Constants ───────────────────────────────────────────────────────

const BACKGROUND_COLOR = '#020617';
const GRID_SPACING = 50;
const GRID_COLOR = 'rgba(148, 163, 184, 0.06)';
const DEGRADED_THRESHOLD = 50;

// ── Render Data Interfaces ──────────────────────────────────────────

/** Immutable snapshot of all scene data needed for one frame. */
export interface SceneSnapshot {
  zones: ReadonlyArray<ZoneRenderData>;
  prefabs: ReadonlyArray<PrefabRenderData>;
  employees: ReadonlyArray<EmployeeRenderData>;
  ceremony: CeremonyRenderData;
  managerMarker: ManagerMarkerData | null;
  meetingBubble: MeetingBubbleData | null;
}

export interface ZoneRenderData {
  zoneId: string;
  x: number; y: number; w: number; h: number; // canvas coords
  accentColor: string;
  label: string;
  isInfrastructure: boolean; // deskSlots === 0
}

export interface PrefabRenderData {
  prefabId: string;
  category: string;
  x: number; y: number; // canvas coords
  rotation: number;
}

export interface EmployeeRenderData {
  employeeId: string;
  x: number; y: number; // canvas coords
  name: string;
  avatarImage: HTMLImageElement | ImageBitmap | null;
  statusColor: string;
  state: string;
  stateLabel: string | null;
  isBlocked: boolean;
  isSuccess: boolean;
  isWorking: boolean;
  isActive: boolean;
}

export interface CeremonyRenderData {
  phase: string;
  isActive: boolean;
}

export interface ManagerMarkerData {
  x: number; y: number; // canvas coords
}

export interface MeetingBubbleData {
  x: number; y: number; // canvas coords (bubble center)
  phaseColor: string;
  bubbleText: string;
  participantCount: number;
  waitingLabels: string[];
  extraWaitingCount: number;
}

/** Interaction state passed to renderer for visual feedback. */
export interface InteractionState {
  selectedEmployeeId: string | null;
  hoveredEmployeeId: string | null;
  drag: DragRenderState | null;
}

export interface DragRenderState {
  ghostX: number; ghostY: number; // canvas coords
  ghostAvatarImage: HTMLImageElement | ImageBitmap | null;
  ghostName: string;
  ghostStatusColor: string;
  sourceZoneId: string;
  hoveredZoneId: string | null;
  dropTargetZoneIds: string[]; // zones with deskSlots > 0
}

// ── Internal draw helpers ───────────────────────────────────────────

function drawBackground(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.resetTransform();
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

function drawFloorGrid(
  ctx: CanvasRenderingContext2D,
  roomW: number,
  roomH: number,
): void {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= roomW; x += GRID_SPACING) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, roomH);
  }
  for (let y = 0; y <= roomH; y += GRID_SPACING) {
    ctx.moveTo(0, y);
    ctx.lineTo(roomW, y);
  }
  ctx.stroke();
}

function drawZones(
  ctx: CanvasRenderingContext2D,
  zones: ReadonlyArray<ZoneRenderData>,
  drag: DragRenderState | null,
): void {
  for (const zone of zones) {
    const isDragging = drag !== null;
    const isDropTarget = isDragging && drag.dropTargetZoneIds.includes(zone.zoneId);
    const isHovered = isDragging && drag.hoveredZoneId === zone.zoneId;
    const isSourceZone = isDragging && drag.sourceZoneId === zone.zoneId;

    // Fill
    ctx.fillStyle = zone.accentColor;
    ctx.globalAlpha = isHovered && !isSourceZone ? 0.18 : 0.06;
    ctx.beginPath();
    ctx.roundRect(zone.x, zone.y, zone.w, zone.h, 16);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Stroke
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

    // "Drop here" label for valid drop targets during drag
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

function drawZoneLabels(
  ctx: CanvasRenderingContext2D,
  zones: ReadonlyArray<ZoneRenderData>,
): void {
  for (const zone of zones) {
    ctx.fillStyle = zone.accentColor;
    ctx.globalAlpha = 0.5;
    ctx.font = '900 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Letter spacing via manual character placement
    const label = zone.label.toUpperCase();
    const letterSpacing = 6;
    const chars = Array.from(label);
    // Measure each character to center properly
    let charWidths = 0;
    for (const ch of chars) {
      charWidths += ctx.measureText(ch).width;
    }
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

function drawPrefabs(
  ctx: CanvasRenderingContext2D,
  prefabs: ReadonlyArray<PrefabRenderData>,
  degraded: boolean,
): void {
  for (const prefab of prefabs) {
    if (degraded) {
      // Simplified prefab: just a small translucent rect
      ctx.fillStyle = 'rgba(100, 116, 139, 0.1)';
      ctx.beginPath();
      ctx.roundRect(prefab.x - 12, prefab.y - 12, 24, 24, 3);
      ctx.fill();
    } else {
      const drawFn = getPrefabDrawFn(prefab.prefabId, prefab.category);
      drawFn(ctx, prefab.x, prefab.y, prefab.rotation);
    }
  }
}

function drawEmployeeDeskBackgrounds(
  ctx: CanvasRenderingContext2D,
  employees: ReadonlyArray<EmployeeRenderData>,
  degraded: boolean,
): void {
  if (degraded) return;
  for (const emp of employees) {
    if (!emp.isActive) continue; // Only active employees get desk backgrounds
    // Desk surface
    ctx.fillStyle = 'rgba(30, 41, 59, 0.6)'; // --surface-mid equivalent
    ctx.beginPath();
    ctx.roundRect(emp.x - 28, emp.y - 22 - 32, 56, 44, 4);
    ctx.fill();
    // Monitor bar
    ctx.fillStyle = 'rgba(14, 165, 233, 0.5)';
    ctx.fillRect(emp.x - 14, emp.y - 4 - 32, 28, 3);
    // Keyboard area
    ctx.fillStyle = 'rgba(51, 65, 85, 1)';
    ctx.beginPath();
    ctx.roundRect(emp.x - 16, emp.y - 2 - 32, 32, 6, 1);
    ctx.fill();
  }
}

function drawEmployeeNode(
  ctx: CanvasRenderingContext2D,
  emp: EmployeeRenderData,
  isSelected: boolean,
  isHovered: boolean,
  degraded: boolean,
  animationTime: number,
): void {
  const r = EMPLOYEE_RADIUS; // 18
  // Pulsing opacity for blocked/failed employees
  const isPulsing = emp.isBlocked || emp.state === 'failed';
  const pulseAlpha = isPulsing ? 0.5 + 0.5 * Math.sin(animationTime / 300) : 1.0;

  // Selection halo
  if (isSelected) {
    ctx.strokeStyle = '#6366f1'; // accent color
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // Hover highlight
  if (isHovered && !isSelected) {
    ctx.strokeStyle = emp.statusColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  // Status ring background (pulsing glow for active)
  if (emp.isActive && !degraded) {
    ctx.fillStyle = emp.statusColor;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // Main circle background
  ctx.fillStyle = '#1e293b'; // --surface-lighter equivalent
  ctx.beginPath();
  ctx.arc(emp.x, emp.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Status ring stroke (pulsing for blocked/failed)
  ctx.strokeStyle = emp.statusColor;
  ctx.lineWidth = emp.isActive ? 3 : 2.5;
  if (isPulsing) ctx.globalAlpha = pulseAlpha;
  ctx.beginPath();
  ctx.arc(emp.x, emp.y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (isPulsing) ctx.globalAlpha = 1.0;

  // Avatar image (clipped to circle)
  if (!degraded && emp.avatarImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r - 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(emp.avatarImage, emp.x - (r - 2), emp.y - (r - 2), (r - 2) * 2, (r - 2) * 2);
    } catch {
      // Image not loaded yet or broken — fallback to solid circle
    }
    ctx.restore();
  } else if (degraded) {
    // Degraded mode: solid colored circle instead of avatar
    ctx.fillStyle = emp.statusColor;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y, r - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // Status dot (bottom-right)
  const dotX = emp.x + 12;
  const dotY = emp.y + 12;
  ctx.fillStyle = emp.statusColor;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.fill();
  // Dot border
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
  ctx.stroke();

  // State label badge (above avatar, only for active non-degraded)
  if (emp.isActive && emp.stateLabel && !degraded) {
    const badgeY = emp.y - r - 16;
    const badgeW = 44;
    const badgeH = 14;

    // Badge background
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

    // Badge text
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (emp.isBlocked) {
      ctx.fillStyle = '#fca5a5';
    } else if (emp.isSuccess) {
      ctx.fillStyle = '#86efac';
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    }
    const prefix = emp.isBlocked ? '⚠ ' : emp.isSuccess ? '✓ ' : '';
    ctx.fillText(prefix + emp.stateLabel, emp.x, badgeY);
  } else if (emp.isActive && degraded) {
    // Degraded mode: just a colored dot above the avatar
    ctx.fillStyle = emp.statusColor;
    ctx.beginPath();
    ctx.arc(emp.x, emp.y - r - 6, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Name label (below avatar)
  const nameY = emp.y + r + 12;
  const firstName = emp.name.split(' ')[0] ?? emp.name;

  if (!degraded) {
    // Name pill background
    ctx.fillStyle = '#1e293b';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(emp.x - 32, nameY - 8, 64, 16, 8);
    ctx.fill();
    ctx.globalAlpha = 1.0;
    // Pill border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.roundRect(emp.x - 32, nameY - 8, 64, 16, 8);
    ctx.stroke();
  }

  // Name text
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(firstName, emp.x, nameY);
}

function drawEmployees(
  ctx: CanvasRenderingContext2D,
  employees: ReadonlyArray<EmployeeRenderData>,
  interaction: InteractionState,
  degraded: boolean,
  animationTime: number,
): void {
  for (const emp of employees) {
    const isSelected = interaction.selectedEmployeeId === emp.employeeId;
    const isHovered = interaction.hoveredEmployeeId === emp.employeeId;
    // Dim the source employee during drag
    const isDragSource = interaction.drag?.ghostName === emp.name;
    if (isDragSource) {
      ctx.globalAlpha = 0.35;
    }
    drawEmployeeNode(ctx, emp, isSelected, isHovered, degraded, animationTime);
    if (isDragSource) {
      ctx.globalAlpha = 1.0;
    }
  }
}

// ── Ceremony / overlay draw helpers ─────────────────────────────────

/**
 * Compute semicircle positions for N participants around a center point.
 * Returns an array of {x, y} positions evenly spaced along a semicircle (π arc).
 * Exported for property testing (Task 10.2).
 */
export function computeSemicirclePositions(
  centerX: number,
  centerY: number,
  radius: number,
  count: number,
): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * ((i + 1) / (count + 1));
    positions.push({
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius * 0.6,
    });
  }
  return positions;
}

/** Draw a diamond-shaped manager presence marker with "Manager" label. */
function drawManagerMarker(
  ctx: CanvasRenderingContext2D,
  marker: ManagerMarkerData,
): void {
  const size = 12;
  ctx.save();

  // Diamond (rotated square)
  ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
  ctx.strokeStyle = '#a855f7';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(marker.x, marker.y - size);
  ctx.lineTo(marker.x + size, marker.y);
  ctx.lineTo(marker.x, marker.y + size);
  ctx.lineTo(marker.x - size, marker.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // "Manager" label
  ctx.fillStyle = '#ffffff';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Manager', marker.x, marker.y + size + 8);

  ctx.restore();
}

/** Draw a meeting bubble overlay with phase color, text, participant count, and waiting labels. */
function drawMeetingBubble(
  ctx: CanvasRenderingContext2D,
  bubble: MeetingBubbleData,
): void {
  ctx.save();

  const bx = bubble.x;
  const by = bubble.y;
  const bubbleW = 280;
  const hasWaiting = bubble.waitingLabels.length > 0;
  const bubbleH = hasWaiting ? 54 + bubble.waitingLabels.length * 12 : 32;
  const extraH = bubble.extraWaitingCount > 0 ? 12 : 0;
  const totalH = bubbleH + extraH;

  // Background rounded rect
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx - bubbleW / 2, by - 16, bubbleW, totalH, 16);
  ctx.fill();
  ctx.stroke();

  // Phase color indicator dot (pulsing effect via static draw)
  ctx.fillStyle = bubble.phaseColor;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(bx - bubbleW / 2 + 20, by, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // Bubble text
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '600 12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncate(bubble.bubbleText, 35), bx - bubbleW / 2 + 32, by);

  // Participant count
  if (bubble.participantCount > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${bubble.participantCount}p`, bx + bubbleW / 2 - 15, by);
  }

  // Waiting labels
  for (let i = 0; i < bubble.waitingLabels.length; i++) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(bubble.waitingLabels[i] ?? '', bx - bubbleW / 2 + 32, by + 14 + i * 11);
  }

  // Extra waiting count
  if (bubble.extraWaitingCount > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(
      `+${bubble.extraWaitingCount} more`,
      bx - bubbleW / 2 + 32,
      by + 14 + bubble.waitingLabels.length * 11,
    );
  }

  ctx.restore();
}

/** Draw the drag ghost (employee avatar at ghost position with reduced opacity). */
function drawDragGhost(
  ctx: CanvasRenderingContext2D,
  drag: DragRenderState,
): void {
  const r = EMPLOYEE_RADIUS + 2; // slightly larger than normal

  ctx.save();
  ctx.globalAlpha = 0.7;

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(drag.ghostX + 2, drag.ghostY + 2, r + 2, 0, Math.PI * 2);
  ctx.fill();

  // Outer glow
  ctx.fillStyle = drag.ghostStatusColor;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(drag.ghostX, drag.ghostY, r + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;

  // Main circle
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(drag.ghostX, drag.ghostY, r, 0, Math.PI * 2);
  ctx.fill();

  // Status ring
  ctx.strokeStyle = drag.ghostStatusColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(drag.ghostX, drag.ghostY, r, 0, Math.PI * 2);
  ctx.stroke();

  // Avatar image (clipped to circle)
  if (drag.ghostAvatarImage) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(drag.ghostX, drag.ghostY, r - 2, 0, Math.PI * 2);
    ctx.clip();
    try {
      ctx.drawImage(
        drag.ghostAvatarImage,
        drag.ghostX - (r - 2),
        drag.ghostY - (r - 2),
        (r - 2) * 2,
        (r - 2) * 2,
      );
    } catch {
      // Image not loaded — fallback handled by solid circle
    }
    ctx.restore();
  }

  // Name label below ghost
  const nameY = drag.ghostY + r + 16;
  const firstName = drag.ghostName.split(' ')[0] ?? drag.ghostName;
  ctx.fillStyle = '#1e293b';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.roundRect(drag.ghostX - 36, nameY - 8, 72, 16, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(drag.ghostX - 36, nameY - 8, 72, 16, 8);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(firstName, drag.ghostX, nameY);

  ctx.restore();
}

// ── Main draw function ──────────────────────────────────────────────

const ROOM_W = 2000;
const ROOM_H = 1500;

/**
 * Draw the complete scene. Called on every redraw.
 * Pure function — all state is passed in, all output goes to ctx.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  viewport: ViewportTransform,
  interaction: InteractionState,
  canvasWidth: number,
  canvasHeight: number,
  animationTime: number,
): void {
  const degraded = snapshot.employees.length > DEGRADED_THRESHOLD;

  // 1. Clear canvas with background
  drawBackground(ctx, canvasWidth, canvasHeight);

  // 2. Apply viewport transform for all scene drawing
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);

  // 3. Floor grid
  drawFloorGrid(ctx, ROOM_W, ROOM_H);

  // 4. Zone fills and strokes
  drawZones(ctx, snapshot.zones, interaction.drag);

  // 5. Zone labels
  drawZoneLabels(ctx, snapshot.zones);

  // 6. Prefab silhouettes
  drawPrefabs(ctx, snapshot.prefabs, degraded);

  // 7. Employee desk backgrounds
  drawEmployeeDeskBackgrounds(ctx, snapshot.employees, degraded);

  // 8. Employee nodes
  drawEmployees(ctx, snapshot.employees, interaction, degraded, animationTime);

  // 9. Manager presence marker (after employees, before drag ghost)
  if (snapshot.managerMarker) {
    drawManagerMarker(ctx, snapshot.managerMarker);
  }

  // 10. Meeting bubble overlay
  if (snapshot.meetingBubble) {
    drawMeetingBubble(ctx, snapshot.meetingBubble);
  }

  // 11. Drag ghost (topmost interactive layer)
  if (interaction.drag) {
    drawDragGhost(ctx, interaction.drag);
  }

  // Reset transform for any future overlay drawing
  ctx.resetTransform();
}

/**
 * office-2d-canvas-renderer.ts — Thin orchestrator for the 2D office canvas.
 *
 * Responsibilities:
 *  - Own the public `drawScene(ctx, snapshot, transform)` API.
 *  - Own the shared render data types consumed by every layer.
 *  - Delegate actual drawing to the per-layer modules in `./canvas-layers/`.
 *
 * Draw order (back-to-front) mirrors the 7 layers called from `drawScene`:
 *   background → zones → prefabs → employees → ceremony → interactions → drag-overlay.
 *
 * The dpr-aware viewport transform is applied inside `drawBackground` (it needs
 * a dpr-only pass for the initial clear, then switches to world coords for the
 * grid and all downstream layers).
 */

import { drawBackground } from './canvas-layers/draw-background';
import { drawCeremony } from './canvas-layers/draw-ceremony';
import { drawDragOverlay } from './canvas-layers/draw-drag-overlay';
import { drawEmployees } from './canvas-layers/draw-employees';
import { drawInteractions } from './canvas-layers/draw-interactions';
import { drawPrefabs } from './canvas-layers/draw-prefabs';
import { drawZones } from './canvas-layers/draw-zones';
import type { ViewportTransform } from './office-2d-canvas-geometry';

export type { ViewportTransform } from './office-2d-canvas-geometry';

// ── Status colors ─────────────────────────────────────────────────────

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

export function getStatusColor(state: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_COLORS, state)
    ? (STATUS_COLORS[state] as string)
    : DEFAULT_STATUS_COLOR;
}

// ── Render data types ─────────────────────────────────────────────────

export interface SceneSnapshot {
  zones: ReadonlyArray<ZoneRenderData>;
  prefabs: ReadonlyArray<PrefabRenderData>;
  employees: ReadonlyArray<EmployeeRenderData>;
  ceremony: CeremonyRenderData;
  managerMarker: ManagerMarkerData | null;
  meetingBubble: MeetingBubbleData | null;
  interaction: InteractionState;
  animationTime: number;
  canvasSize: { width: number; height: number; devicePixelRatio: number };
}

export interface ZoneRenderData {
  zoneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accentColor: string;
  label: string;
  isInfrastructure: boolean;
}

export interface PrefabRenderData {
  prefabId: string;
  category: string;
  x: number;
  y: number;
  rotation: number;
}

export interface EmployeeRenderData {
  employeeId: string;
  x: number;
  y: number;
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
  x: number;
  y: number;
}

export interface MeetingBubbleData {
  x: number;
  y: number;
  phaseColor: string;
  bubbleText: string;
  participantCount: number;
  waitingLabels: string[];
  extraWaitingCount: number;
}

export interface InteractionState {
  selectedEmployeeId: string | null;
  hoveredEmployeeId: string | null;
  drag: DragRenderState | null;
}

export interface DragRenderState {
  ghostX: number;
  ghostY: number;
  ghostAvatarImage: HTMLImageElement | ImageBitmap | null;
  ghostName: string;
  ghostStatusColor: string;
  sourceZoneId: string;
  hoveredZoneId: string | null;
  dropTargetZoneIds: string[];
}

// ── Legacy / compatibility exports ────────────────────────────────────

/**
 * Evenly spaced positions along a semicircle (π arc) around (cx, cy).
 * Kept exported for consumer compatibility — not called by `drawScene` itself.
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

// ── Orchestrator ──────────────────────────────────────────────────────

/**
 * Draw the complete scene. `drawBackground` installs the dpr-aware world
 * transform; subsequent layers trust it and draw in world coords.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  snapshot: SceneSnapshot,
  transform: ViewportTransform,
): void {
  drawBackground(ctx, snapshot, transform);
  drawZones(ctx, snapshot, transform);
  drawPrefabs(ctx, snapshot, transform);
  drawEmployees(ctx, snapshot, transform);
  drawCeremony(ctx, snapshot, transform);
  drawInteractions(ctx, snapshot, transform);
  drawDragOverlay(ctx, snapshot, transform);
  ctx.resetTransform();
}

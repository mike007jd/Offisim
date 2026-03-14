// ── Scene Visual Feedback ────────────────────────────────────────────
// Manages spotlight, attention, install ghost, route line, and tool overlay systems.
// Extracted from SceneManager to isolate visual feedback from core lifecycle.

import { Graphics } from 'pixi.js';
import { InstallGhostEntity } from '../entities/install-ghost-entity.js';
import { RouteLineEntity } from '../entities/route-line-entity.js';
import type { MotionTokens, PerformanceTier } from '../tokens/motion.js';
import type { OfficeFloorPlan } from '../layout/zone-layout-engine.js';
import type { SceneEntity, SceneLayers } from './types.js';
import { PUPPET_Y_OFFSET } from './scene-entity-manager.js';

/**
 * Manages all visual feedback systems: spotlight, attention, install ghosts,
 * route lines, tool overlay timers, and highlight timers.
 */
export class SceneVisualFeedback {
  /** Active install ghost entities keyed by installTxnId */
  private readonly installGhosts: Map<string, InstallGhostEntity> = new Map();
  /** Pending settle timers keyed by installTxnId -- cleared on destroy */
  private readonly settleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** Route lines keyed by taskRunId/meeting-pid */
  private readonly routeLines: Map<string, RouteLineEntity> = new Map();
  /** Tool overlay auto-clear timers per employee */
  private readonly toolOverlayTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** Highlight auto-clear timers */
  private readonly highlightTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  /** Attention priority queue */
  private readonly attentionRequests: Map<string, { priority: number; timestamp: number }> = new Map();
  /** Spotlight graphics overlay */
  private spotlightGfx: Graphics | null = null;

  private _destroyed = false;

  constructor(
    private readonly getLayers: () => SceneLayers | null,
    private readonly getEntities: () => Map<string, SceneEntity>,
    private readonly getMotion: () => MotionTokens,
    private readonly getPerformanceTier: () => PerformanceTier,
    private readonly getReducedMotion: () => boolean,
    private readonly getFloorPlan: () => OfficeFloorPlan | null,
    private readonly findUnoccupiedWorkstation: () => string | null,
  ) {}

  set destroyed(val: boolean) {
    this._destroyed = val;
  }

  // ── Tool overlay ──

  clearToolOverlayTimer(employeeId: string): void {
    const existing = this.toolOverlayTimers.get(employeeId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.toolOverlayTimers.delete(employeeId);
    }
  }

  showToolOverlay(employeeId: string, toolName: string): void {
    const entity = this.getEntities().get(employeeId);
    if (!entity) return;

    this.clearToolOverlayTimer(employeeId);

    if (!toolName) return; // just clear

    entity.setTask(`\u{1F527} ${toolName}`);
    const timer = setTimeout(() => {
      this.toolOverlayTimers.delete(employeeId);
      entity.setTask(null);
    }, 3000);
    this.toolOverlayTimers.set(employeeId, timer);
  }

  // ── Flash highlight ──

  flashHighlightEntity(entity: SceneEntity, durationMs: number): void {
    entity.setHighlight(true);
    const timer = setTimeout(() => {
      this.highlightTimers.delete(timer);
      if (!this._destroyed) entity.setHighlight(false);
    }, durationMs);
    this.highlightTimers.add(timer);
  }

  // ── Route lines ──

  addRouteLine(id: string, fromEntity: SceneEntity, toEntity: SceneEntity, color: number): void {
    const layers = this.getLayers();
    if (!layers) return;

    const line = new RouteLineEntity(id, color, this.getMotion());
    line.setEndpoints(
      fromEntity.container.x, fromEntity.container.y,
      toEntity.container.x, toEntity.container.y,
    );
    layers.semantic.addChild(line.container);
    this.routeLines.set(id, line);
  }

  addMeetingRouteLines(participantIds: readonly string[], cx: number, cy: number, color: number): void {
    const layers = this.getLayers();
    if (!layers) return;

    for (const pid of participantIds) {
      const entity = this.getEntities().get(pid);
      if (entity) {
        const line = new RouteLineEntity(`meeting-${pid}`, color, this.getMotion());
        line.setEndpoints(entity.container.x, entity.container.y, cx, cy);
        layers.semantic.addChild(line.container);
        this.routeLines.set(`meeting-${pid}`, line);
      }
    }
  }

  removeRouteLine(taskRunId: string): void {
    const line = this.routeLines.get(taskRunId);
    if (line) {
      this.routeLines.delete(taskRunId);
      line.fadeOut();
    }
  }

  getRouteOrigin(): SceneEntity | undefined {
    return this.getEntities().values().next().value;
  }

  // ── Meeting zone ──

  getMeetingZoneCenter(): { cx: number; cy: number } | null {
    const floorPlan = this.getFloorPlan();
    if (!floorPlan) return null;
    const meetingZone = floorPlan.zones.find((z) => z.type === 'meeting_room');
    if (!meetingZone) return null;
    return {
      cx: meetingZone.x + meetingZone.width / 2,
      cy: meetingZone.y + meetingZone.height / 2,
    };
  }

  // ── Install ghost ──

  showInstallGhost(txnId: string): void {
    if (this.installGhosts.has(txnId)) return;
    const layers = this.getLayers();
    const floorPlan = this.getFloorPlan();
    if (!layers || !floorPlan) return;

    const wsId = this.findUnoccupiedWorkstation();
    const pos = wsId ? floorPlan.allWorkstations.get(wsId) : null;

    const x = pos ? pos.x : floorPlan.totalWidth / 2;
    const y = pos ? pos.y + PUPPET_Y_OFFSET : floorPlan.totalHeight / 2;

    const ghost = new InstallGhostEntity({ x, y });
    layers.semantic.addChild(ghost.container);
    this.installGhosts.set(txnId, ghost);
  }

  updateInstallGhostProgress(txnId: string, fraction: number): void {
    const ghost = this.installGhosts.get(txnId);
    if (ghost) ghost.setProgress(fraction);
  }

  settleInstallGhost(txnId: string): void {
    const ghost = this.installGhosts.get(txnId);
    if (!ghost) return;
    this.installGhosts.delete(txnId);
    ghost.settleAsInstalled();
    // Remove from scene after settle animation completes (M1 duration)
    const dur = this.getMotion().M1.duration > 0 ? this.getMotion().M1.duration : 0.6;
    const timerId = setTimeout(() => {
      this.settleTimers.delete(txnId);
      ghost.destroy();
    }, (dur + 0.2) * 1000);
    this.settleTimers.set(txnId, timerId);
  }

  failInstallGhost(txnId: string): void {
    const ghost = this.installGhosts.get(txnId);
    if (!ghost) return;
    this.installGhosts.delete(txnId);
    ghost.failAndRemove();
  }

  // ── Attention / spotlight ──

  requestAttention(entityId: string, priority: number): void {
    this.attentionRequests.set(entityId, { priority, timestamp: Date.now() });
    this.updateSpotlight();
  }

  clearAttention(entityId: string): void {
    this.attentionRequests.delete(entityId);
    this.updateSpotlight();
  }

  private updateSpotlight(): void {
    const layers = this.getLayers();
    if (!layers) return;

    let best: { entityId: string; priority: number; timestamp: number } | null = null;
    for (const [entityId, req] of this.attentionRequests) {
      if (!best || req.priority > best.priority || (req.priority === best.priority && req.timestamp > best.timestamp)) {
        best = { entityId, ...req };
      }
    }

    if (this.spotlightGfx) {
      layers.focus.removeChild(this.spotlightGfx);
      this.spotlightGfx.destroy();
      this.spotlightGfx = null;
    }

    if (!best) return;
    const entity = this.getEntities().get(best.entityId);
    if (!entity) return;
    const tier = this.getPerformanceTier();
    if (tier === 'C' || this.getReducedMotion()) return;

    const gfx = new Graphics();
    gfx.circle(entity.container.x, entity.container.y, 40);
    gfx.fill({ color: 0xfbbf24, alpha: tier === 'B' ? 0.1 : 0.15 });
    layers.focus.addChild(gfx);
    this.spotlightGfx = gfx;
  }

  // ── Cleanup ──

  destroy(): void {
    this._destroyed = true;

    for (const timer of this.toolOverlayTimers.values()) clearTimeout(timer);
    this.toolOverlayTimers.clear();

    for (const timer of this.highlightTimers) clearTimeout(timer);
    this.highlightTimers.clear();

    for (const line of this.routeLines.values()) line.destroy();
    this.routeLines.clear();

    for (const [, timerId] of this.settleTimers) clearTimeout(timerId);
    this.settleTimers.clear();

    for (const ghost of this.installGhosts.values()) ghost.destroy();
    this.installGhosts.clear();

    this.attentionRequests.clear();
    if (this.spotlightGfx) {
      this.spotlightGfx.destroy();
      this.spotlightGfx = null;
    }
  }
}

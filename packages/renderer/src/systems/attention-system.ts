import gsap from 'gsap';
import { Graphics } from 'pixi.js';
import type { SceneEventBus, SceneEntity, SceneLayers } from '../core/types.js';
import type { MotionTokens } from '../tokens/motion.js';

// ── AttentionSystem — ANIM-032 ────────────────────────────────────────────
// Highlights zones / employees with high-priority runtime events.
// One focus at a time; higher priority preempts; auto-clear after duration.

export interface AttentionEvent {
  /** Unique key for this attention request (entityId, txnId, etc.) */
  id: string;
  /** Higher = more important. Ties resolved by timestamp (newer wins). */
  priority: number;
  /** Zone to highlight (zone zoneId, optional) */
  zoneId?: string;
  /** Employee entity to highlight (optional) */
  employeeId?: string;
  /** Auto-clear after this many ms. Default: 5000 */
  duration?: number;
}

/** Internal tracked request — includes timestamp for tie-breaking. */
interface TrackedRequest extends AttentionEvent {
  readonly timestamp: number;
}

/** Runtime indicator ring on an employee container. */
interface EmployeeRing {
  gfx: Graphics;
  tween: gsap.core.Tween | null;
}

/**
 * AttentionSystem — subscribes to high-priority runtime events and drives
 * visual feedback (zone border pulse / employee ring pulse) via GSAP.
 *
 * Lifecycle:
 *   1. Construct with eventBus, layers reference, employees map, and motionTokens.
 *   2. Call activate() to start listening for events.
 *   3. Call deactivate() on scene teardown.
 */
export class AttentionSystem {
  private _currentFocus: TrackedRequest | null = null;
  private readonly requests: Map<string, TrackedRequest> = new Map();
  private clearTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private unsubscribers: (() => void)[] = [];

  /** Active employee ring indicator. Keyed by employeeId. */
  private employeeRings: Map<string, EmployeeRing> = new Map();
  /** Active zone pulse gfx. Keyed by zoneId. */
  private zonePulseGfx: Map<string, Graphics> = new Map();

  constructor(
    private readonly eventBus: SceneEventBus,
    /**
     * Reference to SceneLayers — obtained after mount(), can be null before that.
     * AttentionSystem checks for null before using layers.
     */
    private getLayers: () => SceneLayers | null,
    /** Employee entity map from SceneManager — live reference. */
    private getEmployees: () => Map<string, SceneEntity>,
    private readonly motion: MotionTokens,
  ) {}

  // ── Public API ──────────────────────────────────────────────────

  /** Start listening for attention-worthy runtime events. */
  activate(): void {
    this.unsubscribers.push(
      // employee.blocked → priority 3
      this.eventBus.on('employee.blocked', (event) => {
        const employeeId = (event.payload as { employeeId?: string }).employeeId
          ?? event.entityId;
        this.requestAttention({
          id: `employee-blocked-${employeeId}`,
          priority: 3,
          employeeId,
        });
      }),
    );

    this.unsubscribers.push(
      // install.materializing → priority 2
      this.eventBus.on('install.state.changed', (event) => {
        const payload = event.payload as { next?: string; installTxnId?: string };
        if (payload.next === 'materializing') {
          this.requestAttention({
            id: `install-materializing-${payload.installTxnId ?? event.entityId}`,
            priority: 2,
          });
        } else if (payload.next === 'failed' || payload.next === 'rolled_back') {
          // install.failed → priority 4
          const id = payload.installTxnId ?? event.entityId;
          this.requestAttention({
            id: `install-failed-${id}`,
            priority: 4,
          });
        } else if (payload.next === 'installed' || payload.next === 'cancelled') {
          const id = payload.installTxnId ?? event.entityId;
          this.clearAttentionById(`install-materializing-${id}`);
          this.clearAttentionById(`install-failed-${id}`);
        }
      }),
    );

    this.unsubscribers.push(
      // task.failed → priority 3 (via task.state.changed with next === 'failed')
      this.eventBus.on('task.state.changed', (event) => {
        const payload = event.payload as { next?: string; taskRunId?: string; employeeId?: string };
        if (payload.next === 'failed') {
          const taskId = payload.taskRunId ?? event.entityId;
          this.requestAttention({
            id: `task-failed-${taskId}`,
            priority: 3,
            employeeId: payload.employeeId,
          });
        } else if (payload.next === 'completed' || payload.next === 'cancelled') {
          const taskId = payload.taskRunId ?? event.entityId;
          this.clearAttentionById(`task-failed-${taskId}`);
        }
      }),
    );
  }

  /** Stop listening and clear all visual indicators. */
  deactivate(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this._destroyAllVisuals();
    for (const timer of this.clearTimers.values()) clearTimeout(timer);
    this.clearTimers.clear();
    this.requests.clear();
    this._currentFocus = null;
  }

  /** Current active attention focus, or null. */
  getCurrentFocus(): AttentionEvent | null {
    return this._currentFocus;
  }

  /**
   * Manually request attention. Higher priority preempts current focus.
   * Ties (equal priority) resolved by timestamp (newer wins).
   */
  requestAttention(event: AttentionEvent): void {
    const tracked: TrackedRequest = { ...event, timestamp: Date.now() };
    this.requests.set(event.id, tracked);

    // Schedule auto-clear
    this._scheduleAutoClear(event.id, event.duration ?? 5000);

    this._recomputeFocus();
  }

  /** Clear attention for a specific id. */
  clearAttention(): void {
    // Clear all
    for (const id of this.requests.keys()) {
      this.clearAttentionById(id);
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private clearAttentionById(id: string): void {
    const existing = this.clearTimers.get(id);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.clearTimers.delete(id);
    }
    this.requests.delete(id);
    this._recomputeFocus();
  }

  private _scheduleAutoClear(id: string, durationMs: number): void {
    // Cancel any existing timer for this id
    const existing = this.clearTimers.get(id);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.clearTimers.delete(id);
      this.requests.delete(id);
      this._recomputeFocus();
    }, durationMs);
    this.clearTimers.set(id, timer);
  }

  private _recomputeFocus(): void {
    let best: TrackedRequest | null = null;
    for (const req of this.requests.values()) {
      if (
        !best ||
        req.priority > best.priority ||
        (req.priority === best.priority && req.timestamp > best.timestamp)
      ) {
        best = req;
      }
    }

    const prevFocusId = this._currentFocus?.id ?? null;
    this._currentFocus = best;

    if (best?.id !== prevFocusId) {
      // Focus changed — tear down old visuals, build new ones
      this._destroyAllVisuals();
      if (best) {
        this._buildVisuals(best);
        this.eventBus.emit({
          type: 'attention.focused',
          entityId: best.employeeId ?? best.zoneId ?? best.id,
          entityType: 'employee',
          companyId: '',
          timestamp: Date.now(),
          payload: { attentionId: best.id, priority: best.priority },
        });
      } else {
        this.eventBus.emit({
          type: 'attention.cleared',
          entityId: '',
          entityType: 'employee',
          companyId: '',
          timestamp: Date.now(),
          payload: {},
        });
      }
    }
  }

  private _buildVisuals(req: TrackedRequest): void {
    const durationMs = req.duration ?? 5000;
    const pulseDuration = Math.min(durationMs / 1000, 2.0); // seconds per cycle, capped

    if (req.employeeId) {
      this._buildEmployeeRing(req.employeeId, pulseDuration);
    }

    if (req.zoneId) {
      this._buildZonePulse(req.zoneId, pulseDuration);
    }
  }

  private _buildEmployeeRing(employeeId: string, pulseDurationSec: number): void {
    const layers = this.getLayers();
    const entity = this.getEmployees().get(employeeId);
    if (!layers || !entity) return;

    const gfx = new Graphics();
    const cx = entity.container.x;
    const cy = entity.container.y;

    // Pulsing ring — drawn at employee center
    gfx.circle(cx, cy, 36);
    gfx.stroke({ color: 0xef4444, alpha: 0.9, width: 2 });
    gfx.alpha = 0;

    layers.focus.addChild(gfx);

    const pulseCount = 3;
    const halfCycle = pulseDurationSec / (pulseCount * 2);

    const tween = gsap.to(gfx, {
      alpha: 0.85,
      duration: halfCycle,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: pulseCount * 2 - 1,
      onComplete: () => {
        gsap.to(gfx, { alpha: 0, duration: this.motion.M2.duration, ease: this.motion.M2.ease });
      },
    });

    this.employeeRings.set(employeeId, { gfx, tween });
  }

  private _buildZonePulse(zoneId: string, pulseDurationSec: number): void {
    const layers = this.getLayers();
    if (!layers) return;

    // We don't have direct zone bounds here — emit an event so FloorLayer can react.
    // But we can still draw a zone-level overlay if zone bounds are accessible.
    // For now, draw a named gfx placeholder (dimensions unknown without floor plan access).
    // Zone pulse is best-effort; if zone is unknown, skip drawing but still track.
    const gfx = new Graphics();
    gfx.alpha = 0;

    // Tag for later identification
    (gfx as Graphics & { _attentionZoneId?: string })._attentionZoneId = zoneId;

    layers.focus.addChild(gfx);
    this.zonePulseGfx.set(zoneId, gfx);

    const pulseCount = 3;
    const halfCycle = pulseDurationSec / (pulseCount * 2);

    gsap.to(gfx, {
      alpha: 0.4,
      duration: halfCycle,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: pulseCount * 2 - 1,
      onComplete: () => {
        gsap.to(gfx, { alpha: 0, duration: this.motion.M2.duration, ease: this.motion.M2.ease });
      },
    });
  }

  /**
   * Rebuild employee ring visuals for the given zone bounds (called by SceneManager
   * after floor plan is available).
   */
  updateZoneBounds(zoneId: string, x: number, y: number, width: number, height: number): void {
    const gfx = this.zonePulseGfx.get(zoneId);
    if (!gfx) return;

    // Re-draw zone border now that we have bounds
    gfx.clear();
    const radius = Math.round(Math.min(width, height) * 0.04);
    gfx.roundRect(x, y, width, height, radius);
    gfx.stroke({ color: 0xef4444, alpha: 0.9, width: 2 });
  }

  private _destroyAllVisuals(): void {
    const layers = this.getLayers();

    for (const [, ring] of this.employeeRings) {
      ring.tween?.kill();
      gsap.killTweensOf(ring.gfx);
      if (layers) layers.focus.removeChild(ring.gfx);
      ring.gfx.destroy();
    }
    this.employeeRings.clear();

    for (const [, gfx] of this.zonePulseGfx) {
      gsap.killTweensOf(gfx);
      if (layers) layers.focus.removeChild(gfx);
      gfx.destroy();
    }
    this.zonePulseGfx.clear();
  }
}

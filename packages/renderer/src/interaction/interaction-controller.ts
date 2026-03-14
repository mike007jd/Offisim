import gsap from 'gsap';
import type { Container, FederatedPointerEvent } from 'pixi.js';
import type { SceneEntity, SceneEventBus } from '../core/types.js';
import type { WorkstationBounds } from '../layers/floor-layer.js';
import type { MotionTokens } from '../tokens/motion.js';

/**
 * Result emitted when a drag-drop operation completes.
 * If `targetWorkstationId` is null the entity snapped back (no valid target).
 */
export interface DragResult {
  entityId: string;
  targetWorkstationId: string | null;
  /** True when the entity was dropped inside the rest area bounds (and not on a workstation). */
  droppedInRestArea?: boolean;
}

/** Internal state tracked during an active drag. */
interface DragState {
  entityId: string;
  entity: SceneEntity;
  /** Position before drag started — for snap-back. */
  startX: number;
  startY: number;
  /** Pointer offset relative to entity origin at pointerdown. */
  offsetX: number;
  offsetY: number;
}

/**
 * Handles drag-drop interactions for employee entities in the office scene.
 *
 * Design:
 * - `pointerdown` on entity → begin drag, capture offset
 * - `pointermove` on stage → update entity position, highlight workstation hover
 * - `pointerup` → if over valid workstation emit drop; else GSAP snap-back (M2)
 * - `pointerup` without movement → treated as a click, fires onSelect callback
 * - `Escape` key → cancel drag, snap-back
 *
 * PixiJS 8 specifics:
 * - `eventMode = 'static'` (not `interactive = true`)
 * - Stage-level `pointermove`/`pointerup` for global capture
 */
export class InteractionController {
  private dragging: DragState | null = null;
  private _enabled = false;
  /** Currently highlighted workstation (for clearing on move). */
  private hoveredWorkstation: string | null = null;
  /** Optional bounding box of the rest area zone (for drop detection). */
  restAreaBounds: { x: number; y: number; width: number; height: number } | null = null;
  /** Bound handlers — stored for cleanup. */
  private boundHandlers = {
    pointerMove: (e: FederatedPointerEvent) => this.handlePointerMove(e),
    pointerUp: (e: FederatedPointerEvent) => this.handlePointerUp(e),
    keyDown: (e: KeyboardEvent) => this.handleKeyDown(e),
    stagePointerDown: () => this.handleStagePointerDown(),
  };
  /** Per-entity pointerdown handlers for cleanup. */
  private entityHandlers: Map<string, (e: FederatedPointerEvent) => void> = new Map();
  /** Whether the current pointerdown originated on an entity (vs background). */
  private pointerDownOnEntity = false;

  constructor(
    private readonly stage: Container,
    private readonly entities: Map<string, SceneEntity>,
    private _workstationBounds: Map<string, WorkstationBounds>,
    _eventBus: SceneEventBus,
    private readonly motion: MotionTokens,
    private readonly onDrop: (result: DragResult) => void,
    private readonly onHighlight?: (workstationId: string, on: boolean) => void,
    private readonly onSelect?: (entityId: string) => void,
    private readonly onDeselect?: () => void,
  ) {}

  /** Update workstation bounds (e.g. after rebuildLayout). */
  set workstationBounds(bounds: Map<string, WorkstationBounds>) {
    this._workstationBounds = bounds;
  }

  /** Whether drag-drop is currently enabled. */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Whether a drag is currently in progress. */
  get isDragging(): boolean {
    return this.dragging !== null;
  }

  /** Attach pointer events to each entity and the stage. */
  enable(): void {
    if (this._enabled) return;
    this._enabled = true;

    // Make each entity draggable
    for (const [id, entity] of this.entities) {
      entity.container.eventMode = 'static';
      entity.container.cursor = 'grab';

      const handler = (e: FederatedPointerEvent) => this.handlePointerDown(e, id);
      entity.container.on('pointerdown', handler);
      this.entityHandlers.set(id, handler);
    }

    // Stage-level move/up for global capture
    this.stage.eventMode = 'static';
    this.stage.on('pointermove', this.boundHandlers.pointerMove);
    this.stage.on('pointerup', this.boundHandlers.pointerUp);
    this.stage.on('pointerupoutside', this.boundHandlers.pointerUp);
    this.stage.on('pointerdown', this.boundHandlers.stagePointerDown);

    // Keyboard escape
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('keydown', this.boundHandlers.keyDown);
    }
  }

  /** Detach all pointer events (leaves entities in place). */
  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;

    // Cancel any in-progress drag
    if (this.dragging) {
      this.cancelDrag();
    }

    // Remove entity handlers
    for (const [id, handler] of this.entityHandlers) {
      const entity = this.entities.get(id);
      if (entity) {
        entity.container.off('pointerdown', handler);
        entity.container.cursor = 'default';
      }
    }
    this.entityHandlers.clear();

    // Remove stage handlers
    this.stage.off('pointermove', this.boundHandlers.pointerMove);
    this.stage.off('pointerup', this.boundHandlers.pointerUp);
    this.stage.off('pointerupoutside', this.boundHandlers.pointerUp);
    this.stage.off('pointerdown', this.boundHandlers.stagePointerDown);

    // Remove keyboard handler
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('keydown', this.boundHandlers.keyDown);
    }
  }

  /** Full cleanup — disable + release references. */
  destroy(): void {
    this.disable();
  }

  /**
   * Register a newly added entity for drag-drop (called when employees are added
   * to the scene after the InteractionController was already enabled).
   */
  registerEntity(id: string, entity: SceneEntity): void {
    if (!this._enabled) return;

    entity.container.eventMode = 'static';
    entity.container.cursor = 'grab';

    const handler = (e: FederatedPointerEvent) => this.handlePointerDown(e, id);
    entity.container.on('pointerdown', handler);
    this.entityHandlers.set(id, handler);
  }

  /**
   * Unregister an entity from drag-drop (called when employees are removed).
   */
  unregisterEntity(id: string): void {
    const handler = this.entityHandlers.get(id);
    if (!handler) return;

    const entity = this.entities.get(id);
    if (entity) {
      entity.container.off('pointerdown', handler);
      entity.container.cursor = 'default';
    }
    this.entityHandlers.delete(id);

    // If this entity was being dragged, cancel
    if (this.dragging?.entityId === id) {
      this.cancelDrag();
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private handlePointerDown(e: FederatedPointerEvent, entityId: string): void {
    if (this.dragging) return; // Only one drag at a time

    const entity = this.entities.get(entityId);
    if (!entity) return;

    // Convert global pointer position to stage-local coordinates.
    // Entities live inside worldContainer which has a position offset
    // (from centerWorld), so we must use toLocal() for correct mapping.
    const localPos = this.stage.toLocal(e.global);
    this.dragging = {
      entityId,
      entity,
      startX: entity.container.x,
      startY: entity.container.y,
      offsetX: entity.container.x - localPos.x,
      offsetY: entity.container.y - localPos.y,
    };

    // Track that this pointerdown hit an entity (so stage pointerdown won't deselect)
    this.pointerDownOnEntity = true;

    entity.container.cursor = 'grabbing';
    entity.container.alpha = 0.8;

    e.stopPropagation();
  }

  /**
   * Called on stage pointerdown (background click — not on an entity).
   * If not on an entity, signal deselection.
   */
  private handleStagePointerDown(): void {
    if (!this.pointerDownOnEntity) {
      this.onDeselect?.();
    }
    // Reset flag — will be set again if next pointerdown hits an entity
    this.pointerDownOnEntity = false;
  }

  private handlePointerMove(e: FederatedPointerEvent): void {
    if (!this.dragging) return;

    const { entity, offsetX, offsetY } = this.dragging;
    const localPos = this.stage.toLocal(e.global);

    // Update entity position in stage-local coordinates (accounts for worldContainer offset)
    entity.container.x = localPos.x + offsetX;
    entity.container.y = localPos.y + offsetY;

    // Check workstation hover for highlight
    const wsId = this.findWorkstationAt(entity.container.x, entity.container.y);

    if (wsId !== this.hoveredWorkstation) {
      // Clear previous highlight
      if (this.hoveredWorkstation) {
        this.onHighlight?.(this.hoveredWorkstation, false);
      }
      // Set new highlight
      if (wsId) {
        this.onHighlight?.(wsId, true);
      }
      this.hoveredWorkstation = wsId;
    }
  }

  private handlePointerUp(_e: FederatedPointerEvent): void {
    if (!this.dragging) return;

    const { entityId, entity, startX, startY } = this.dragging;
    const targetWs = this.findWorkstationAt(entity.container.x, entity.container.y);

    // Clear highlight
    if (this.hoveredWorkstation) {
      this.onHighlight?.(this.hoveredWorkstation, false);
      this.hoveredWorkstation = null;
    }

    // Detect click: pointer released very close to start position → select
    const dx = Math.abs(entity.container.x - startX);
    const dy = Math.abs(entity.container.y - startY);
    const isClick = dx < 4 && dy < 4;

    if (isClick) {
      // Snap back to original position (no drag occurred)
      entity.container.cursor = 'grab';
      entity.container.alpha = 1;
      entity.container.x = startX;
      entity.container.y = startY;
      this.dragging = null;
      this.onSelect?.(entityId);
    } else if (targetWs) {
      // Successful drop on workstation — notify callback
      entity.container.cursor = 'grab';
      entity.container.alpha = 1;
      this.dragging = null;
      this.onDrop({ entityId, targetWorkstationId: targetWs });
    } else if (this.isInRestArea(entity.container.x, entity.container.y)) {
      // Dropped in rest area — notify callback
      entity.container.cursor = 'grab';
      entity.container.alpha = 1;
      this.dragging = null;
      this.onDrop({ entityId, targetWorkstationId: null, droppedInRestArea: true });
    } else {
      // No valid target — snap back
      this.snapBack();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.dragging) {
      this.cancelDrag();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Find the workstation whose bounds contain the given point. */
  private findWorkstationAt(x: number, y: number): string | null {
    for (const [wsId, bounds] of this._workstationBounds) {
      if (
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height
      ) {
        return wsId;
      }
    }
    return null;
  }

  /** Check if a point is within the rest area bounds. */
  private isInRestArea(x: number, y: number): boolean {
    if (!this.restAreaBounds) return false;
    const b = this.restAreaBounds;
    return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
  }

  /** Cancel drag and snap entity back to original position. */
  private cancelDrag(): void {
    // Clear highlight
    if (this.hoveredWorkstation) {
      this.onHighlight?.(this.hoveredWorkstation, false);
      this.hoveredWorkstation = null;
    }

    this.snapBack();
  }

  /** Snap the dragged entity back to its start position with GSAP M2 animation. */
  private snapBack(): void {
    if (!this.dragging) return;

    const { entity, startX, startY } = this.dragging;
    this.dragging = null;

    const { duration, ease } = this.motion.M2;
    entity.container.cursor = 'grab';

    if (duration > 0) {
      gsap.to(entity.container, {
        x: startX,
        y: startY,
        alpha: 1,
        duration,
        ease,
      });
    } else {
      // Reduced motion: snap immediately
      entity.container.x = startX;
      entity.container.y = startY;
      entity.container.alpha = 1;
    }
  }
}

// ── Scene Manager ────────────────────────────────────────────────────
// Orchestrator for the office scene. Delegates to:
//   - SceneEntityManager: entity creation, layout, positioning
//   - SceneEventHandler:  EventBus subscriptions
//   - SceneVisualFeedback: spotlight, route lines, install ghosts, overlays
//
// This file owns the PixiJS Application lifecycle, camera, interaction
// controller, and the AttentionSystem.

import { Application, Container } from 'pixi.js';
import { CameraController } from '../interaction/camera-controller.js';
import { InteractionController } from '../interaction/interaction-controller.js';
import { FloorLayer } from '../layers/floor-layer.js';
import { computeFloorPlan } from '../layout/zone-layout-engine.js';
import { AttentionSystem } from '../systems/attention-system.js';
import { RD_COMPANY_ZONES } from '../tokens/departments.js';
import {
  type MotionTokens,
  type PerformanceTier,
  getMotionForTier,
} from '../tokens/motion.js';
import type {
  EmployeeSeed,
  LayerName,
  NodeVisualMapping,
  PrefabSeed,
  SceneEntity,
  SceneEntityType,
  SceneEventBus,
  SceneLayers,
  SceneManagerOptions,
} from './types.js';
import { DEFAULT_EMPLOYEES, DEFAULT_NODE_VISUAL_MAP, LAYER_NAMES } from './types.js';
import type { CharacterConfig } from '../puppet/types.js';
import { SceneEntityManager } from './scene-entity-manager.js';
import { SceneEventHandler, type SceneManagerDelegate } from './scene-event-handler.js';
import { SceneVisualFeedback } from './scene-visual-feedback.js';

export class SceneManager implements SceneManagerDelegate {
  private app: Application | null = null;
  private readonly container: HTMLElement;
  private readonly eventBus: SceneEventBus;
  private readonly employees: EmployeeSeed[];
  private readonly prefabs: PrefabSeed[];
  private readonly nodeVisualMap: Record<string, NodeVisualMapping>;
  private _reducedMotion: boolean;
  private _destroyed = false;

  private layers: SceneLayers | null = null;
  private readonly entityStyle: SceneEntityType;
  private floorLayer: FloorLayer | null = null;
  private camera: CameraController | null = null;
  private _performanceTier: PerformanceTier = 'A';
  private attentionSystem: AttentionSystem | null = null;
  private interactionController: InteractionController | null = null;
  private _selectedEmployeeId: string | null = null;
  /** Debounce timer for rebuildLayout after batch employee additions via events */
  private _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: (() => void)[] = [];

  // ── Sub-managers ──
  private entityManager!: SceneEntityManager;
  private eventHandler!: SceneEventHandler;
  private visualFeedback!: SceneVisualFeedback;

  constructor(options: SceneManagerOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.employees = options.employees ?? DEFAULT_EMPLOYEES;
    this.prefabs = options.prefabs ?? [];
    this._reducedMotion = options.reducedMotion ?? false;
    this.nodeVisualMap = options.nodeVisualMap ?? DEFAULT_NODE_VISUAL_MAP;
    this.entityStyle = options.entityStyle ?? 'employee';
  }

  get motion(): MotionTokens {
    if (this._reducedMotion) return getMotionForTier('C');
    return getMotionForTier(this._performanceTier);
  }

  set reducedMotion(value: boolean) {
    this._reducedMotion = value;
  }

  set performanceTier(tier: PerformanceTier) {
    this._performanceTier = tier;
  }

  // ── Mount ──

  async mount(): Promise<void> {
    if (this.app || this._destroyed) return;

    const app = new Application();
    await app.init({
      resizeTo: this.container,
      background: 0x111827,
      antialias: true,
      resolution: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1,
      autoDensity: true,
    });

    if (this._destroyed) {
      app.destroy(true);
      return;
    }

    this.container.appendChild(app.canvas as HTMLCanvasElement);
    this.app = app;

    // ── Build scene graph ──
    const worldContainer = new Container();
    app.stage.addChild(worldContainer);
    const layersObj = {} as Record<string, Container>;
    for (const name of LAYER_NAMES) {
      const layer = new Container();
      layersObj[name] = layer;
      worldContainer.addChild(layer);
    }
    this.layers = layersObj as SceneLayers;

    // ── Initialize sub-managers ──
    this.entityManager = new SceneEntityManager(
      this.layers.entity,
      () => this.motion,
      this.entityStyle,
      this.layers.furniture,
    );

    this.visualFeedback = new SceneVisualFeedback(
      () => this.layers,
      () => this.entityManager.employeeEntities,
      () => this.motion,
      () => this._performanceTier,
      () => this._reducedMotion,
      () => this.entityManager.currentFloorPlan,
      () => this.entityManager.findUnoccupiedWorkstation(),
    );

    this.eventHandler = new SceneEventHandler(
      this.eventBus,
      this,
      this.nodeVisualMap,
      this.entityManager.prefabEventRouter,
    );

    // ── Compute floor plan from employees ──
    const employeeCounts = this.entityManager.computeDepartmentCounts(this.employees);
    this.entityManager.currentFloorPlan = computeFloorPlan(RD_COMPANY_ZONES, employeeCounts);
    const floorPlan = this.entityManager.currentFloorPlan!;

    // ── Floor layer (L0) ──
    this.floorLayer = new FloorLayer(floorPlan);
    this.layers.floor.addChild(this.floorLayer.container);

    // ── Camera controller ──
    this.camera = new CameraController({
      stage: app.stage,
      world: worldContainer,
      floorWidth: floorPlan.totalWidth,
      floorHeight: floorPlan.totalHeight,
    });

    // ── Compute rest area seats (before placing entities so assignToRestArea works) ──
    this.entityManager.initRestAreaSeats(this.employees.length);

    // ── Employee entities (L2) ──
    this.entityManager.placeInitialEmployees(this.employees);

    // ── Prefab instances (L1 — furniture layer) ──
    if (this.prefabs.length > 0) {
      this.entityManager.placeInitialPrefabs(this.prefabs);
    }

    // ── Interaction controller ──
    this.interactionController = new InteractionController(
      app.stage,
      this.entityManager.employeeEntities,
      this.floorLayer.getWorkstationBounds(),
      this.eventBus,
      this.motion,
      (result) => {
        if (result.targetWorkstationId) {
          this.entityManager.moveEntityToWorkstation(result.entityId, result.targetWorkstationId);
          this.eventBus.emit({
            type: 'employee.workstation.drop-requested',
            entityId: result.entityId,
            entityType: 'employee',
            companyId: '',
            timestamp: Date.now(),
            payload: {
              employeeId: result.entityId,
              targetWorkstationId: result.targetWorkstationId,
            },
          });
        } else if (result.droppedInRestArea) {
          this.entityManager.assignToRestArea(result.entityId);
          this.eventBus.emit({
            type: 'employee.workstation.drop-requested',
            entityId: result.entityId,
            entityType: 'employee',
            companyId: '',
            timestamp: Date.now(),
            payload: {
              employeeId: result.entityId,
              targetWorkstationId: null,
            },
          });
        }
      },
      (wsId, on) => {
        this.floorLayer?.setWorkstationHighlight(wsId, on);
      },
      (entityId) => {
        this.selectEmployee(entityId);
      },
      () => {
        this.deselectAll();
      },
    );
    this.interactionController.enable();

    // Set rest area bounds for interaction controller
    const restZone = floorPlan.zones.find((z) => z.type === 'rest_area');
    if (restZone && this.interactionController) {
      this.interactionController.restAreaBounds = {
        x: restZone.x,
        y: restZone.y,
        width: restZone.width,
        height: restZone.height,
      };
    }

    // ── Camera: fit to view + attach events ──
    const { width, height } = app.screen;
    this.camera.fitToView(width, height);
    this.attachCameraEvents(app);

    // ── AttentionSystem ──
    this.attentionSystem = new AttentionSystem(
      this.eventBus,
      () => this.layers,
      () => this.entityManager.employeeEntities,
      this.motion,
    );
    this.attentionSystem.activate();

    this.eventHandler.subscribeEvents();
  }

  // ── SceneManagerDelegate implementation ──

  addEmployee(
    id: string,
    name: string,
    entityType: SceneEntityType = 'employee',
    roleSlug?: string,
    characterConfig?: CharacterConfig,
  ): boolean {
    if (!this.app || !this.floorLayer || !this.layers || !this.entityManager.currentFloorPlan) return false;
    const result = this.entityManager.addEmployee(id, name, entityType, roleSlug, characterConfig);
    if (result) {
      this.interactionController?.registerEntity(id, this.entityManager.employeeEntities.get(id)!);
    }
    return result;
  }

  removeEmployee(id: string): boolean {
    this.visualFeedback.clearToolOverlayTimer(id);
    return this.entityManager.removeEmployee(id);
  }

  moveEntityToWorkstation(entityId: string, workstationId: string): void {
    this.entityManager.moveEntityToWorkstation(entityId, workstationId);
  }

  getEntity(id: string): SceneEntity | undefined {
    return this.entityManager.employeeEntities.get(id);
  }

  getAllEntities(): Map<string, SceneEntity> {
    return this.entityManager.employeeEntities;
  }

  unregisterEntity(id: string): void {
    this.interactionController?.unregisterEntity(id);
  }

  requestAttention(entityId: string, priority: number): void {
    this.visualFeedback.requestAttention(entityId, priority);
  }

  clearAttention(entityId: string): void {
    this.visualFeedback.clearAttention(entityId);
  }

  flashHighlightEntity(entity: SceneEntity, durationMs: number): void {
    this.visualFeedback.flashHighlightEntity(entity, durationMs);
  }

  showToolOverlay(employeeId: string, toolName: string): void {
    this.visualFeedback.showToolOverlay(employeeId, toolName);
  }

  addRouteLine(id: string, fromEntity: SceneEntity, toEntity: SceneEntity, color: number): void {
    this.visualFeedback.addRouteLine(id, fromEntity, toEntity, color);
  }

  addMeetingRouteLines(participantIds: readonly string[], cx: number, cy: number, color: number): void {
    this.visualFeedback.addMeetingRouteLines(participantIds, cx, cy, color);
  }

  removeRouteLine(taskRunId: string): void {
    this.visualFeedback.removeRouteLine(taskRunId);
  }

  getMeetingZoneCenter(): { cx: number; cy: number } | null {
    return this.visualFeedback.getMeetingZoneCenter();
  }

  getRouteOrigin(): SceneEntity | undefined {
    return this.visualFeedback.getRouteOrigin();
  }

  showInstallGhost(txnId: string): void {
    this.visualFeedback.showInstallGhost(txnId);
  }

  updateInstallGhostProgress(txnId: string, fraction: number): void {
    this.visualFeedback.updateInstallGhostProgress(txnId, fraction);
  }

  settleInstallGhost(txnId: string): void {
    this.visualFeedback.settleInstallGhost(txnId);
  }

  failInstallGhost(txnId: string): void {
    this.visualFeedback.failInstallGhost(txnId);
  }

  setSelectedEmployeeId(id: string | null): void {
    this._selectedEmployeeId = id;
  }

  setPerformanceTier(tier: PerformanceTier): void {
    this._performanceTier = tier;
  }

  scheduleRebuild(): void {
    if (this._rebuildTimer) clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      this.rebuildLayout();
    }, 100);
  }

  // ── Public API (non-delegate) ──

  /** Assign an employee to the next free rest-area seat. */
  assignToRestArea(entityId: string): void {
    this.entityManager.assignToRestArea(entityId);
  }

  /** Remove an employee from rest area tracking. */
  removeFromRestArea(entityId: string): void {
    this.entityManager.removeFromRestArea(entityId);
  }

  /** Check if an employee is in the rest area. */
  isInRestArea(entityId: string): boolean {
    return this.entityManager.isInRestArea(entityId);
  }

  /** Number of rest area seats available. */
  get restAreaSeatCount(): number {
    return this.entityManager.restAreaSeatCount;
  }

  /** Number of occupied rest area seats. */
  get restAreaOccupiedCount(): number {
    return this.entityManager.restAreaOccupiedCount;
  }

  /** Get the bounding box of the rest area zone, if it exists. */
  getRestAreaBounds(): { x: number; y: number; width: number; height: number } | null {
    const floorPlan = this.entityManager.currentFloorPlan;
    if (!floorPlan) return null;
    const restZone = floorPlan.zones.find((z) => z.type === 'rest_area');
    if (!restZone) return null;
    return { x: restZone.x, y: restZone.y, width: restZone.width, height: restZone.height };
  }

  get employeeCount(): number {
    return this.entityManager.employeeEntities.size;
  }

  get employeeIds(): string[] {
    return [...this.entityManager.employeeEntities.keys()];
  }

  /** Currently selected employee ID, or null if nothing is selected. */
  get selectedEmployeeId(): string | null {
    return this._selectedEmployeeId;
  }

  /** Debug helper -- returns position and role of each employee entity. */
  get employeeDebugInfo(): Array<{ id: string; x: number; y: number; roleSlug: string | undefined }> {
    return this.entityManager.employeeDebugInfo;
  }

  /**
   * Select an employee programmatically (reverse direction: DOM -> scene).
   * Focuses the camera on the employee, draws a selection ring, and emits
   * `ui.selection.changed` with `source: 'panel'` so the DOM panel updates too.
   */
  selectEmployee(employeeId: string): void {
    const entity = this.entityManager.employeeEntities.get(employeeId);
    if (!entity) return;

    // Clear previous selection ring (if any)
    if (this._selectedEmployeeId && this._selectedEmployeeId !== employeeId) {
      const prev = this.entityManager.employeeEntities.get(this._selectedEmployeeId);
      if (prev) prev.setHighlight(false);
    }

    this._selectedEmployeeId = employeeId;
    entity.setHighlight(true);

    // Focus camera on the employee
    if (this.camera && this.app) {
      this.camera.focusEmployee(
        { x: entity.container.x, y: entity.container.y },
        this.app.screen.width,
        this.app.screen.height,
      );
    }

    // Emit selection event (source: 'scene') so DOM panels can react
    this.eventBus.emit({
      type: 'ui.selection.changed',
      entityId: employeeId,
      entityType: 'employee',
      companyId: '',
      timestamp: Date.now(),
      payload: {
        entityId: employeeId,
        entityType: 'employee',
        source: 'scene',
      } satisfies import('@aics/shared-types').UiSelectionPayload,
    });
  }

  /**
   * Deselect all employees.
   * Clears selection rings and emits `ui.selection.changed` with `entityId: null`.
   */
  deselectAll(): void {
    if (this._selectedEmployeeId) {
      const prev = this.entityManager.employeeEntities.get(this._selectedEmployeeId);
      if (prev) prev.setHighlight(false);
    }
    this._selectedEmployeeId = null;

    this.eventBus.emit({
      type: 'ui.selection.changed',
      entityId: '',
      entityType: 'employee',
      companyId: '',
      timestamp: Date.now(),
      payload: {
        entityId: null,
        entityType: 'employee',
        source: 'scene',
      } satisfies import('@aics/shared-types').UiSelectionPayload,
    });
  }

  rebuildLayout(): void {
    if (!this.app || !this.layers || this._destroyed) return;

    // Delegate core layout to entity manager
    this.entityManager.rebuildLayout();
    const floorPlan = this.entityManager.currentFloorPlan;
    if (!floorPlan) return;

    // Rebuild floor layer (L0)
    if (this.floorLayer) {
      this.layers.floor.removeChild(this.floorLayer.container);
      this.floorLayer.container.destroy({ children: true });
    }
    this.floorLayer = new FloorLayer(floorPlan);
    this.layers.floor.addChild(this.floorLayer.container);

    // Update camera + interaction controller
    if (this.camera) {
      this.camera.floorWidth = floorPlan.totalWidth;
      this.camera.floorHeight = floorPlan.totalHeight;
      const { width, height } = this.app.screen;
      this.camera.fitToView(width, height);
    }
    if (this.interactionController && this.floorLayer) {
      this.interactionController.workstationBounds = this.floorLayer.getWorkstationBounds();
      const restZone = floorPlan.zones.find((z) => z.type === 'rest_area');
      if (restZone) {
        this.interactionController.restAreaBounds = {
          x: restZone.x, y: restZone.y, width: restZone.width, height: restZone.height,
        };
      }
    }
  }

  // ── Destroy ──

  destroy(): void {
    this._destroyed = true;
    if (this._rebuildTimer) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
    }

    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    if (this.eventHandler) {
      this.eventHandler.destroy();
    }

    if (this.interactionController) {
      this.interactionController.destroy();
      this.interactionController = null;
    }

    if (this.visualFeedback) {
      this.visualFeedback.destroy();
    }

    if (this.entityManager) {
      this.entityManager.destroy();
    }

    this.floorLayer = null;
    this.camera = null;
    this.layers = null;

    if (this.attentionSystem) {
      this.attentionSystem.deactivate();
      this.attentionSystem = null;
    }

    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }

  addToLayer(layer: LayerName, child: Container): boolean {
    if (!this.layers) return false;
    this.layers[layer].addChild(child);
    return true;
  }

  // ── Camera events ──

  private attachCameraEvents(app: Application): void {
    const canvas = app.canvas as HTMLCanvasElement;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.camera?.onWheel(e.deltaY, e.offsetX, e.offsetY, app.screen.width, app.screen.height);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    this.unsubscribers.push(() => canvas.removeEventListener('wheel', onWheel));

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        this.camera?.onPanStart(e.clientX, e.clientY);
      }
    };
    const onMouseMove = (e: MouseEvent) => {
      this.camera?.onPanMove(e.clientX, e.clientY, app.screen.width, app.screen.height);
    };
    const onMouseUp = () => {
      this.camera?.onPanEnd();
    };
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    this.unsubscribers.push(() => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
    });

    const handleResize = () => {
      this.camera?.fitToView(app.screen.width, app.screen.height);
    };
    app.renderer.on('resize', handleResize);
    const renderer = app.renderer;
    this.unsubscribers.push(() => renderer.off('resize', handleResize));
  }
}

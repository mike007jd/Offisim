import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeInstalledPayload,
  EmployeeStatePayload,
  EmployeeWorkstationChangedPayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  McpToolCalledPayload,
  MeetingStatePayload,
  ReportStatePayload,
  TaskAssignmentPayload,
} from '@aics/shared-types';
import gsap from 'gsap';
import { Application, Container, Graphics } from 'pixi.js';
import { InstallGhostEntity } from '../entities/install-ghost-entity.js';
import { RouteLineEntity } from '../entities/route-line-entity.js';
import { CameraController } from '../interaction/camera-controller.js';
import { InteractionController } from '../interaction/interaction-controller.js';
import { FloorLayer } from '../layers/floor-layer.js';
import { computeFloorPlan, computeRestAreaSeats, type OfficeFloorPlan } from '../layout/zone-layout-engine.js';
import { EmployeePuppet } from '../puppet/employee-puppet.js';
import { LobsterPuppet } from '../puppet/lobster-puppet.js';
import type { CharacterConfig } from '../puppet/types.js';
import { DEFAULT_CHARACTER_CONFIGS, PUPPET } from '../puppet/types.js';
import { AttentionSystem } from '../systems/attention-system.js';
import { STATE_COLORS } from '../tokens/colors.js';
import { resolveEmployeeDepartment, RD_COMPANY_ZONES } from '../tokens/departments.js';
import {
  type MotionBucket,
  type MotionTokens,
  type PerformanceTier,
  getMotionForTier,
} from '../tokens/motion.js';
import type {
  EmployeeSeed,
  LayerName,
  NodeVisualMapping,
  SceneEntity,
  SceneEntityType,
  SceneEventBus,
  SceneLayers,
  SceneManagerOptions,
} from './types.js';
import { DEFAULT_EMPLOYEES, DEFAULT_NODE_VISUAL_MAP, LAYER_NAMES } from './types.js';

/** Puppet Y offset above workstation center (body center sits above desk). */
const PUPPET_Y_OFFSET = -(PUPPET.body.height / 2 + PUPPET.head.radius + 8);

export class SceneManager {
  private app: Application | null = null;
  private readonly container: HTMLElement;
  private readonly eventBus: SceneEventBus;
  private readonly employees: EmployeeSeed[];
  private readonly nodeVisualMap: Record<string, NodeVisualMapping>;
  private _reducedMotion: boolean;
  private _destroyed = false;

  private layers: SceneLayers | null = null;
  private readonly entityStyle: SceneEntityType;
  private floorLayer: FloorLayer | null = null;
  private floorPlan: OfficeFloorPlan | null = null;
  private camera: CameraController | null = null;
  private employeeEntities: Map<string, SceneEntity> = new Map();
  private unsubscribers: (() => void)[] = [];
  private nodeActiveEmployees: Map<string, string> = new Map();
  private toolOverlayTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private highlightTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private routeLines: Map<string, RouteLineEntity> = new Map();
  private _performanceTier: PerformanceTier = 'A';
  private attentionRequests: Map<string, { priority: number; timestamp: number }> = new Map();
  private spotlightGfx: Graphics | null = null;
  private attentionSystem: AttentionSystem | null = null;
  private interactionController: InteractionController | null = null;
  /** Active install ghost entities keyed by installTxnId */
  private installGhosts: Map<string, InstallGhostEntity> = new Map();
  /** Pending settle timers keyed by installTxnId — cleared on destroy */
  private _settleTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _selectedEmployeeId: string | null = null;

  /** Rest area seats computed from floor plan */
  private restAreaSeats: Array<{ x: number; y: number }> = [];
  /** Seat index → employeeId for rest area occupancy tracking */
  private seatAssignments: Map<number, string> = new Map();
  /** Set of workstation IDs currently occupied by entities */
  private occupiedDeskIndices: Set<string> = new Set();
  /** Stored role slugs per employee for layout recomputation */
  private employeeRoleSlugs: Map<string, string | undefined> = new Map();
  /** Debounce timer for rebuildLayout after batch employee additions via events */
  private _rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SceneManagerOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.employees = options.employees ?? DEFAULT_EMPLOYEES;
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

  /** Create the correct puppet type based on the entityType discriminator. */
  private createEntity(
    id: string,
    name: string,
    entityType: SceneEntityType = this.entityStyle,
    characterConfig?: CharacterConfig,
  ): SceneEntity {
    const motionSet = {
      M0: this.motion.M0,
      M1: this.motion.M1,
      M2: this.motion.M2,
      M3: this.motion.M3,
    } as Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket>;

    if (entityType === 'lobster') {
      return new LobsterPuppet(id, name, motionSet);
    }
    const config = characterConfig ?? this.getDefaultCharacterConfig(id);
    return new EmployeePuppet(id, name, motionSet, config);
  }

  /** Mount the PixiJS application into the container */
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

    // ── Compute floor plan from employees ──
    const employeeCounts = this.computeDepartmentCounts();
    this.floorPlan = computeFloorPlan(RD_COMPANY_ZONES, employeeCounts);

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

    // ── Floor layer (L0) ──
    this.floorLayer = new FloorLayer(this.floorPlan);
    this.layers.floor.addChild(this.floorLayer.container);

    // ── Camera controller ──
    this.camera = new CameraController({
      stage: app.stage,
      world: worldContainer,
      floorWidth: this.floorPlan.totalWidth,
      floorHeight: this.floorPlan.totalHeight,
    });

    // ── Compute rest area seats (before placing entities so assignToRestArea works) ──
    const restZone = this.floorPlan.zones.find((z) => z.type === 'rest_area');
    if (restZone) {
      const seatCount = Math.max(4, this.employees.length);
      this.restAreaSeats = computeRestAreaSeats(restZone, seatCount);
    }

    // ── Employee entities (L2) ──
    const overflowIds: string[] = [];
    for (const emp of this.employees) {
      const wsId = emp.workstationId ?? this.findAvailableWorkstation(emp.roleSlug);
      const pos = wsId ? this.floorPlan.allWorkstations.get(wsId) : null;

      const entity = this.createEntity(emp.id, emp.name, emp.entityType, emp.characterConfig);
      if (pos) {
        entity.container.position.set(pos.x, pos.y + PUPPET_Y_OFFSET);
      } else {
        overflowIds.push(emp.id);
      }

      this.layers.entity.addChild(entity.container);
      this.employeeEntities.set(emp.id, entity);
    }

    // ── Assign overflow employees to rest area seats ──
    for (const id of overflowIds) {
      this.assignToRestArea(id);
    }

    // ── Interaction controller ──
    this.interactionController = new InteractionController(
      app.stage,
      this.employeeEntities,
      this.floorLayer.getWorkstationBounds(),
      this.eventBus,
      this.motion,
      (result) => {
        if (result.targetWorkstationId) {
          this.moveEntityToWorkstation(result.entityId, result.targetWorkstationId);
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
          this.assignToRestArea(result.entityId);
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
      () => this.employeeEntities,
      this.motion,
    );
    this.attentionSystem.activate();

    this.subscribeEvents();
  }

  addEmployee(
    id: string,
    name: string,
    entityType: SceneEntityType = 'employee',
    roleSlug?: string,
    characterConfig?: CharacterConfig,
  ): boolean {
    if (!this.app || !this.floorLayer || !this.layers || !this.floorPlan) return false;
    if (this.employeeEntities.has(id)) return false;

    // Try to place in matching department zone first, then any free desk
    const wsId = roleSlug
      ? this.findAvailableWorkstation(roleSlug) ?? this.findUnoccupiedWorkstation()
      : this.findUnoccupiedWorkstation();
    const pos = wsId ? this.floorPlan.allWorkstations.get(wsId) : null;

    const entity = this.createEntity(id, name, entityType, characterConfig);
    entity.container.scale.set(0);
    entity.container.alpha = 0;
    this.layers.entity.addChild(entity.container);
    this.employeeEntities.set(id, entity);
    this.employeeRoleSlugs.set(id, roleSlug);
    this.interactionController?.registerEntity(id, entity);

    if (pos) {
      entity.container.position.set(pos.x, pos.y + PUPPET_Y_OFFSET);
    } else {
      // No workstation available → assign to rest area seat
      this.assignToRestArea(id);
    }

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      gsap.to(entity.container.scale, { x: 1, y: 1, duration, ease });
      gsap.to(entity.container, { alpha: 1, duration, ease });
    } else {
      entity.container.scale.set(1);
      entity.container.alpha = 1;
    }

    return true;
  }

  removeEmployee(id: string): boolean {
    const entity = this.employeeEntities.get(id);
    if (!entity) return false;
    this.clearToolOverlayTimer(id);
    this.employeeEntities.delete(id);
    this.employeeRoleSlugs.delete(id);

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      gsap.to(entity.container.scale, { x: 0, y: 0, duration, ease });
      gsap.to(entity.container, {
        alpha: 0, duration, ease,
        onComplete: () => {
          entity.destroy();
          entity.container.destroy({ children: true });
        },
      });
    } else {
      entity.destroy();
      entity.container.destroy({ children: true });
    }
    return true;
  }

  moveEntityToWorkstation(entityId: string, workstationId: string): void {
    if (!this.floorPlan) return;
    const entity = this.employeeEntities.get(entityId);
    if (!entity) return;

    const pos = this.floorPlan.allWorkstations.get(workstationId);
    if (!pos) return;

    const targetX = pos.x;
    const targetY = pos.y + PUPPET_Y_OFFSET;

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      gsap.to(entity.container, { x: targetX, y: targetY, alpha: 1, duration, ease });
    } else {
      entity.container.x = targetX;
      entity.container.y = targetY;
      entity.container.alpha = 1;
    }
  }

  /** Assign an employee to the next free rest-area seat. */
  assignToRestArea(entityId: string): void {
    const entity = this.employeeEntities.get(entityId);
    if (!entity || this.restAreaSeats.length === 0) return;

    // Remove from any current seat
    this.removeFromRestArea(entityId);

    // Find first free seat
    const seatIdx = this.restAreaSeats.findIndex((_, i) => !this.seatAssignments.has(i));
    if (seatIdx < 0) return;

    const seat = this.restAreaSeats[seatIdx]!;
    this.seatAssignments.set(seatIdx, entityId);

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      gsap.to(entity.container, { x: seat.x, y: seat.y + PUPPET_Y_OFFSET, alpha: 1, duration, ease });
    } else {
      entity.container.x = seat.x;
      entity.container.y = seat.y + PUPPET_Y_OFFSET;
      entity.container.alpha = 1;
    }
  }

  /** Remove an employee from rest area tracking. */
  removeFromRestArea(entityId: string): void {
    for (const [idx, id] of this.seatAssignments) {
      if (id === entityId) {
        this.seatAssignments.delete(idx);
        break;
      }
    }
  }

  /** Check if an employee is in the rest area. */
  isInRestArea(entityId: string): boolean {
    for (const id of this.seatAssignments.values()) {
      if (id === entityId) return true;
    }
    return false;
  }

  /** Number of rest area seats available. */
  get restAreaSeatCount(): number {
    return this.restAreaSeats.length;
  }

  /** Number of occupied rest area seats. */
  get restAreaOccupiedCount(): number {
    return this.seatAssignments.size;
  }

  /** Get the bounding box of the rest area zone, if it exists. */
  getRestAreaBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.floorPlan) return null;
    const restZone = this.floorPlan.zones.find((z) => z.type === 'rest_area');
    if (!restZone) return null;
    return { x: restZone.x, y: restZone.y, width: restZone.width, height: restZone.height };
  }

  get employeeCount(): number {
    return this.employeeEntities.size;
  }

  get employeeIds(): string[] {
    return [...this.employeeEntities.keys()];
  }

  /** Currently selected employee ID, or null if nothing is selected. */
  get selectedEmployeeId(): string | null {
    return this._selectedEmployeeId;
  }

  /**
   * Select an employee programmatically (reverse direction: DOM → scene).
   * Focuses the camera on the employee, draws a selection ring, and emits
   * `ui.selection.changed` with `source: 'panel'` so the DOM panel updates too.
   */
  selectEmployee(employeeId: string): void {
    const entity = this.employeeEntities.get(employeeId);
    if (!entity) return;

    // Clear previous selection ring (if any)
    if (this._selectedEmployeeId && this._selectedEmployeeId !== employeeId) {
      const prev = this.employeeEntities.get(this._selectedEmployeeId);
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
      const prev = this.employeeEntities.get(this._selectedEmployeeId);
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

  /** Debug helper — returns position and role of each employee entity. */
  get employeeDebugInfo(): Array<{ id: string; x: number; y: number; roleSlug: string | undefined }> {
    const result: Array<{ id: string; x: number; y: number; roleSlug: string | undefined }> = [];
    for (const [id, entity] of this.employeeEntities) {
      result.push({
        id,
        x: Math.round(entity.container.x),
        y: Math.round(entity.container.y),
        roleSlug: this.employeeRoleSlugs.get(id),
      });
    }
    return result;
  }

  /**
   * Recompute the floor plan based on current employees and reposition everyone.
   *
   * Call this after a batch of addEmployee() calls to ensure zone sizes
   * match the actual department head counts. Without this, zones use the
   * counts from mount() time (which may be 0 if employees were loaded async).
   */
  /**
   * Schedule a debounced rebuildLayout. Multiple rapid employee additions
   * (e.g. from template materialization) coalesce into a single rebuild.
   */
  private scheduleRebuild(): void {
    if (this._rebuildTimer) clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      this._rebuildTimer = null;
      this.rebuildLayout();
    }, 100);
  }

  rebuildLayout(): void {
    if (!this.app || !this.layers || this._destroyed) return;

    // 1. Recompute department counts from current entities
    const counts = new Map<string, number>();
    for (const [, roleSlug] of this.employeeRoleSlugs) {
      const deptId = roleSlug ? resolveEmployeeDepartment(roleSlug) : null;
      const zoneId = deptId ? `zone-${deptId}` : 'zone-dev';
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1);
    }

    // 2. Recompute floor plan
    this.floorPlan = computeFloorPlan(RD_COMPANY_ZONES, counts);

    // 3. Rebuild floor layer (L0)
    if (this.floorLayer) {
      this.layers.floor.removeChild(this.floorLayer.container);
      this.floorLayer.container.destroy({ children: true });
    }
    this.floorLayer = new FloorLayer(this.floorPlan);
    this.layers.floor.addChild(this.floorLayer.container);

    // 4. Recompute rest area seats
    this.restAreaSeats = [];
    this.seatAssignments.clear();
    const restZone = this.floorPlan.zones.find((z) => z.type === 'rest_area');
    if (restZone) {
      const seatCount = Math.max(4, this.employeeEntities.size);
      this.restAreaSeats = computeRestAreaSeats(restZone, seatCount);
    }

    // 5. Reposition all employees into their correct workstations.
    //    Use explicit occupancy tracking (not position-based detection) to avoid
    //    cascading desk-stealing when departments are placed sequentially.
    const occupied = new Set<string>();
    const overflowIds: string[] = [];

    // Group employees by department zone so each dept fills its own zone first
    const byZone = new Map<string, string[]>();
    for (const [id] of this.employeeEntities) {
      const roleSlug = this.employeeRoleSlugs.get(id);
      const deptId = roleSlug ? resolveEmployeeDepartment(roleSlug) : null;
      const zoneId = deptId ? `zone-${deptId}` : 'zone-dev';
      if (!byZone.has(zoneId)) byZone.set(zoneId, []);
      byZone.get(zoneId)!.push(id);
    }

    // Place each department's employees into their zone's workstations
    for (const [zoneId, ids] of byZone) {
      const zone = this.floorPlan.zones.find((z) => z.zoneId === zoneId);
      if (!zone) {
        overflowIds.push(...ids);
        continue;
      }
      for (const id of ids) {
        const ws = zone.workstations.find((w) => !occupied.has(w.workstationId));
        if (ws) {
          occupied.add(ws.workstationId);
          const entity = this.employeeEntities.get(id)!;
          entity.container.position.set(ws.x, ws.y + PUPPET_Y_OFFSET);
        } else {
          overflowIds.push(id);
        }
      }
    }

    // Overflow → try any remaining desk, then rest area
    for (const id of overflowIds) {
      const allDesks = this.floorPlan.zones.flatMap((z) => z.workstations);
      const freeDsk = allDesks.find((w) => !occupied.has(w.workstationId));
      if (freeDsk) {
        occupied.add(freeDsk.workstationId);
        const entity = this.employeeEntities.get(id)!;
        entity.container.position.set(freeDsk.x, freeDsk.y + PUPPET_Y_OFFSET);
      } else {
        this.assignToRestArea(id);
      }
    }

    // 6. Update camera + interaction controller
    if (this.camera) {
      this.camera.floorWidth = this.floorPlan.totalWidth;
      this.camera.floorHeight = this.floorPlan.totalHeight;
      const { width, height } = this.app.screen;
      this.camera.fitToView(width, height);
    }
    if (this.interactionController && this.floorLayer) {
      this.interactionController.workstationBounds = this.floorLayer.getWorkstationBounds();
      if (restZone) {
        this.interactionController.restAreaBounds = {
          x: restZone.x, y: restZone.y, width: restZone.width, height: restZone.height,
        };
      }
    }
  }

  destroy(): void {
    this._destroyed = true;
    if (this._rebuildTimer) {
      clearTimeout(this._rebuildTimer);
      this._rebuildTimer = null;
    }

    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    for (const timer of this.toolOverlayTimers.values()) clearTimeout(timer);
    this.toolOverlayTimers.clear();
    for (const timer of this.highlightTimers) clearTimeout(timer);
    this.highlightTimers.clear();

    if (this.interactionController) {
      this.interactionController.destroy();
      this.interactionController = null;
    }

    for (const line of this.routeLines.values()) line.destroy();
    this.routeLines.clear();

    for (const [, timerId] of this._settleTimers) {
      clearTimeout(timerId);
    }
    this._settleTimers.clear();

    for (const ghost of this.installGhosts.values()) {
      ghost.destroy();
    }
    this.installGhosts.clear();

    for (const entity of this.employeeEntities.values()) entity.destroy();
    this.employeeEntities.clear();
    this.nodeActiveEmployees.clear();

    this.restAreaSeats = [];
    this.seatAssignments.clear();
    this.occupiedDeskIndices.clear();

    this.floorLayer = null;
    this.floorPlan = null;
    this.camera = null;
    this.layers = null;

    this.attentionRequests.clear();
    if (this.spotlightGfx) {
      this.spotlightGfx.destroy();
      this.spotlightGfx = null;
    }

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

  // ── Camera events ────────────────────────────────────────────────

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

  // ── Helpers ──────────────────────────────────────────────────────

  private computeDepartmentCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const emp of this.employees) {
      const deptId = emp.roleSlug ? resolveEmployeeDepartment(emp.roleSlug) : null;
      const zoneId = deptId ? `zone-${deptId}` : 'zone-dev';
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1);
    }
    return counts;
  }

  private findAvailableWorkstation(roleSlug?: string): string | null {
    if (!this.floorPlan) return null;
    const deptId = roleSlug ? resolveEmployeeDepartment(roleSlug) : null;
    const zoneId = deptId ? `zone-${deptId}` : 'zone-dev';

    const zone = this.floorPlan.zones.find((z) => z.zoneId === zoneId);
    if (!zone) return null;

    const occupied = new Set<string>();
    for (const entity of this.employeeEntities.values()) {
      for (const ws of zone.workstations) {
        if (Math.abs(entity.container.x - ws.x) < 5 && Math.abs(entity.container.y - (ws.y + PUPPET_Y_OFFSET)) < 5) {
          occupied.add(ws.workstationId);
        }
      }
    }

    const available = zone.workstations.find((ws) => !occupied.has(ws.workstationId));
    return available?.workstationId ?? null;
  }

  private findUnoccupiedWorkstation(): string | null {
    if (!this.floorPlan) return null;

    const allDesks = this.floorPlan.zones.flatMap((z) => z.workstations);
    const occupied = new Set<string>();

    for (const entity of this.employeeEntities.values()) {
      for (const desk of allDesks) {
        if (Math.abs(entity.container.x - desk.x) < 5 && Math.abs(entity.container.y - (desk.y + PUPPET_Y_OFFSET)) < 5) {
          occupied.add(desk.workstationId);
        }
      }
    }

    return allDesks.find((d) => !occupied.has(d.workstationId))?.workstationId ?? null;
  }

  private getDefaultCharacterConfig(id: string): CharacterConfig {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % DEFAULT_CHARACTER_CONFIGS.length;
    return DEFAULT_CHARACTER_CONFIGS[idx]!;
  }

  // ── Event subscriptions ──────────────────────────────────────────

  private subscribeEvents(): void {
    this.unsubscribers.push(
      this.eventBus.on('employee.state.changed', (event) => {
        const { employeeId, next } = event.payload as EmployeeStatePayload;
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          entity.setState(next);
          entity.setHighlight(next !== 'idle');
        }
        if (next === 'blocked' || next === 'failed') {
          this.requestAttention(employeeId, 5);
        } else if (next === 'idle' || next === 'success') {
          this.clearAttention(employeeId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('task.assignment.changed', (event) => {
        const { employeeId, action, taskRunId } = event.payload as TaskAssignmentPayload;
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          this.clearToolOverlayTimer(employeeId);
          entity.setTask(action === 'assigned' ? taskRunId : null);
        }
        if (action === 'assigned' && this.layers) {
          const fromEntity = this.getRouteOrigin();
          const toEntity = this.employeeEntities.get(employeeId);
          if (fromEntity && toEntity) {
            const line = new RouteLineEntity(taskRunId, STATE_COLORS.assigned, this.motion);
            line.setEndpoints(
              fromEntity.container.x, fromEntity.container.y,
              toEntity.container.x, toEntity.container.y,
            );
            this.layers.semantic.addChild(line.container);
            this.routeLines.set(taskRunId, line);
          }
        } else if (action === 'unassigned') {
          this.removeRouteLine(taskRunId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('graph.node.entered', (event) => {
        const { nodeName } = event.payload as GraphNodeEnteredPayload;
        const mapping = this.nodeVisualMap[nodeName];
        if (mapping) {
          const entity = this.employeeEntities.get(mapping.employeeId);
          if (entity) {
            entity.setState(mapping.enterState);
            entity.setHighlight(true);
            this.nodeActiveEmployees.set(nodeName, mapping.employeeId);
          }
        } else {
          const match = this.findEmployeeForNode(nodeName);
          if (match) match.setHighlight(true);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('graph.node.exited', (event) => {
        const { nodeName } = event.payload as GraphNodeExitedPayload;
        const employeeId = this.nodeActiveEmployees.get(nodeName);
        if (employeeId) {
          const entity = this.employeeEntities.get(employeeId);
          if (entity) {
            entity.setState('idle');
            entity.setHighlight(false);
          }
          this.nodeActiveEmployees.delete(nodeName);
        } else {
          for (const entity of this.employeeEntities.values()) {
            entity.setHighlight(false);
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('meeting.state.changed', (event) => {
        const { next, participantIds } = event.payload as MeetingStatePayload;
        if (next === 'gathering' && this.layers && this.floorPlan) {
          const meetingZone = this.floorPlan.zones.find((z) => z.type === 'meeting_room');
          if (meetingZone) {
            const mtgCx = meetingZone.x + meetingZone.width / 2;
            const mtgCy = meetingZone.y + meetingZone.height / 2;
            for (const pid of participantIds) {
              const entity = this.employeeEntities.get(pid);
              if (entity) {
                const line = new RouteLineEntity(`meeting-${pid}`, STATE_COLORS.meeting, this.motion);
                line.setEndpoints(entity.container.x, entity.container.y, mtgCx, mtgCy);
                this.layers.semantic.addChild(line.container);
                this.routeLines.set(`meeting-${pid}`, line);
              }
            }
          }
        }
        if (next === 'completed' || next === 'cancelled') {
          for (const pid of participantIds) {
            this.removeRouteLine(`meeting-${pid}`);
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('mcp.tool.called', (event) => {
        const payload = event.payload as McpToolCalledPayload;
        const entity = this.employeeEntities.get(payload.employeeId);
        if (entity) {
          this.clearToolOverlayTimer(payload.employeeId);
          entity.setTask(`🔧 ${payload.toolName}`);
          const timer = setTimeout(() => {
            this.toolOverlayTimers.delete(payload.employeeId);
            entity.setTask(null);
          }, 3000);
          this.toolOverlayTimers.set(payload.employeeId, timer);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.installed', (event) => {
        const payload = event.payload as EmployeeInstalledPayload;
        this.addEmployee(payload.employeeId, payload.name, 'lobster');
        this.scheduleRebuild();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.created', (event) => {
        const payload = event.payload as EmployeeCreatedPayload;
        this.addEmployee(payload.employeeId, payload.name, 'employee', payload.roleSlug);
        this.scheduleRebuild();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.deleted', (event) => {
        const payload = event.payload as EmployeeDeletedPayload;
        this.interactionController?.unregisterEntity(payload.employeeId);
        this.removeEmployee(payload.employeeId);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.workstation.changed', (event) => {
        const payload = event.payload as EmployeeWorkstationChangedPayload;
        if (payload.toWorkstationId) {
          this.moveEntityToWorkstation(payload.employeeId, payload.toWorkstationId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('task.state.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').TaskStatePayload;
        const { taskRunId, next } = payload;
        if (next === 'completed' || next === 'failed' || next === 'cancelled') {
          this.removeRouteLine(taskRunId);
        }
        if ((next === 'running' || next === 'completed') && payload.employeeId) {
          const entity = this.employeeEntities.get(payload.employeeId);
          if (entity) this.flashHighlight(entity, 500);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('ui.selection.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').UiSelectionPayload;
        // Only react to panel-initiated selections (scene-initiated ones are emitted by us)
        if (payload.source === 'panel') {
          this._selectedEmployeeId = payload.entityId;
          for (const [id, entity] of this.employeeEntities) {
            entity.setHighlight(id === payload.entityId);
          }
          // Focus camera on selected employee if one is selected
          if (payload.entityId) {
            const entity = this.employeeEntities.get(payload.entityId);
            if (entity && this.camera && this.app) {
              this.camera.focusEmployee(
                { x: entity.container.x, y: entity.container.y },
                this.app.screen.width,
                this.app.screen.height,
              );
            }
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('install.state.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').InstallStatePayload;
        const { installTxnId, next } = payload;
        if (next === 'compatibility_checked' || next === 'awaiting_confirmation') {
          this.showInstallGhost(installTxnId);
        } else if (next === 'materializing') {
          // Ghost already visible; update progress to show activity started
          this.updateInstallGhostProgress(installTxnId, 0.1);
        } else if (next === 'installed') {
          this.settleInstallGhost(installTxnId);
        } else if (next === 'failed' || next === 'rolled_back' || next === 'cancelled') {
          this.failInstallGhost(installTxnId);
        }
        if (next === 'failed' || next === 'rolled_back') {
          this.requestAttention(installTxnId, 5);
        } else if (next === 'installed' || next === 'cancelled') {
          this.clearAttention(installTxnId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('install.progress', (event) => {
        const payload = event.payload as { installTxnId: string; fraction: number };
        this.updateInstallGhostProgress(payload.installTxnId, payload.fraction);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('report.state.changed', (event) => {
        const payload = event.payload as ReportStatePayload;
        if (payload.next === 'ready' && payload.employeeId) {
          const entity = this.employeeEntities.get(payload.employeeId);
          if (entity) this.flashHighlight(entity, 2000);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.performance.tier.changed', (event) => {
        const tier = (event.payload as { tier: PerformanceTier }).tier;
        this._performanceTier = tier;
      }),
    );

    // ANIM-015: task row click → scene flash highlight on target employee
    this.unsubscribers.push(
      this.eventBus.on('ui.task.focused', (event) => {
        const payload = event.payload as import('@aics/shared-types').UiTaskFocusedPayload;
        const entity = this.employeeEntities.get(payload.employeeId);
        if (entity) {
          entity.flashHighlight();
        }
      }),
    );
  }

  private getRouteOrigin(): SceneEntity | undefined {
    return this.employeeEntities.values().next().value;
  }

  private flashHighlight(entity: SceneEntity, durationMs: number): void {
    entity.setHighlight(true);
    const timer = setTimeout(() => {
      this.highlightTimers.delete(timer);
      if (!this._destroyed) entity.setHighlight(false);
    }, durationMs);
    this.highlightTimers.add(timer);
  }

  private removeRouteLine(taskRunId: string): void {
    const line = this.routeLines.get(taskRunId);
    if (line) {
      this.routeLines.delete(taskRunId);
      line.fadeOut();
    }
  }

  private showInstallGhost(txnId: string): void {
    if (this.installGhosts.has(txnId) || !this.layers || !this.floorPlan) return;

    const wsId = this.findUnoccupiedWorkstation();
    const pos = wsId ? this.floorPlan.allWorkstations.get(wsId) : null;

    const x = pos ? pos.x : this.floorPlan.totalWidth / 2;
    const y = pos ? pos.y + PUPPET_Y_OFFSET : this.floorPlan.totalHeight / 2;

    const ghost = new InstallGhostEntity({ x, y });
    this.layers.semantic.addChild(ghost.container);
    this.installGhosts.set(txnId, ghost);
  }

  private updateInstallGhostProgress(txnId: string, fraction: number): void {
    const ghost = this.installGhosts.get(txnId);
    if (ghost) ghost.setProgress(fraction);
  }

  private settleInstallGhost(txnId: string): void {
    const ghost = this.installGhosts.get(txnId);
    if (!ghost) return;
    this.installGhosts.delete(txnId);
    ghost.settleAsInstalled();
    // Remove from scene after settle animation completes (M1 duration)
    const dur = this.motion.M1.duration > 0 ? this.motion.M1.duration : 0.6;
    const timerId = setTimeout(() => {
      this._settleTimers.delete(txnId);
      ghost.destroy();
    }, (dur + 0.2) * 1000);
    this._settleTimers.set(txnId, timerId);
  }

  private failInstallGhost(txnId: string): void {
    const ghost = this.installGhosts.get(txnId);
    if (!ghost) return;
    this.installGhosts.delete(txnId);
    // failAndRemove() handles its own cleanup and destroy()
    ghost.failAndRemove();
  }

  private clearToolOverlayTimer(employeeId: string): void {
    const existing = this.toolOverlayTimers.get(employeeId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.toolOverlayTimers.delete(employeeId);
    }
  }

  private requestAttention(entityId: string, priority: number): void {
    this.attentionRequests.set(entityId, { priority, timestamp: Date.now() });
    this.updateSpotlight();
  }

  private clearAttention(entityId: string): void {
    this.attentionRequests.delete(entityId);
    this.updateSpotlight();
  }

  private updateSpotlight(): void {
    if (!this.layers) return;

    let best: { entityId: string; priority: number; timestamp: number } | null = null;
    for (const [entityId, req] of this.attentionRequests) {
      if (!best || req.priority > best.priority || (req.priority === best.priority && req.timestamp > best.timestamp)) {
        best = { entityId, ...req };
      }
    }

    if (this.spotlightGfx) {
      this.layers.focus.removeChild(this.spotlightGfx);
      this.spotlightGfx.destroy();
      this.spotlightGfx = null;
    }

    if (!best) return;
    const entity = this.employeeEntities.get(best.entityId);
    if (!entity) return;
    if (this._performanceTier === 'C' || this._reducedMotion) return;

    const gfx = new Graphics();
    gfx.circle(entity.container.x, entity.container.y, 40);
    gfx.fill({ color: 0xfbbf24, alpha: this._performanceTier === 'B' ? 0.1 : 0.15 });
    this.layers.focus.addChild(gfx);
    this.spotlightGfx = gfx;
  }

  private findEmployeeForNode(nodeName: string): SceneEntity | undefined {
    const lower = nodeName.toLowerCase();
    for (const [id, entity] of this.employeeEntities) {
      const name = id.replace('emp-', '');
      const pattern = new RegExp(`(?:^|[^a-z])${name}(?:$|[^a-z])`);
      if (pattern.test(lower)) return entity;
    }
    return undefined;
  }
}

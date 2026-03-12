import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeInstalledPayload,
  EmployeeStatePayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  McpToolCalledPayload,
  MeetingStatePayload,
  TaskAssignmentPayload,
} from '@aics/shared-types';
import gsap from 'gsap';
import { Application, Container } from 'pixi.js';
import { EmployeeEntity } from '../entities/employee-entity.js';
import { LobsterEntity } from '../entities/lobster-entity.js';
import { MeetingRoomEntity } from '../entities/meeting-room-entity.js';
import { FloorLayer } from '../layers/floor-layer.js';
import { LAYOUT } from '../tokens/layout.js';
import { MOTION, MOTION_REDUCED, type MotionBucket } from '../tokens/motion.js';
import type {
  EmployeeSeed,
  LayerName,
  NodeVisualMapping,
  SceneEntity,
  SceneEntityType,
  SceneEventBus,
  SceneManagerOptions,
  SceneLayers,
} from './types.js';
import { DEFAULT_EMPLOYEES, DEFAULT_NODE_VISUAL_MAP, LAYER_NAMES } from './types.js';

export class SceneManager {
  private app: Application | null = null;
  private readonly container: HTMLElement;
  private readonly eventBus: SceneEventBus;
  private readonly employees: EmployeeSeed[];
  private readonly nodeVisualMap: Record<string, NodeVisualMapping>;
  private _reducedMotion: boolean;
  /** Guard against async mount completing after destroy (React StrictMode). */
  private _destroyed = false;

  private layers: SceneLayers | null = null;
  private readonly entityStyle: SceneEntityType;
  private floorLayer: FloorLayer | null = null;
  private meetingRoom: MeetingRoomEntity | null = null;
  /** All scene entities keyed by employee ID — uses SceneEntity interface (EmployeeEntity or LobsterEntity). */
  private employeeEntities: Map<string, SceneEntity> = new Map();
  private unsubscribers: (() => void)[] = [];
  /** Track which employees were activated by graph node events (for revert on exit). */
  private nodeActiveEmployees: Map<string, string> = new Map();
  /** Track active MCP tool overlay timers per employee (for auto-clear). */
  private toolOverlayTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(options: SceneManagerOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.employees = options.employees ?? DEFAULT_EMPLOYEES;
    this._reducedMotion = options.reducedMotion ?? false;
    this.nodeVisualMap = options.nodeVisualMap ?? DEFAULT_NODE_VISUAL_MAP;
    this.entityStyle = options.entityStyle ?? 'lobster';
  }

  /** Get the active motion tokens (respects reduced-motion) */
  get motion(): Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket> {
    return this._reducedMotion ? MOTION_REDUCED : MOTION;
  }

  /** Update reduced-motion preference without rebuilding the scene (I3). */
  set reducedMotion(value: boolean) {
    this._reducedMotion = value;
  }

  /**
   * Create the correct entity type based on the entityType discriminator.
   * - 'employee' (default): EmployeeEntity — standard human-like avatar
   * - 'lobster': LobsterEntity — pixel lobster for OpenClaw agents
   */
  private createEntity(id: string, name: string, entityType: SceneEntityType = this.entityStyle): SceneEntity {
    if (entityType === 'lobster') {
      return new LobsterEntity(id, name, this.motion);
    }
    return new EmployeeEntity(id, name, this.motion);
  }

  /** Mount the PixiJS application into the container */
  async mount(): Promise<void> {
    if (this.app || this._destroyed) return;

    const app = new Application();
    await app.init({
      resizeTo: this.container,
      background: 0x1a1c2c, // ocean-deep — matches pixel floor tile base
      antialias: true,
      resolution: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1,
      autoDensity: true,
    });

    // If destroy() was called while init was in-flight (React StrictMode),
    // discard the freshly-created app and bail out.
    if (this._destroyed) {
      app.destroy(true);
      return;
    }

    this.container.appendChild(app.canvas as HTMLCanvasElement);
    this.app = app;

    // Build scene graph
    const worldContainer = new Container();
    app.stage.addChild(worldContainer);

    // Create 8 named layers (L0–L7) and add them to worldContainer in order
    const layersObj = {} as Record<string, Container>;
    for (const name of LAYER_NAMES) {
      const layer = new Container();
      layersObj[name] = layer;
      worldContainer.addChild(layer);
    }
    this.layers = layersObj as SceneLayers;

    // Floor layer — placed in L0 (floor)
    this.floorLayer = new FloorLayer();
    this.layers.floor.addChild(this.floorLayer.container);

    // Meeting room entity — placed in L1 (furniture)
    this.meetingRoom = new MeetingRoomEntity(this.motion);
    this.meetingRoom.container.position.set(
      LAYOUT.floor.width / 2,
      LAYOUT.floor.height - LAYOUT.floor.padding - LAYOUT.meetingRoom.bottomOffset,
    );
    this.layers.furniture.addChild(this.meetingRoom.container);

    // Employee entities — placed in L2 (entity)
    const deskPositions = this.floorLayer.getDeskPositions();
    this.employees.forEach((emp, i) => {
      const pos = deskPositions[i % deskPositions.length]!;
      const entity = this.createEntity(emp.id, emp.name, emp.entityType);
      entity.container.position.set(
        pos.x,
        pos.y - LAYOUT.desk.height / 2 - LAYOUT.employee.radius - 8,
      );
      this.layers!.entity.addChild(entity.container);
      this.employeeEntities.set(emp.id, entity);
    });

    // Center the world
    this.centerWorld();

    // Subscribe to events
    this.subscribeEvents();
  }

  /**
   * Add a new employee to the scene at the next available desk position.
   * Plays a scale-from-zero + fade-in entrance animation.
   * Called after package materialization creates a new employee.
   *
   * @param entityType - Which visual entity to use. Defaults to 'lobster' for
   *   installed employees (they come from packages, typically OpenClaw).
   * @returns true if the employee was added, false if the scene is not mounted
   *          or an employee with the same id already exists.
   */
  addEmployee(id: string, name: string, entityType: SceneEntityType = 'lobster'): boolean {
    // Guard: scene must be mounted
    if (!this.app || !this.floorLayer || !this.layers) return false;
    // Guard: no duplicate ids
    if (this.employeeEntities.has(id)) return false;

    const deskPositions = this.floorLayer.getDeskPositions();
    const posIndex = this.employeeEntities.size % deskPositions.length;
    const pos = deskPositions[posIndex]!;

    const entity = this.createEntity(id, name, entityType);
    entity.container.position.set(
      pos.x,
      pos.y - LAYOUT.desk.height / 2 - LAYOUT.employee.radius - 8,
    );

    // Start invisible and scaled to zero for entrance animation
    entity.container.scale.set(0);
    entity.container.alpha = 0;

    // Add to entity layer (L2)
    this.layers.entity.addChild(entity.container);

    // Register in entity map
    this.employeeEntities.set(id, entity);

    // Entrance animation: scale-from-zero + fade-in using M1 (slow entrance)
    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      gsap.to(entity.container.scale, {
        x: 1,
        y: 1,
        duration,
        ease,
      });
      gsap.to(entity.container, {
        alpha: 1,
        duration,
        ease,
      });
    } else {
      // Reduced-motion: snap to final state
      entity.container.scale.set(1);
      entity.container.alpha = 1;
    }

    return true;
  }

  /**
   * Remove an employee from the scene with a scale-to-zero + fade-out exit animation.
   * Called when an employee is deleted (UI or rollback).
   *
   * @returns true if the employee was found and removed, false otherwise.
   */
  removeEmployee(id: string): boolean {
    const entity = this.employeeEntities.get(id);
    if (!entity) return false;

    // Clear any pending MCP tool overlay timer
    this.clearToolOverlayTimer(id);

    // Remove from map immediately (prevents duplicate removal)
    this.employeeEntities.delete(id);

    // Exit animation: scale-to-zero + fade-out using M1 (slow exit)
    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      gsap.to(entity.container.scale, {
        x: 0,
        y: 0,
        duration,
        ease,
      });
      gsap.to(entity.container, {
        alpha: 0,
        duration,
        ease,
        onComplete: () => {
          entity.destroy();
          entity.container.destroy({ children: true });
        },
      });
    } else {
      // Reduced-motion: destroy immediately
      entity.destroy();
      entity.container.destroy({ children: true });
    }

    return true;
  }

  /** Number of employee entities currently in the scene (for debug bridge). */
  get employeeCount(): number {
    return this.employeeEntities.size;
  }

  /** IDs of all employee entities in the scene (for debug bridge). */
  get employeeIds(): string[] {
    return [...this.employeeEntities.keys()];
  }

  /** Destroy the PixiJS application and clean up */
  destroy(): void {
    this._destroyed = true;

    // Unsubscribe all event listeners (EventBus + renderer resize)
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    // Clear all pending MCP tool overlay timers
    for (const timer of this.toolOverlayTimers.values()) {
      clearTimeout(timer);
    }
    this.toolOverlayTimers.clear();

    // Clean up entities — kill GSAP tweens before clearing (C2)
    for (const entity of this.employeeEntities.values()) {
      entity.destroy();
    }
    this.employeeEntities.clear();
    this.nodeActiveEmployees.clear();

    // Clean up meeting room
    if (this.meetingRoom) {
      this.meetingRoom.destroy();
      this.meetingRoom = null;
    }
    this.floorLayer = null;
    this.layers = null;

    // Destroy PixiJS app
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }

  /**
   * Add a display object to a named layer.
   * @returns true if the layer exists and the child was added, false if not mounted.
   */
  addToLayer(layer: LayerName, child: Container): boolean {
    if (!this.layers) return false;
    this.layers[layer].addChild(child);
    return true;
  }

  /** Center the world container in the viewport */
  private centerWorld(): void {
    if (!this.app) return;
    const world = this.app.stage.children[0] as Container;
    const { width, height } = this.app.screen;
    const floorW = LAYOUT.floor.width;
    const floorH = LAYOUT.floor.height;
    world.position.set((width - floorW) / 2, (height - floorH) / 2);
  }

  /** Subscribe to runtime events */
  private subscribeEvents(): void {
    // Employee state changes — also drive highlight from state (I6)
    this.unsubscribers.push(
      this.eventBus.on('employee.state.changed', (event) => {
        const { employeeId, next } = event.payload as EmployeeStatePayload;
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          entity.setState(next);
          entity.setHighlight(next !== 'idle');
        }
      }),
    );

    // Task assignment changes (I6: use typed payload)
    // Also clears any pending MCP tool overlay timer for the employee.
    this.unsubscribers.push(
      this.eventBus.on('task.assignment.changed', (event) => {
        const { employeeId, action, taskRunId } = event.payload as TaskAssignmentPayload;
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          this.clearToolOverlayTimer(employeeId);
          entity.setTask(action === 'assigned' ? taskRunId : null);
        }
      }),
    );

    // Graph node entered — map node to employee, set visual state + highlight
    this.unsubscribers.push(
      this.eventBus.on('graph.node.entered', (event) => {
        const { nodeName } = event.payload as GraphNodeEnteredPayload;

        // Try static node → employee mapping first
        const mapping = this.nodeVisualMap[nodeName];
        if (mapping) {
          const entity = this.employeeEntities.get(mapping.employeeId);
          if (entity) {
            entity.setState(mapping.enterState);
            entity.setHighlight(true);
            this.nodeActiveEmployees.set(nodeName, mapping.employeeId);
          }
        } else {
          // Fallback: word-boundary match for future per-employee nodes (e.g. "alice_work")
          const match = this.findEmployeeForNode(nodeName);
          if (match) match.setHighlight(true);
        }
      }),
    );

    // Graph node exited — revert mapped employee to idle, clear highlight
    this.unsubscribers.push(
      this.eventBus.on('graph.node.exited', (event) => {
        const { nodeName } = event.payload as GraphNodeExitedPayload;

        // Revert node-mapped employee to idle
        const employeeId = this.nodeActiveEmployees.get(nodeName);
        if (employeeId) {
          const entity = this.employeeEntities.get(employeeId);
          if (entity) {
            entity.setState('idle');
            entity.setHighlight(false);
          }
          this.nodeActiveEmployees.delete(nodeName);
        } else {
          // Fallback: clear all highlights (for non-mapped nodes)
          for (const entity of this.employeeEntities.values()) {
            entity.setHighlight(false);
          }
        }
      }),
    );

    // Meeting state changes — show/hide meeting room
    this.unsubscribers.push(
      this.eventBus.on('meeting.state.changed', (event) => {
        const { next } = event.payload as MeetingStatePayload;
        if (next === 'running') {
          this.meetingRoom?.show();
        } else if (next === 'completed') {
          this.meetingRoom?.hide();
        }
      }),
    );

    // MCP tool call — show tool name in employee bubble with auto-clear
    this.unsubscribers.push(
      this.eventBus.on('mcp.tool.called', (event) => {
        const payload = event.payload as McpToolCalledPayload;
        const entity = this.employeeEntities.get(payload.employeeId);
        if (entity) {
          // Clear any existing tool overlay timer for this employee
          this.clearToolOverlayTimer(payload.employeeId);

          entity.setTask(`🔧 ${payload.toolName}`);

          // Auto-clear after 3s — the next state or task event will override anyway
          const timer = setTimeout(() => {
            this.toolOverlayTimers.delete(payload.employeeId);
            entity.setTask(null);
          }, 3000);
          this.toolOverlayTimers.set(payload.employeeId, timer);
        }
      }),
    );

    // Employee installed — add new employee to scene as lobster (from package)
    this.unsubscribers.push(
      this.eventBus.on('employee.installed', (event) => {
        const payload = event.payload as EmployeeInstalledPayload;
        // Installed employees default to 'lobster' — they come from packages (OpenClaw)
        this.addEmployee(payload.employeeId, payload.name, 'lobster');
      }),
    );

    // Employee created (UI) — add new employee to scene as human avatar
    this.unsubscribers.push(
      this.eventBus.on('employee.created', (event) => {
        const payload = event.payload as EmployeeCreatedPayload;
        this.addEmployee(payload.employeeId, payload.name, 'employee');
      }),
    );

    // Employee deleted — remove from scene with exit animation
    this.unsubscribers.push(
      this.eventBus.on('employee.deleted', (event) => {
        const payload = event.payload as EmployeeDeletedPayload;
        this.removeEmployee(payload.employeeId);
      }),
    );

    // Re-center on resize — store handler ref for cleanup (C1)
    if (this.app) {
      const handleResize = () => this.centerWorld();
      this.app.renderer.on('resize', handleResize);
      const renderer = this.app.renderer;
      this.unsubscribers.push(() => renderer.off('resize', handleResize));
    }
  }

  /** Clear and remove a pending MCP tool overlay timer for the given employee. */
  private clearToolOverlayTimer(employeeId: string): void {
    const existing = this.toolOverlayTimers.get(employeeId);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.toolOverlayTimers.delete(employeeId);
    }
  }

  /**
   * Map a graph node name to an employee entity.
   * Uses word-boundary matching to avoid substring collisions (I5).
   * E.g. "alice_work" matches "emp-alice" but "alice2_work" does not match "emp-alice".
   */
  private findEmployeeForNode(nodeName: string): SceneEntity | undefined {
    const lower = nodeName.toLowerCase();
    for (const [id, entity] of this.employeeEntities) {
      const name = id.replace('emp-', '');
      // Word-boundary match: name must be delimited by start/end or non-alpha chars
      const pattern = new RegExp(`(?:^|[^a-z])${name}(?:$|[^a-z])`);
      if (pattern.test(lower)) return entity;
    }
    return undefined;
  }
}

import { Application, Container } from 'pixi.js';
import gsap from 'gsap';
import type {
  EmployeeStatePayload,
  TaskAssignmentPayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
} from '@aics/shared-types';
import type { SceneEventBus, SceneManagerOptions, EmployeeSeed, NodeVisualMapping } from './types.js';
import { DEFAULT_EMPLOYEES, DEFAULT_NODE_VISUAL_MAP } from './types.js';
import { LAYOUT } from '../tokens/layout.js';
import { SCENE_COLORS } from '../tokens/colors.js';
import { FloorLayer } from '../layers/floor-layer.js';
import { EmployeeEntity } from '../entities/employee-entity.js';
import { MOTION, MOTION_REDUCED, type MotionBucket } from '../tokens/motion.js';

export class SceneManager {
  private app: Application | null = null;
  private readonly container: HTMLElement;
  private readonly eventBus: SceneEventBus;
  private readonly employees: EmployeeSeed[];
  private readonly nodeVisualMap: Record<string, NodeVisualMapping>;
  private _reducedMotion: boolean;
  /** Guard against async mount completing after destroy (React StrictMode). */
  private _destroyed = false;

  private floorLayer: FloorLayer | null = null;
  private employeeEntities: Map<string, EmployeeEntity> = new Map();
  private unsubscribers: (() => void)[] = [];
  /** Track which employees were activated by graph node events (for revert on exit). */
  private nodeActiveEmployees: Map<string, string> = new Map();

  constructor(options: SceneManagerOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.employees = options.employees ?? DEFAULT_EMPLOYEES;
    this._reducedMotion = options.reducedMotion ?? false;
    this.nodeVisualMap = options.nodeVisualMap ?? DEFAULT_NODE_VISUAL_MAP;
  }

  /** Get the active motion tokens (respects reduced-motion) */
  get motion(): Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket> {
    return this._reducedMotion ? MOTION_REDUCED : MOTION;
  }

  /** Update reduced-motion preference without rebuilding the scene (I3). */
  set reducedMotion(value: boolean) {
    this._reducedMotion = value;
  }

  /** Mount the PixiJS application into the container */
  async mount(): Promise<void> {
    if (this.app || this._destroyed) return;

    const app = new Application();
    await app.init({
      resizeTo: this.container,
      background: SCENE_COLORS.floor,
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

    // Floor layer
    this.floorLayer = new FloorLayer();
    worldContainer.addChild(this.floorLayer.container);

    // Employee entities
    const deskPositions = this.floorLayer.getDeskPositions();
    this.employees.forEach((emp, i) => {
      const pos = deskPositions[i % deskPositions.length]!;
      const entity = new EmployeeEntity(emp.id, emp.name, this.motion);
      entity.container.position.set(pos.x, pos.y - LAYOUT.desk.height / 2 - LAYOUT.employee.radius - 8);
      worldContainer.addChild(entity.container);
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
   * @returns true if the employee was added, false if the scene is not mounted
   *          or an employee with the same id already exists.
   */
  addEmployee(id: string, name: string): boolean {
    // Guard: scene must be mounted
    if (!this.app || !this.floorLayer) return false;
    // Guard: no duplicate ids
    if (this.employeeEntities.has(id)) return false;

    const deskPositions = this.floorLayer.getDeskPositions();
    const posIndex = this.employeeEntities.size % deskPositions.length;
    const pos = deskPositions[posIndex]!;

    const entity = new EmployeeEntity(id, name, this.motion);
    entity.container.position.set(pos.x, pos.y - LAYOUT.desk.height / 2 - LAYOUT.employee.radius - 8);

    // Start invisible and scaled to zero for entrance animation
    entity.container.scale.set(0);
    entity.container.alpha = 0;

    // Add to world container (first child of stage)
    const world = this.app.stage.children[0] as Container;
    world.addChild(entity.container);

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

  /** Destroy the PixiJS application and clean up */
  destroy(): void {
    this._destroyed = true;

    // Unsubscribe all event listeners (EventBus + renderer resize)
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    // Clean up entities — kill GSAP tweens before clearing (C2)
    for (const entity of this.employeeEntities.values()) {
      entity.destroy();
    }
    this.employeeEntities.clear();
    this.nodeActiveEmployees.clear();
    this.floorLayer = null;

    // Destroy PixiJS app
    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
  }

  /** Center the world container in the viewport */
  private centerWorld(): void {
    if (!this.app) return;
    const world = this.app.stage.children[0] as Container;
    const { width, height } = this.app.screen;
    const floorW = LAYOUT.floor.width;
    const floorH = LAYOUT.floor.height;
    world.position.set(
      (width - floorW) / 2,
      (height - floorH) / 2,
    );
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
    this.unsubscribers.push(
      this.eventBus.on('task.assignment.changed', (event) => {
        const { employeeId, action, taskRunId } = event.payload as TaskAssignmentPayload;
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
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

    // Re-center on resize — store handler ref for cleanup (C1)
    if (this.app) {
      const handleResize = () => this.centerWorld();
      this.app.renderer.on('resize', handleResize);
      const renderer = this.app.renderer;
      this.unsubscribers.push(() => renderer.off('resize', handleResize));
    }
  }

  /**
   * Map a graph node name to an employee entity.
   * Uses word-boundary matching to avoid substring collisions (I5).
   * E.g. "alice_work" matches "emp-alice" but "alice2_work" does not match "emp-alice".
   */
  private findEmployeeForNode(nodeName: string): EmployeeEntity | undefined {
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

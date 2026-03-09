import { Application, Container } from 'pixi.js';
import type {
  EmployeeStatePayload,
  TaskAssignmentPayload,
  GraphNodeEnteredPayload,
} from '@aics/shared-types';
import type { SceneEventBus, SceneManagerOptions, EmployeeSeed } from './types.js';
import { DEFAULT_EMPLOYEES } from './types.js';
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
  private _reducedMotion: boolean;

  private floorLayer: FloorLayer | null = null;
  private employeeEntities: Map<string, EmployeeEntity> = new Map();
  private unsubscribers: (() => void)[] = [];

  constructor(options: SceneManagerOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.employees = options.employees ?? DEFAULT_EMPLOYEES;
    this._reducedMotion = options.reducedMotion ?? false;
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
    if (this.app) return;

    const app = new Application();
    await app.init({
      resizeTo: this.container,
      background: SCENE_COLORS.floor,
      antialias: true,
      resolution: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1,
      autoDensity: true,
    });

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

  /** Destroy the PixiJS application and clean up */
  destroy(): void {
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
    // Employee state changes (I6: use typed payload from shared-types)
    this.unsubscribers.push(
      this.eventBus.on('employee.state.changed', (event) => {
        const { employeeId, next } = event.payload as EmployeeStatePayload;
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          entity.setState(next);
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

    // Graph node entered — highlight active employee (I6: use typed payload)
    this.unsubscribers.push(
      this.eventBus.on('graph.node.entered', (event) => {
        const { nodeName } = event.payload as GraphNodeEnteredPayload;
        for (const entity of this.employeeEntities.values()) {
          entity.setHighlight(false);
        }
        const match = this.findEmployeeForNode(nodeName);
        if (match) match.setHighlight(true);
      }),
    );

    // Graph node exited — remove highlight
    this.unsubscribers.push(
      this.eventBus.on('graph.node.exited', () => {
        for (const entity of this.employeeEntities.values()) {
          entity.setHighlight(false);
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

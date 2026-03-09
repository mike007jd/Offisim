import { Application, Container } from 'pixi.js';
import type { RuntimeEvent } from '@aics/shared-types';
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
  private readonly reducedMotion: boolean;

  private floorLayer: FloorLayer | null = null;
  private employeeEntities: Map<string, EmployeeEntity> = new Map();
  private unsubscribers: (() => void)[] = [];

  constructor(options: SceneManagerOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.employees = options.employees ?? DEFAULT_EMPLOYEES;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  /** Get the active motion tokens (respects reduced-motion) */
  get motion(): Record<'M0' | 'M1' | 'M2' | 'M3', MotionBucket> {
    return this.reducedMotion ? MOTION_REDUCED : MOTION;
  }

  /** Mount the PixiJS application into the container */
  async mount(): Promise<void> {
    if (this.app) return;

    const app = new Application();
    await app.init({
      resizeTo: this.container,
      background: SCENE_COLORS.floor,
      antialias: true,
      resolution: window.devicePixelRatio ?? 1,
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
    // Unsubscribe all event listeners
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    // Clean up entities
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
    // Employee state changes
    this.unsubscribers.push(
      this.eventBus.on('employee.state.changed', (event: RuntimeEvent) => {
        const { employeeId, next } = event.payload as { employeeId: string; next: string };
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          entity.setState(next as import('@aics/shared-types').EmployeeState);
        }
      }),
    );

    // Task assignment changes
    this.unsubscribers.push(
      this.eventBus.on('task.assignment.changed', (event: RuntimeEvent) => {
        const { employeeId, action, taskRunId } = event.payload as {
          employeeId: string;
          action: 'assigned' | 'unassigned';
          taskRunId: string;
        };
        const entity = this.employeeEntities.get(employeeId);
        if (entity) {
          entity.setTask(action === 'assigned' ? taskRunId : null);
        }
      }),
    );

    // Graph node entered — highlight active employee
    this.unsubscribers.push(
      this.eventBus.on('graph.node.entered', (event: RuntimeEvent) => {
        const { nodeName } = event.payload as { nodeName: string };
        // Map node names to employee IDs (convention: node name contains employee ref)
        for (const entity of this.employeeEntities.values()) {
          entity.setHighlight(false);
        }
        // Highlight employee matching node name pattern
        const match = this.findEmployeeForNode(nodeName);
        if (match) match.setHighlight(true);
      }),
    );

    // Graph node exited — remove highlight
    this.unsubscribers.push(
      this.eventBus.on('graph.node.exited', (_event: RuntimeEvent) => {
        for (const entity of this.employeeEntities.values()) {
          entity.setHighlight(false);
        }
      }),
    );

    // Re-center on resize
    if (this.app) {
      this.app.renderer.on('resize', () => this.centerWorld());
    }
  }

  /** Map a graph node name to an employee entity */
  private findEmployeeForNode(nodeName: string): EmployeeEntity | undefined {
    const lower = nodeName.toLowerCase();
    for (const [id, entity] of this.employeeEntities) {
      // Match by employee name in node name (e.g., "alice_work" → emp-alice)
      const name = id.replace('emp-', '');
      if (lower.includes(name)) return entity;
    }
    return undefined;
  }
}

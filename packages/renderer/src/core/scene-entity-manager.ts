// ── Scene Entity Manager ──────────────────────────────────────────────
// Manages employee entity creation, destruction, positioning, and layout.
// Extracted from SceneManager to keep entity lifecycle logic isolated.

import gsap from 'gsap';
import type { Container } from 'pixi.js';
import { computeFloorPlan, computeRestAreaSeats, type OfficeFloorPlan } from '../layout/zone-layout-engine.js';
import { EmployeePuppet } from '../puppet/employee-puppet.js';
import { LobsterPuppet } from '../puppet/lobster-puppet.js';
import type { CharacterConfig } from '../puppet/types.js';
import { DEFAULT_CHARACTER_CONFIGS, PUPPET } from '../puppet/types.js';
import { resolveEmployeeDepartment, RD_COMPANY_ZONES } from '../tokens/departments.js';
import type { MotionBucket, MotionTokens } from '../tokens/motion.js';
import { PrefabRuntime } from '../prefab/prefab-runtime.js';
import { PrefabEventRouter } from '../prefab/prefab-event-router.js';
import { getBuiltinPrefab } from '../prefab/builtin-catalog.js';
import type {
  EmployeeSeed,
  PrefabSeed,
  SceneEntity,
  SceneEntityType,
} from './types.js';

/** Puppet Y offset above workstation center (body center sits above desk). */
export const PUPPET_Y_OFFSET = -(PUPPET.body.height / 2 + PUPPET.head.radius + 8);

/**
 * Manages employee entity creation, destruction, positioning, and zone layout.
 * Does NOT own the PixiJS Application or event subscriptions.
 */
export class SceneEntityManager {
  readonly employeeEntities: Map<string, SceneEntity> = new Map();
  /** Stored role slugs per employee for layout recomputation */
  readonly employeeRoleSlugs: Map<string, string | undefined> = new Map();

  /** Prefab runtime instances keyed by instanceId */
  readonly prefabRuntimes: Map<string, PrefabRuntime> = new Map();
  /** Routes runtime events to bound prefab instances */
  readonly prefabEventRouter: PrefabEventRouter = new PrefabEventRouter();

  /** Tracked GSAP tweens created by entity lifecycle animations (killed on destroy) */
  private managedTweens: gsap.core.Tween[] = [];

  /** Rest area seats computed from floor plan */
  private restAreaSeats: Array<{ x: number; y: number }> = [];
  /** Seat index -> employeeId for rest area occupancy tracking */
  private seatAssignments: Map<number, string> = new Map();
  /** Occupancy map: workstationId -> employeeId (replaces O(n^2) position matching) */
  private occupancy: Map<string, string> = new Map();

  private floorPlan: OfficeFloorPlan | null = null;

  private readonly entityStyle: SceneEntityType;

  constructor(
    private readonly entityLayer: Container,
    private readonly getMotion: () => MotionTokens,
    entityStyle: SceneEntityType,
    private readonly furnitureLayer?: Container,
  ) {
    this.entityStyle = entityStyle;
  }

  get motion(): MotionTokens {
    return this.getMotion();
  }

  /** Current floor plan (may be null before mount). */
  get currentFloorPlan(): OfficeFloorPlan | null {
    return this.floorPlan;
  }

  /** Set floor plan (called by SceneManager during mount/rebuild). */
  set currentFloorPlan(plan: OfficeFloorPlan | null) {
    this.floorPlan = plan;
  }

  // ── Entity creation ──

  /** Create the correct puppet type based on the entityType discriminator. */
  createEntity(
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

  /** Place initial employees from seeds during mount. */
  placeInitialEmployees(employees: EmployeeSeed[]): void {
    if (!this.floorPlan) return;

    const overflowIds: string[] = [];
    for (const emp of employees) {
      const wsId = emp.workstationId ?? this.findAvailableWorkstation(emp.roleSlug);
      const pos = wsId ? this.floorPlan.allWorkstations.get(wsId) : null;

      const entity = this.createEntity(emp.id, emp.name, emp.entityType, emp.characterConfig);
      if (pos && wsId) {
        entity.container.position.set(pos.x, pos.y + PUPPET_Y_OFFSET);
        this.occupancy.set(wsId, emp.id);
      } else {
        overflowIds.push(emp.id);
      }

      this.entityLayer.addChild(entity.container);
      this.employeeEntities.set(emp.id, entity);
    }

    // Assign overflow employees to rest area seats
    for (const id of overflowIds) {
      this.assignToRestArea(id);
    }
  }

  // ── Add/Remove ──

  addEmployee(
    id: string,
    name: string,
    entityType: SceneEntityType = 'employee',
    roleSlug?: string,
    characterConfig?: CharacterConfig,
  ): boolean {
    if (!this.floorPlan) return false;
    if (this.employeeEntities.has(id)) return false;

    // Try to place in matching department zone first, then any free desk
    const wsId = roleSlug
      ? this.findAvailableWorkstation(roleSlug) ?? this.findUnoccupiedWorkstation()
      : this.findUnoccupiedWorkstation();
    const pos = wsId ? this.floorPlan.allWorkstations.get(wsId) : null;

    const entity = this.createEntity(id, name, entityType, characterConfig);
    entity.container.scale.set(0);
    entity.container.alpha = 0;
    this.entityLayer.addChild(entity.container);
    this.employeeEntities.set(id, entity);
    this.employeeRoleSlugs.set(id, roleSlug);

    if (pos && wsId) {
      entity.container.position.set(pos.x, pos.y + PUPPET_Y_OFFSET);
      this.occupancy.set(wsId, id);
    } else {
      // No workstation available -> assign to rest area seat
      this.assignToRestArea(id);
    }

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      this.trackManagedTween(gsap.to(entity.container.scale, { x: 1, y: 1, duration, ease }));
      this.trackManagedTween(gsap.to(entity.container, { alpha: 1, duration, ease }));
    } else {
      entity.container.scale.set(1);
      entity.container.alpha = 1;
    }

    return true;
  }

  removeEmployee(id: string): boolean {
    const entity = this.employeeEntities.get(id);
    if (!entity) return false;
    this.employeeEntities.delete(id);
    this.employeeRoleSlugs.delete(id);
    this.removeFromOccupancy(id);

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      this.trackManagedTween(gsap.to(entity.container.scale, { x: 0, y: 0, duration, ease }));
      this.trackManagedTween(gsap.to(entity.container, {
        alpha: 0, duration, ease,
        onComplete: () => {
          entity.destroy();
          entity.container.destroy({ children: true });
        },
      }));
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

    // Update occupancy
    this.removeFromOccupancy(entityId);
    this.occupancy.set(workstationId, entityId);
    this.removeFromRestArea(entityId);

    const targetX = pos.x;
    const targetY = pos.y + PUPPET_Y_OFFSET;

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      this.trackManagedTween(gsap.to(entity.container, { x: targetX, y: targetY, alpha: 1, duration, ease }));
    } else {
      entity.container.x = targetX;
      entity.container.y = targetY;
      entity.container.alpha = 1;
    }
  }

  // ── Rest area ──

  assignToRestArea(entityId: string): void {
    const entity = this.employeeEntities.get(entityId);
    if (!entity || this.restAreaSeats.length === 0) return;

    // Remove from any current seat
    this.removeFromRestArea(entityId);
    this.removeFromOccupancy(entityId);

    // Find first free seat
    const seatIdx = this.restAreaSeats.findIndex((_, i) => !this.seatAssignments.has(i));
    if (seatIdx < 0) return;

    const seat = this.restAreaSeats[seatIdx]!;
    this.seatAssignments.set(seatIdx, entityId);

    const { duration, ease } = this.motion.M1;
    if (duration > 0) {
      this.trackManagedTween(gsap.to(entity.container, { x: seat.x, y: seat.y + PUPPET_Y_OFFSET, alpha: 1, duration, ease }));
    } else {
      entity.container.x = seat.x;
      entity.container.y = seat.y + PUPPET_Y_OFFSET;
      entity.container.alpha = 1;
    }
  }

  removeFromRestArea(entityId: string): void {
    for (const [idx, id] of this.seatAssignments) {
      if (id === entityId) {
        this.seatAssignments.delete(idx);
        break;
      }
    }
  }

  isInRestArea(entityId: string): boolean {
    for (const id of this.seatAssignments.values()) {
      if (id === entityId) return true;
    }
    return false;
  }

  get restAreaSeatCount(): number {
    return this.restAreaSeats.length;
  }

  get restAreaOccupiedCount(): number {
    return this.seatAssignments.size;
  }

  // ── Layout rebuild ──

  /**
   * Recompute rest area seats from the current floor plan.
   * Called during mount and rebuildLayout.
   */
  recomputeRestAreaSeats(): void {
    this.restAreaSeats = [];
    this.seatAssignments.clear();
    if (!this.floorPlan) return;

    const restZone = this.floorPlan.zones.find((z) => z.type === 'rest_area');
    if (restZone) {
      const seatCount = Math.max(4, this.employeeEntities.size);
      this.restAreaSeats = computeRestAreaSeats(restZone, seatCount);
    }
  }

  /**
   * Initialize rest area seats based on a specific count (used during initial mount).
   */
  initRestAreaSeats(count: number): void {
    if (!this.floorPlan) return;
    const restZone = this.floorPlan.zones.find((z) => z.type === 'rest_area');
    if (restZone) {
      this.restAreaSeats = computeRestAreaSeats(restZone, Math.max(4, count));
    }
  }

  /**
   * Recompute the floor plan based on current employees and reposition everyone.
   */
  rebuildLayout(): void {
    if (!this.floorPlan) return;

    // 1. Recompute department counts from current entities
    const counts = new Map<string, number>();
    for (const [, roleSlug] of this.employeeRoleSlugs) {
      const deptId = roleSlug ? resolveEmployeeDepartment(roleSlug) : null;
      const zoneId = deptId ? `zone-${deptId}` : 'zone-dev';
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1);
    }

    // 2. Recompute floor plan
    this.floorPlan = computeFloorPlan(RD_COMPANY_ZONES, counts);

    // 3. Recompute rest area seats
    this.recomputeRestAreaSeats();

    // 4. Reposition all employees into their correct workstations.
    //    Use explicit occupancy tracking (not position-based detection) to avoid
    //    cascading desk-stealing when departments are placed sequentially.
    const occupied = new Set<string>();
    const overflowIds: string[] = [];
    this.occupancy.clear();

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
          this.occupancy.set(ws.workstationId, id);
          const entity = this.employeeEntities.get(id)!;
          entity.container.position.set(ws.x, ws.y + PUPPET_Y_OFFSET);
        } else {
          overflowIds.push(id);
        }
      }
    }

    // Overflow -> try any remaining desk, then rest area
    for (const id of overflowIds) {
      const allDesks = this.floorPlan.zones.flatMap((z) => z.workstations);
      const freeDsk = allDesks.find((w) => !occupied.has(w.workstationId));
      if (freeDsk) {
        occupied.add(freeDsk.workstationId);
        this.occupancy.set(freeDsk.workstationId, id);
        const entity = this.employeeEntities.get(id)!;
        entity.container.position.set(freeDsk.x, freeDsk.y + PUPPET_Y_OFFSET);
      } else {
        this.assignToRestArea(id);
      }
    }
  }

  // ── Workstation finding ──

  findAvailableWorkstation(roleSlug?: string): string | null {
    if (!this.floorPlan) return null;
    const deptId = roleSlug ? resolveEmployeeDepartment(roleSlug) : null;
    const zoneId = deptId ? `zone-${deptId}` : 'zone-dev';

    const zone = this.floorPlan.zones.find((z) => z.zoneId === zoneId);
    if (!zone) return null;

    const available = zone.workstations.find((ws) => !this.occupancy.has(ws.workstationId));
    return available?.workstationId ?? null;
  }

  findUnoccupiedWorkstation(): string | null {
    if (!this.floorPlan) return null;
    const allDesks = this.floorPlan.zones.flatMap((z) => z.workstations);
    return allDesks.find((d) => !this.occupancy.has(d.workstationId))?.workstationId ?? null;
  }

  // ── Prefab instances ──

  /**
   * Add a prefab instance to the scene from a seed definition.
   * Looks up the built-in catalog for the prefab definition,
   * creates a PrefabRuntime, positions it, registers bindings, and
   * adds the container to the furniture layer.
   */
  addPrefabInstance(seed: PrefabSeed): PrefabRuntime | null {
    const definition = getBuiltinPrefab(seed.prefabId);
    if (!definition) return null;

    const runtime = new PrefabRuntime(seed.instanceId, definition, seed.configOverrides);
    runtime.container.x = seed.positionX;
    runtime.container.y = seed.positionY;

    // Register bindings
    if (seed.bindings) {
      for (const b of seed.bindings) {
        runtime.bindToResource(b.slotName, b.resourceRef, b.label);
        this.prefabEventRouter.registerBinding(seed.instanceId, b.resourceRef);
      }
    }

    this.prefabEventRouter.registerRuntime(runtime);
    this.prefabRuntimes.set(seed.instanceId, runtime);

    // Add to furniture layer (L1) if available
    if (this.furnitureLayer) {
      this.furnitureLayer.addChild(runtime.container);
    }

    return runtime;
  }

  /**
   * Remove a prefab instance from the scene and clean up its resources.
   */
  removePrefabInstance(instanceId: string): void {
    const runtime = this.prefabRuntimes.get(instanceId);
    if (!runtime) return;
    this.prefabEventRouter.unregisterRuntime(instanceId);
    this.prefabRuntimes.delete(instanceId);
    runtime.destroy();
  }

  /**
   * Place initial prefab instances from seeds during mount.
   */
  placeInitialPrefabs(prefabs: PrefabSeed[]): void {
    for (const seed of prefabs) {
      this.addPrefabInstance(seed);
    }
  }

  // ── Debug ──

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

  // ── Cleanup ──

  destroy(): void {
    for (const tw of this.managedTweens) tw.kill();
    this.managedTweens = [];

    for (const entity of this.employeeEntities.values()) entity.destroy();
    this.employeeEntities.clear();
    this.employeeRoleSlugs.clear();

    // Clean up prefab runtimes and event router
    for (const runtime of this.prefabRuntimes.values()) runtime.destroy();
    this.prefabRuntimes.clear();
    this.prefabEventRouter.destroy();

    this.restAreaSeats = [];
    this.seatAssignments.clear();
    this.occupancy.clear();

    this.floorPlan = null;
  }

  // ── Private helpers ──

  private getDefaultCharacterConfig(id: string): CharacterConfig {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % DEFAULT_CHARACTER_CONFIGS.length;
    return DEFAULT_CHARACTER_CONFIGS[idx]!;
  }

  private trackManagedTween(tw: gsap.core.Tween): void {
    this.managedTweens.push(tw);
    tw.eventCallback('onComplete', () => {
      const idx = this.managedTweens.indexOf(tw);
      if (idx >= 0) this.managedTweens.splice(idx, 1);
    });
  }

  private removeFromOccupancy(entityId: string): void {
    for (const [wsId, occupant] of this.occupancy) {
      if (occupant === entityId) {
        this.occupancy.delete(wsId);
        break;
      }
    }
  }

  /** Compute department counts from initial seed employees. */
  computeDepartmentCounts(employees: EmployeeSeed[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const emp of employees) {
      const deptId = emp.roleSlug ? resolveEmployeeDepartment(emp.roleSlug) : null;
      const zoneId = deptId ? `zone-${deptId}` : 'zone-dev';
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1);
    }
    return counts;
  }
}

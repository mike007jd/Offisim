import type { PrefabInstanceRow, RoleSlug, Zone } from '@offisim/shared-types';
import {
  REQUIRED_ARCHETYPES,
  SYSTEM_ZONE_TEMPLATES,
  extractZoneSlug,
  getSystemZoneDefaultPrefabs,
  normalizeZoneId,
  resolveHomeZone,
  resolveNonOverlappingPrefabOffsets,
  resolveZoneForRole,
  templateToZone,
} from '@offisim/shared-types';
import { buildZoneHomeWorkstation } from './home-workstation.js';
import { dehydrateZone } from './zone-service.js';

import type { EventBus } from '../events/event-bus.js';
import { employeeCreated } from '../events/event-factories.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';
import type { ZoneRepository } from '../repos/zone-repository.js';
import type {
  EmployeeRepository,
  OfficeLayoutRepository,
  WorkstationRepository,
} from '../runtime/repositories.js';
import type { CompanyTemplateDefinition, TemplateZoneBlueprint } from '../templates/index.js';
import {
  getTemplate,
  listTemplates as listAllTemplates,
  serializeTemplatePersona,
} from '../templates/index.js';
import { ZoneService } from './zone-service.js';

function getZoneTemplates(template: CompanyTemplateDefinition): readonly TemplateZoneBlueprint[] {
  return template.zones ?? (SYSTEM_ZONE_TEMPLATES as readonly TemplateZoneBlueprint[]);
}

function buildAvailableZones(
  companyId: string,
  template: CompanyTemplateDefinition,
  zoneTemplates = getZoneTemplates(template),
): Zone[] {
  return zoneTemplates.map((zoneTemplate) => templateToZone(zoneTemplate, companyId));
}

/** Get zone center coordinates from the current template zone definitions by slug. */
function getZoneCenter(
  zoneTemplates: readonly TemplateZoneBlueprint[],
  zoneId: string,
): { cx: number; cz: number } {
  const slug = extractZoneSlug(zoneId);
  const t = zoneTemplates.find((zone) => zone.slug === slug);
  return t ? { cx: t.cx, cz: t.cz } : { cx: 0, cz: 0 };
}

function createPrefabInstance(params: {
  companyId: string;
  prefabId: string;
  zoneId: string;
  x: number;
  z: number;
  now: string;
  rotation?: 0 | 90 | 180 | 270;
}): PrefabInstanceRow {
  return {
    instance_id: crypto.randomUUID(),
    company_id: params.companyId,
    prefab_id: params.prefabId,
    zone_id: normalizeZoneId(params.companyId, params.zoneId),
    position_x: params.x,
    position_y: params.z,
    rotation: params.rotation ?? 0,
    bindings_json: null,
    config_json: null,
    enabled: 1,
    created_at: params.now,
    updated_at: params.now,
  };
}

function buildZoneCounts(
  createdEmployees: Array<{ role_slug: RoleSlug }>,
  availableZones: readonly Zone[],
): Map<string, number> {
  const zoneCounts = new Map<string, number>();

  for (const employee of createdEmployees) {
    const matchedZone = resolveZoneForRole(employee.role_slug, availableZones);
    if (matchedZone?.archetype === 'workspace') {
      zoneCounts.set(matchedZone.zoneId, (zoneCounts.get(matchedZone.zoneId) ?? 0) + 1);
    }
  }

  return zoneCounts;
}

function buildDefaultPrefabInstances(
  companyId: string,
  zoneTemplates: readonly TemplateZoneBlueprint[],
  now: string,
): PrefabInstanceRow[] {
  const prefabInstances: PrefabInstanceRow[] = [];

  for (const zoneTemplate of zoneTemplates) {
    const center = getZoneCenter(zoneTemplates, zoneTemplate.slug);

    if (zoneTemplate.defaultPrefabs && zoneTemplate.defaultPrefabs.length > 0) {
      for (const prefab of resolveNonOverlappingPrefabOffsets(
        zoneTemplate.defaultPrefabs,
        zoneTemplate,
      )) {
        prefabInstances.push(
          createPrefabInstance({
            companyId,
            prefabId: prefab.prefabId,
            zoneId: zoneTemplate.slug,
            x: center.cx + prefab.offsetX,
            z: center.cz + prefab.offsetZ,
            rotation: prefab.rotation ?? 0,
            now,
          }),
        );
      }
      continue;
    }

    if (zoneTemplate.archetype === 'workspace') {
      continue;
    }

    const defaults = resolveNonOverlappingPrefabOffsets(
      getSystemZoneDefaultPrefabs(zoneTemplate),
      zoneTemplate,
    );
    for (const prefab of defaults) {
      prefabInstances.push(
        createPrefabInstance({
          companyId,
          prefabId: prefab.prefabId,
          zoneId: zoneTemplate.slug,
          x: center.cx + prefab.offsetX,
          z: center.cz + prefab.offsetZ,
          rotation: prefab.rotation ?? 0,
          now,
        }),
      );
    }
  }

  return prefabInstances;
}

function buildWorkspacePrefabInstances(
  companyId: string,
  createdEmployees: Array<{ role_slug: RoleSlug }>,
  zoneTemplates: readonly TemplateZoneBlueprint[],
  availableZones: readonly Zone[],
  now: string,
): PrefabInstanceRow[] {
  const prefabInstances: PrefabInstanceRow[] = [];
  const zoneCounts = buildZoneCounts(createdEmployees, availableZones);

  for (const zoneTemplate of zoneTemplates) {
    if (zoneTemplate.archetype !== 'workspace') {
      continue;
    }
    const zoneId = normalizeZoneId(companyId, zoneTemplate.slug);
    const center = getZoneCenter(zoneTemplates, zoneTemplate.slug);
    const count = zoneCounts.get(zoneId) ?? zoneTemplate.deskSlots;
    const defaults =
      zoneTemplate.defaultPrefabs && zoneTemplate.defaultPrefabs.length > 0
        ? resolveNonOverlappingPrefabOffsets(zoneTemplate.defaultPrefabs, zoneTemplate)
        : resolveNonOverlappingPrefabOffsets(
            getSystemZoneDefaultPrefabs(zoneTemplate, { occupiedSeats: count }),
            zoneTemplate,
          );

    for (const prefab of defaults) {
      prefabInstances.push(
        createPrefabInstance({
          companyId,
          prefabId: prefab.prefabId,
          zoneId: zoneTemplate.slug,
          x: center.cx + prefab.offsetX,
          z: center.cz + prefab.offsetZ,
          rotation: prefab.rotation ?? 0,
          now,
        }),
      );
    }
  }

  return prefabInstances;
}

function buildPrefabInstances(
  companyId: string,
  createdEmployees: Array<{ role_slug: RoleSlug }>,
  zoneTemplates: readonly TemplateZoneBlueprint[],
  availableZones: readonly Zone[],
  now: string,
): PrefabInstanceRow[] {
  return [
    ...buildWorkspacePrefabInstances(
      companyId,
      createdEmployees,
      zoneTemplates,
      availableZones,
      now,
    ),
    ...buildDefaultPrefabInstances(companyId, zoneTemplates, now),
  ];
}

function validateTemplateZones(template: CompanyTemplateDefinition): void {
  // Validate against the effective zones (custom `zones` or the system fallback),
  // so zone-less templates are not silently exempted from these invariants.
  const zoneTemplates = getZoneTemplates(template);

  const slugSet = new Set<string>();
  const workspaceRoleToZone = new Map<RoleSlug, string>();
  const availableZones = buildAvailableZones('', template, zoneTemplates);

  for (const zoneTemplate of zoneTemplates) {
    if (slugSet.has(zoneTemplate.slug)) {
      throw new Error(
        `Template "${template.id}" defines duplicate zone slug "${zoneTemplate.slug}"`,
      );
    }
    slugSet.add(zoneTemplate.slug);

    if (zoneTemplate.archetype !== 'workspace') {
      continue;
    }

    for (const role of zoneTemplate.targetRoles) {
      const previous = workspaceRoleToZone.get(role);
      if (previous) {
        throw new Error(
          `Template "${template.id}" maps role "${role}" to multiple workspace zones: "${previous}" and "${zoneTemplate.slug}"`,
        );
      }
      workspaceRoleToZone.set(role, zoneTemplate.slug);
    }
  }

  for (const requiredArchetype of REQUIRED_ARCHETYPES) {
    const hasRequiredZone = zoneTemplates.some((zone) => zone.archetype === requiredArchetype);
    if (!hasRequiredZone) {
      throw new Error(
        `Template "${template.id}" must include a "${requiredArchetype}" zone archetype`,
      );
    }
  }

  for (const employee of template.employees) {
    const matchedZone = resolveZoneForRole(employee.roleSlug, availableZones);
    if (!matchedZone || matchedZone.archetype !== 'workspace') {
      throw new Error(
        `Template "${template.id}" has employee role "${employee.roleSlug}" without a matching workspace zone`,
      );
    }
  }
}

// Fail fast at module load: validate every built-in template's zones together so
// a malformed template surfaces once at startup rather than per-user-per-template
// at materialize-time.
for (const template of listAllTemplates()) {
  validateTemplateZones(template);
}

// ── Service ────────────────────────────────────────────────────────

export class CompanyTemplateService {
  private readonly zoneService: ZoneService | null;
  private readonly zoneRepo: ZoneRepository | null;

  constructor(
    private readonly employeeRepo: EmployeeRepository,
    private readonly officeLayoutRepo: OfficeLayoutRepository,
    private readonly eventBus: EventBus,
    private readonly prefabRepo?: PrefabInstanceRepository,
    private readonly transact?: <T>(fn: () => T) => T,
    zoneRepo?: ZoneRepository,
    private readonly workstationRepo?: WorkstationRepository,
  ) {
    this.zoneRepo = zoneRepo ?? null;
    this.zoneService = zoneRepo ? new ZoneService(zoneRepo) : null;
  }

  /** List available built-in templates */
  listTemplates(): readonly CompanyTemplateDefinition[] {
    return listAllTemplates();
  }

  /**
   * Materialize a template into a real company with employees, layout, zones,
   * home-zone workstations, and (optionally) default prefab instances.
   * Returns the IDs of all created entities.
   *
   * When `transact` is provided (Drizzle/better-sqlite3 runtime), the employee /
   * layout / zone / prefab writes are wrapped in a single SQLite transaction for
   * atomicity. Home-workstation creation + employee workstation assignment run
   * afterward as awaited, idempotent upserts (workstation id == zone id), so the
   * office scene resolves every employee's seat by `workstation_id === zone_id`.
   */
  async materializeTemplate(
    templateId: string,
    companyId: string,
  ): Promise<{
    employeeIds: string[];
    layoutId: string | null;
    prefabInstanceIds: string[];
  }> {
    const template = getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }
    validateTemplateZones(template);

    const now = new Date().toISOString();
    const zoneTemplates = getZoneTemplates(template);
    const availableZones = buildAvailableZones(companyId, template, zoneTemplates);

    const employeeIds: string[] = [];
    const createdEmployees: Array<{ role_slug: RoleSlug }> = template.employees.map((emp) => ({
      role_slug: emp.roleSlug,
    }));
    let layoutId: string | null = null;
    const prefabInstanceIds: string[] = [];

    if (this.transact) {
      // ── Drizzle path: all writes in one transaction ──────────────────────
      // Pre-generate all IDs so we don't need to await inside the sync callback.
      // Events are collected and fired after the transaction commits.
      type EmployeeEvent = { employeeId: string; name: string; roleSlug: RoleSlug };
      const pendingEvents: EmployeeEvent[] = [];

      for (const emp of template.employees) {
        const empId = crypto.randomUUID();
        employeeIds.push(empId);
        pendingEvents.push({ employeeId: empId, name: emp.name, roleSlug: emp.roleSlug });
      }

      layoutId = `layout_${crypto.randomUUID()}`;

      const prefabInstances = this.prefabRepo
        ? buildPrefabInstances(companyId, createdEmployees, zoneTemplates, availableZones, now)
        : [];
      prefabInstanceIds.push(...prefabInstances.map((instance) => instance.instance_id));

      this.transact(() => {
        // Employees — pass pre-generated IDs so the repo uses them deterministically.
        for (const [i, emp] of template.employees.entries()) {
          void this.employeeRepo.create({
            employee_id: employeeIds[i],
            company_id: companyId,
            source_asset_id: null,
            source_package_id: null,
            name: emp.name,
            role_slug: emp.roleSlug,
            persona_json: serializeTemplatePersona(emp),
            config_json: null,
          });
        }

        // Layout
        void this.officeLayoutRepo.create({
          layout_id: layoutId as string,
          company_id: companyId,
          name: `${template.name} Layout`,
          layout_json: JSON.stringify({ preset: template.layoutPreset }),
          is_active: 1,
        });

        // Zones — seed system zones inline (NOT via zoneService.seedSystemZones
        // because its `await this.repo.create(...)` would suspend as a microtask
        // and leak zones 2..N outside the transaction). Since transact is sync
        // and the drizzle repo create is sync-bodied, a direct loop keeps every
        // write inside the same BEGIN...COMMIT span.
        if (this.zoneRepo) {
          for (const t of zoneTemplates) {
            void this.zoneRepo.create(dehydrateZone(templateToZone(t, companyId)));
          }
        }

        // Prefabs
        if (this.prefabRepo) {
          for (const inst of prefabInstances) {
            void this.prefabRepo.create(inst);
          }
        }
      });

      // Emit events after transaction commits
      for (const [i, ev] of pendingEvents.entries()) {
        this.eventBus.emit(
          employeeCreated(companyId, employeeIds[i] ?? ev.employeeId, ev.name, ev.roleSlug),
        );
      }
    } else {
      // ── Async/memory-repos path ────────────────────────────────────────────

      for (const emp of template.employees) {
        const result = await this.employeeRepo.create({
          company_id: companyId,
          source_asset_id: null,
          source_package_id: null,
          name: emp.name,
          role_slug: emp.roleSlug,
          persona_json: serializeTemplatePersona(emp),
          config_json: null,
        });
        employeeIds.push(result.employee_id);

        // Emit employee.created so SceneManager and UI hooks pick up the new employee
        this.eventBus.emit(employeeCreated(companyId, result.employee_id, emp.name, emp.roleSlug));
      }

      layoutId = `layout_${crypto.randomUUID()}`;
      await this.officeLayoutRepo.create({
        layout_id: layoutId,
        company_id: companyId,
        name: `${template.name} Layout`,
        layout_json: JSON.stringify({ preset: template.layoutPreset }),
        is_active: 1,
      });

      if (this.zoneService) {
        await this.zoneService.seedSystemZones(companyId, zoneTemplates);
      }

      if (this.prefabRepo) {
        const prefabInstances = buildPrefabInstances(
          companyId,
          createdEmployees,
          zoneTemplates,
          availableZones,
          now,
        );
        for (const instance of prefabInstances) {
          await this.prefabRepo.create(instance);
          prefabInstanceIds.push(instance.instance_id);
        }
      }
    }

    // ── Home-zone workstations + employee assignment (shared, awaited) ────────
    // Runs after the create work so the referenced zone rows already exist. The
    // workstation row id equals the zone id; upserts are idempotent.
    await this.assignHomeWorkstations(companyId, template, availableZones, employeeIds, now);

    return { employeeIds, layoutId, prefabInstanceIds };
  }

  /**
   * Create one zone-level workstation per occupied home zone and point each
   * employee's `workstation_id` at it. Skips silently if no workstation repo is
   * configured (the employee still has no seat, matching the prior behavior).
   */
  private async assignHomeWorkstations(
    companyId: string,
    template: CompanyTemplateDefinition,
    availableZones: readonly Zone[],
    employeeIds: readonly string[],
    now: string,
  ): Promise<void> {
    // No workstation repo → leave employees seatless rather than pointing
    // `workstation_id` at a row that was never created (a dangling reference).
    const workstationRepo = this.workstationRepo;
    if (!workstationRepo) return;

    const homeZoneByIndex = template.employees.map((emp) =>
      resolveHomeZone({ role: emp.roleSlug, homeZoneSlug: emp.homeZoneSlug }, availableZones),
    );

    const seatZones = new Map<string, Zone>();
    const counts = new Map<string, number>();
    for (const zone of homeZoneByIndex) {
      if (!zone) continue;
      seatZones.set(zone.zoneId, zone);
      counts.set(zone.zoneId, (counts.get(zone.zoneId) ?? 0) + 1);
    }
    for (const [zoneId, zone] of seatZones) {
      await workstationRepo.upsert(
        buildZoneHomeWorkstation(zone, companyId, counts.get(zoneId) ?? 1, now),
      );
    }

    for (const [i, zone] of homeZoneByIndex.entries()) {
      const employeeId = employeeIds[i];
      if (zone && employeeId) {
        await this.employeeRepo.update(employeeId, { workstation_id: zone.zoneId });
      }
    }
  }
}

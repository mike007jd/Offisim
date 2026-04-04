import type {
  PrefabInstanceRow,
  RoleSlug,
  Zone,
  ZoneArchetype,
} from '@offisim/shared-types';
import {
  REQUIRED_ARCHETYPES,
  SYSTEM_ZONE_TEMPLATES,
  extractZoneSlug,
  normalizeZoneId,
  resolveZoneForRole,
  templateToZone,
} from '@offisim/shared-types';

import type { EventBus } from '../events/event-bus.js';
import { employeeCreated } from '../events/event-factories.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';
import type { ZoneRepository } from '../repos/zone-repository.js';
import type {
  EmployeeRepository,
  OfficeLayoutRepository,
  SopTemplateRepository,
} from '../runtime/repositories.js';
import type { CompanyTemplate, TemplateZoneBlueprint } from '../templates/index.js';
import { getTemplate, listTemplates as listAllTemplates } from '../templates/index.js';
import { ZoneService } from './zone-service.js';

function getZoneTemplates(template: CompanyTemplate): readonly TemplateZoneBlueprint[] {
  return template.zones ?? (SYSTEM_ZONE_TEMPLATES as readonly TemplateZoneBlueprint[]);
}

function buildAvailableZones(
  companyId: string,
  template: CompanyTemplate,
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

/** Compute a grid position within a zone for the i-th item. Spacing = 2.5 units. */
function computeGridPosition(
  cx: number,
  cz: number,
  index: number,
  cols = 3,
  spacing = 2.5,
): { x: number; z: number } {
  const col = index % cols;
  const row = Math.floor(index / cols);
  const offsetX = (col - (cols - 1) / 2) * spacing;
  const offsetZ = row * spacing;
  return { x: cx + offsetX, z: cz + offsetZ };
}

// ── Default prefab layouts per utility zone type ───────────────────

interface DefaultPrefab {
  readonly prefabId: string;
  readonly rotation?: 0 | 90 | 180 | 270;
}

function getDefaultPrefabs(archetype: ZoneArchetype | null): DefaultPrefab[] {
  switch (archetype) {
    case 'library':
      return [
        { prefabId: 'bookshelf-double' },
        { prefabId: 'bookshelf-double' },
        { prefabId: 'reading-table' },
        { prefabId: 'chair-standalone' },
        { prefabId: 'plant-large' },
      ];
    case 'rest':
      return [
        { prefabId: 'sofa-set' },
        { prefabId: 'coffee-table' },
        { prefabId: 'vending-machine' },
        { prefabId: 'plant-small' },
      ];
    case 'meeting':
      return [{ prefabId: 'meeting-table-4' }, { prefabId: 'whiteboard' }];
    case 'server':
      return [
        { prefabId: 'server-rack-2u' },
        { prefabId: 'cable-tray' },
        { prefabId: 'network-switch' },
      ];
    default:
      return [];
  }
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
      for (const prefab of zoneTemplate.defaultPrefabs) {
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

    const defaults = getDefaultPrefabs(zoneTemplate.archetype);
    for (const [index, prefab] of defaults.entries()) {
      const position = computeGridPosition(center.cx, center.cz, index);
      prefabInstances.push(
        createPrefabInstance({
          companyId,
          prefabId: prefab.prefabId,
          zoneId: zoneTemplate.slug,
          x: position.x,
          z: position.z,
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

  for (const [zoneId, count] of zoneCounts) {
    const center = getZoneCenter(zoneTemplates, zoneId);
    for (let index = 0; index < count; index++) {
      const position = computeGridPosition(center.cx, center.cz, index);
      prefabInstances.push(
        createPrefabInstance({
          companyId,
          prefabId: 'workstation-standard',
          zoneId,
          x: position.x,
          z: position.z,
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
    ...buildWorkspacePrefabInstances(companyId, createdEmployees, zoneTemplates, availableZones, now),
    ...buildDefaultPrefabInstances(companyId, zoneTemplates, now),
  ];
}

function validateTemplateZones(template: CompanyTemplate): void {
  if (!template.zones) {
    return;
  }

  const slugSet = new Set<string>();
  const workspaceRoleToZone = new Map<RoleSlug, string>();
  const availableZones = buildAvailableZones('', template, template.zones);

  for (const zoneTemplate of template.zones) {
    if (slugSet.has(zoneTemplate.slug)) {
      throw new Error(`Template "${template.id}" defines duplicate zone slug "${zoneTemplate.slug}"`);
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
    const hasRequiredZone = template.zones.some((zone) => zone.archetype === requiredArchetype);
    if (!hasRequiredZone) {
      throw new Error(
        `Template "${template.id}" must include a "${requiredArchetype}" zone archetype`,
      );
    }
  }

  for (const employee of template.employees) {
    const matchedZone = resolveZoneForRole(employee.role_slug, availableZones);
    if (!matchedZone || matchedZone.archetype !== 'workspace') {
      throw new Error(
        `Template "${template.id}" has employee role "${employee.role_slug}" without a matching workspace zone`,
      );
    }
  }
}

// ── Service ────────────────────────────────────────────────────────

export class CompanyTemplateService {
  private readonly zoneService: ZoneService | null;

  constructor(
    private readonly employeeRepo: EmployeeRepository,
    private readonly sopTemplateRepo: SopTemplateRepository,
    private readonly officeLayoutRepo: OfficeLayoutRepository,
    private readonly eventBus: EventBus,
    private readonly prefabRepo?: PrefabInstanceRepository,
    private readonly transact?: <T>(fn: () => T) => T,
    zoneRepo?: ZoneRepository,
  ) {
    this.zoneService = zoneRepo ? new ZoneService(zoneRepo) : null;
  }

  /** List available built-in templates */
  listTemplates(): CompanyTemplate[] {
    return listAllTemplates();
  }

  /**
   * Materialize a template into a real company with employees, SOPs, layout,
   * and (optionally) default prefab instances for each zone.
   * Returns the IDs of all created entities.
   *
   * When `transact` is provided (Drizzle/better-sqlite3 runtime), all DB writes
   * are wrapped in a single SQLite transaction for atomicity. Event emissions
   * happen after the transaction commits.
   */
  async materializeTemplate(
    templateId: string,
    companyId: string,
  ): Promise<{
    employeeIds: string[];
    sopTemplateIds: string[];
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

    if (this.transact) {
      // ── Drizzle path: all writes in one transaction ──────────────────────
      // Pre-generate all IDs so we don't need to await inside the sync callback.
      // Events are collected and fired after the transaction commits.

      type EmployeeEvent = { employeeId: string; name: string; roleSlug: RoleSlug };
      const pendingEvents: EmployeeEvent[] = [];

      const employeeIds: string[] = [];
      const createdEmployees: Array<{ role_slug: RoleSlug }> = [];

      // Pre-generate employee IDs using the same UUID strategy as the Drizzle repo.
      // Note: Drizzle's employees.create() generates its own ID internally.
      // We capture it via the synchronously-settling promise inside the transaction.
      for (const emp of template.employees) {
        const empId = crypto.randomUUID();
        employeeIds.push(empId);
        createdEmployees.push({ role_slug: emp.role_slug });
        pendingEvents.push({
          employeeId: empId,
          name: emp.name,
          roleSlug: emp.role_slug,
        });
      }

      const sopTemplateIds: string[] = template.sops.map(() => `sop_${crypto.randomUUID()}`);
      const layoutId = `layout_${crypto.randomUUID()}`;
      const prefabInstanceIds: string[] = [];

      // Pre-build all prefab instances
      const prefabInstances = this.prefabRepo
        ? buildPrefabInstances(companyId, createdEmployees, zoneTemplates, availableZones, now)
        : [];
      prefabInstanceIds.push(...prefabInstances.map((instance) => instance.instance_id));

      // Capture actual employee IDs from the Drizzle repo (it generates its own UUID).
      const capturedEmployeeIds: string[] = [];

      this.transact(() => {
        // Employees
        for (const [i, emp] of template.employees.entries()) {
          void this.employeeRepo
            .create({
              company_id: companyId,
              source_asset_id: null,
              source_package_id: null,
              name: emp.name,
              role_slug: emp.role_slug,
              persona_json: emp.persona_json,
              config_json: emp.config_json,
            })
            .then((r) => {
              capturedEmployeeIds[i] = r.employee_id;
            });
        }

        // SOPs
        for (const [i, sop] of template.sops.entries()) {
          const sopTemplateId = sopTemplateIds[i];
          if (!sopTemplateId) {
            throw new Error(`Missing SOP template id for index ${i}`);
          }
          void this.sopTemplateRepo.create({
            sop_template_id: sopTemplateId,
            company_id: companyId,
            name: sop.name,
            description: sop.description,
            definition_json: JSON.stringify(sop),
            source_thread_id: null,
            source_url: null,
            version: null,
            last_synced_at: null,
          });
        }

        // Layout
        void this.officeLayoutRepo.create({
          layout_id: layoutId,
          company_id: companyId,
          name: `${template.name} Layout`,
          layout_json: JSON.stringify({ preset: template.layoutPreset }),
          is_active: 1,
        });

        // Zones — seed system zones from SYSTEM_ZONE_TEMPLATES
        if (this.zoneService) {
          void this.zoneService.seedSystemZones(companyId, zoneTemplates);
        }

        // Prefabs
        if (this.prefabRepo) {
          for (const inst of prefabInstances) {
            void this.prefabRepo.create(inst);
          }
        }
      });

      // Emit events after transaction commits (use captured IDs)
      const finalEmployeeIds = capturedEmployeeIds.length > 0 ? capturedEmployeeIds : employeeIds;
      for (const [i, ev] of pendingEvents.entries()) {
        this.eventBus.emit(
          employeeCreated(companyId, finalEmployeeIds[i] ?? ev.employeeId, ev.name, ev.roleSlug),
        );
      }

      return {
        employeeIds: finalEmployeeIds,
        sopTemplateIds,
        layoutId,
        prefabInstanceIds,
      };
    }

    // ── Async/memory-repos path ──────────────────────────────────────────────

    // ── Create employees ───────────────────────────────────────────
    const employeeIds: string[] = [];
    const createdEmployees: Array<{ role_slug: RoleSlug }> = [];

    for (const emp of template.employees) {
      const result = await this.employeeRepo.create({
        company_id: companyId,
        source_asset_id: null,
        source_package_id: null,
        name: emp.name,
        role_slug: emp.role_slug,
        persona_json: emp.persona_json,
        config_json: emp.config_json,
      });
      employeeIds.push(result.employee_id);
      createdEmployees.push({ role_slug: emp.role_slug });

      // Emit employee.created so SceneManager and UI hooks pick up the new employee
      this.eventBus.emit(
        employeeCreated(companyId, result.employee_id, emp.name, emp.role_slug),
      );
    }

    // ── Create SOP templates ───────────────────────────────────────
    const sopTemplateIds: string[] = [];
    for (const sop of template.sops) {
      const sopTemplateId = `sop_${crypto.randomUUID()}`;
      await this.sopTemplateRepo.create({
        sop_template_id: sopTemplateId,
        company_id: companyId,
        name: sop.name,
        description: sop.description,
        definition_json: JSON.stringify(sop),
        source_thread_id: null,
        source_url: null,
        version: null,
        last_synced_at: null,
      });
      sopTemplateIds.push(sopTemplateId);
    }

    // ── Create office layout ───────────────────────────────────────
    let layoutId: string | null = null;
    layoutId = `layout_${crypto.randomUUID()}`;
    await this.officeLayoutRepo.create({
      layout_id: layoutId,
      company_id: companyId,
      name: `${template.name} Layout`,
      layout_json: JSON.stringify({ preset: template.layoutPreset }),
      is_active: 1,
    });

    // ── Seed system zones ──────────────────────────────────────────
    if (this.zoneService) {
      await this.zoneService.seedSystemZones(companyId, zoneTemplates);
    }

    // ── Create default prefab instances (if repo provided) ─────────
    const prefabInstanceIds: string[] = [];

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

    return { employeeIds, sopTemplateIds, layoutId, prefabInstanceIds };
  }
}

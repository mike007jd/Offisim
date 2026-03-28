import type { PrefabInstanceRow, RoleSlug } from '@offisim/shared-types';
import { ROLE_TO_DEPARTMENT, SYSTEM_ZONE_TEMPLATES } from '@offisim/shared-types';

import type { EventBus } from '../events/event-bus.js';
import { employeeCreated } from '../events/event-factories.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';
import type { ZoneRepository } from '../repos/zone-repository.js';
import { ZoneService } from './zone-service.js';
import type {
  EmployeeRepository,
  OfficeLayoutRepository,
  SopTemplateRepository,
} from '../runtime/repositories.js';
import type { CompanyTemplate } from '../templates/index.js';
import { getTemplate, listTemplates as listAllTemplates } from '../templates/index.js';

function resolveRoleDepartment(roleSlug: string): string | null {
  return ROLE_TO_DEPARTMENT.get(roleSlug as RoleSlug) ?? null;
}

/** Get zone center coordinates from SYSTEM_ZONE_TEMPLATES by slug. */
function getZoneCenter(slug: string): { cx: number; cz: number } {
  const t = SYSTEM_ZONE_TEMPLATES.find((z) => z.slug === slug);
  return t ? { cx: t.cx, cz: t.cz } : { cx: 0, cz: 0 };
}

/** Compute a grid position within a zone for the i-th item. Spacing = 2.5 units. */
function computeGridPosition(
  cx: number,
  cz: number,
  index: number,
  cols: number = 3,
  spacing: number = 2.5,
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
}

function getDefaultPrefabs(zoneType: string): DefaultPrefab[] {
  switch (zoneType) {
    case 'library':
      return [
        { prefabId: 'bookshelf-double' },
        { prefabId: 'bookshelf-double' },
        { prefabId: 'reading-table' },
        { prefabId: 'chair-standalone' },
        { prefabId: 'plant-large' },
      ];
    case 'rest_area':
      return [
        { prefabId: 'sofa-set' },
        { prefabId: 'coffee-table' },
        { prefabId: 'vending-machine' },
        { prefabId: 'plant-small' },
      ];
    case 'meeting_room':
      return [{ prefabId: 'meeting-table-4' }, { prefabId: 'whiteboard' }];
    case 'server_room':
      return [
        { prefabId: 'server-rack-2u' },
        { prefabId: 'cable-tray' },
        { prefabId: 'network-switch' },
      ];
    default:
      return [];
  }
}

// ── Utility zone definitions ───────────────────────────────────────

const UTILITY_ZONES = [
  { zoneId: 'zone-library', type: 'library' },
  { zoneId: 'zone-rest', type: 'rest_area' },
  { zoneId: 'zone-meeting', type: 'meeting_room' },
  { zoneId: 'zone-server', type: 'server_room' },
] as const;

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

    const now = new Date().toISOString();

    if (this.transact) {
      // ── Drizzle path: all writes in one transaction ──────────────────────
      // Pre-generate all IDs so we don't need to await inside the sync callback.
      // Events are collected and fired after the transaction commits.

      type EmployeeEvent = { employeeId: string; name: string; roleSlug: string };
      const pendingEvents: EmployeeEvent[] = [];

      const employeeIds: string[] = [];
      const createdEmployees: Array<{ role_slug: string }> = [];

      // Pre-generate employee IDs using the same UUID strategy as the Drizzle repo.
      // Note: Drizzle's employees.create() generates its own ID internally.
      // We capture it via the synchronously-settling promise inside the transaction.
      for (const emp of template.employees) {
        const empId = crypto.randomUUID();
        employeeIds.push(empId);
        createdEmployees.push({ role_slug: emp.role_slug });
        pendingEvents.push({ employeeId: empId, name: emp.name, roleSlug: emp.role_slug });
      }

      const sopTemplateIds: string[] = template.sops.map(() => `sop_${crypto.randomUUID()}`);
      const layoutId = `layout_${crypto.randomUUID()}`;
      const prefabInstanceIds: string[] = [];

      // Pre-build all prefab instances
      const prefabInstances: PrefabInstanceRow[] = [];
      if (this.prefabRepo) {
        const zoneCounts = new Map<string, number>();
        for (const emp of createdEmployees) {
          const dept = resolveRoleDepartment(emp.role_slug);
          if (dept) {
            const zoneId = `zone-${dept}`;
            zoneCounts.set(zoneId, (zoneCounts.get(zoneId) ?? 0) + 1);
          }
        }
        for (const [zoneId, count] of zoneCounts) {
          const center = getZoneCenter(zoneId);
          for (let i = 0; i < count; i++) {
            const pos = computeGridPosition(center.cx, center.cz, i);
            const inst: PrefabInstanceRow = {
              instance_id: crypto.randomUUID(),
              company_id: companyId,
              prefab_id: 'workstation-standard',
              zone_id: zoneId,
              position_x: pos.x,
              position_y: pos.z,
              rotation: 0,
              bindings_json: null,
              config_json: null,
              enabled: 1,
              created_at: now,
              updated_at: now,
            };
            prefabInstances.push(inst);
            prefabInstanceIds.push(inst.instance_id);
          }
        }
        for (const uz of UTILITY_ZONES) {
          const center = getZoneCenter(uz.zoneId);
          const defaults = getDefaultPrefabs(uz.type);
          for (let i = 0; i < defaults.length; i++) {
            const d = defaults[i]!;
            const pos = computeGridPosition(center.cx, center.cz, i);
            const inst: PrefabInstanceRow = {
              instance_id: crypto.randomUUID(),
              company_id: companyId,
              prefab_id: d.prefabId,
              zone_id: uz.zoneId,
              position_x: pos.x,
              position_y: pos.z,
              rotation: 0,
              bindings_json: null,
              config_json: null,
              enabled: 1,
              created_at: now,
              updated_at: now,
            };
            prefabInstances.push(inst);
            prefabInstanceIds.push(inst.instance_id);
          }
        }
      }

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
          void this.zoneService.seedSystemZones(companyId);
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
    const createdEmployees: Array<{ role_slug: string }> = [];

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
      this.eventBus.emit(employeeCreated(companyId, result.employee_id, emp.name, emp.role_slug));
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
      await this.zoneService.seedSystemZones(companyId);
    }

    // ── Create default prefab instances (if repo provided) ─────────
    const prefabInstanceIds: string[] = [];

    if (this.prefabRepo) {
      // Determine zone → employee count map from created employees
      const zoneCounts = new Map<string, number>();
      for (const emp of createdEmployees) {
        const dept = resolveRoleDepartment(emp.role_slug);
        if (dept) {
          const zoneId = `zone-${dept}`;
          zoneCounts.set(zoneId, (zoneCounts.get(zoneId) ?? 0) + 1);
        }
      }

      // Create workspace prefabs for department zones (one workstation per employee)
      for (const [zoneId, count] of zoneCounts) {
        const center = getZoneCenter(zoneId);
        for (let i = 0; i < count; i++) {
          const pos = computeGridPosition(center.cx, center.cz, i);
          const instance: PrefabInstanceRow = {
            instance_id: crypto.randomUUID(),
            company_id: companyId,
            prefab_id: 'workstation-standard',
            zone_id: zoneId,
            position_x: pos.x,
            position_y: pos.z,
            rotation: 0,
            bindings_json: null,
            config_json: null,
            enabled: 1,
            created_at: now,
            updated_at: now,
          };
          await this.prefabRepo.create(instance);
          prefabInstanceIds.push(instance.instance_id);
        }
      }

      // Create utility zone default prefabs
      for (const uz of UTILITY_ZONES) {
        const center = getZoneCenter(uz.zoneId);
        const defaults = getDefaultPrefabs(uz.type);
        for (let i = 0; i < defaults.length; i++) {
          const d = defaults[i]!;
          const pos = computeGridPosition(center.cx, center.cz, i);
          const instance: PrefabInstanceRow = {
            instance_id: crypto.randomUUID(),
            company_id: companyId,
            prefab_id: d.prefabId,
            zone_id: uz.zoneId,
            position_x: pos.x,
            position_y: pos.z,
            rotation: 0,
            bindings_json: null,
            config_json: null,
            enabled: 1,
            created_at: now,
            updated_at: now,
          };
          await this.prefabRepo.create(instance);
          prefabInstanceIds.push(instance.instance_id);
        }
      }
    }

    return { employeeIds, sopTemplateIds, layoutId, prefabInstanceIds };
  }
}

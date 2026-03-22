import type { PrefabInstanceRow, RoleSlug } from '@aics/shared-types';
import { ROLE_TO_DEPARTMENT } from '@aics/shared-types';

import type { EventBus } from '../events/event-bus.js';
import { employeeCreated } from '../events/event-factories.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';
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
  constructor(
    private readonly employeeRepo: EmployeeRepository,
    private readonly sopTemplateRepo: SopTemplateRepository,
    private readonly officeLayoutRepo: OfficeLayoutRepository,
    private readonly eventBus: EventBus,
    private readonly prefabRepo?: PrefabInstanceRepository,
  ) {}

  /** List available built-in templates */
  listTemplates(): CompanyTemplate[] {
    return listAllTemplates();
  }

  /**
   * Materialize a template into a real company with employees, SOPs, layout,
   * and (optionally) default prefab instances for each zone.
   * Returns the IDs of all created entities.
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
        for (let i = 0; i < count; i++) {
          const instance: PrefabInstanceRow = {
            instance_id: crypto.randomUUID(),
            company_id: companyId,
            prefab_id: 'workstation-standard',
            zone_id: zoneId,
            position_x: 0,
            position_y: 0,
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
        const defaults = getDefaultPrefabs(uz.type);
        for (const d of defaults) {
          const instance: PrefabInstanceRow = {
            instance_id: crypto.randomUUID(),
            company_id: companyId,
            prefab_id: d.prefabId,
            zone_id: uz.zoneId,
            position_x: 0,
            position_y: 0,
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

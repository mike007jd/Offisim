import type { EventBus } from '../events/event-bus.js';
import type {
  EmployeeRepository,
  OfficeLayoutRepository,
  SopTemplateRepository,
} from '../runtime/repositories.js';
import type { CompanyTemplate } from '../templates/index.js';
import { getTemplate, listTemplates as listAllTemplates } from '../templates/index.js';

export class CompanyTemplateService {
  constructor(
    private readonly employeeRepo: EmployeeRepository,
    private readonly sopTemplateRepo: SopTemplateRepository,
    private readonly officeLayoutRepo: OfficeLayoutRepository,
    _eventBus: EventBus,
  ) {}

  /** List available built-in templates */
  listTemplates(): CompanyTemplate[] {
    return listAllTemplates();
  }

  /**
   * Materialize a template into a real company with employees, SOPs, and layout.
   * Returns the IDs of all created entities.
   */
  async materializeTemplate(
    templateId: string,
    companyId: string,
  ): Promise<{
    employeeIds: string[];
    sopTemplateIds: string[];
    layoutId: string | null;
  }> {
    const template = getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Create employees
    const employeeIds: string[] = [];
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
    }

    // Create SOP templates
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

    // Create office layout — store preset name for renderer to resolve
    let layoutId: string | null = null;
    layoutId = `layout_${crypto.randomUUID()}`;
    await this.officeLayoutRepo.create({
      layout_id: layoutId,
      company_id: companyId,
      name: `${template.name} Layout`,
      layout_json: JSON.stringify({ preset: template.layoutPreset }),
      is_active: 1,
    });

    return { employeeIds, sopTemplateIds, layoutId };
  }
}

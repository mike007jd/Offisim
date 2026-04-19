import { parseEmployeePersona } from '@offisim/shared-types';
import type { EmployeeRow } from '../runtime/repositories.js';

export function buildEnrichedEmployeeList(employees: EmployeeRow[]): string {
  return employees
    .map((employee) => {
      const persona = parseEmployeePersona(employee.persona_json);
      const expertise =
        persona.expertise && persona.expertise.trim().length > 0
          ? ` | expertise: ${persona.expertise.trim()}`
          : '';
      const externalTag =
        employee.is_external === 1 ? ` [external:${employee.brand_key ?? 'custom'}]` : '';
      return `- ${employee.employee_id}: ${employee.name} (${employee.role_slug})${externalTag}${expertise}`;
    })
    .join('\n');
}

import type { EmployeeConfig, RuntimeSkillConfig } from '@offisim/shared-types';
import { parseEmployeeConfig, parseEmployeePersona } from '@offisim/shared-types';
import type { EmployeeRow } from '../runtime/repositories.js';

type JsonObject = Record<string, unknown>;

export function safeParseJson(raw: string | null): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as JsonObject) : {};
  } catch {
    return {};
  }
}

export function readRuntimeSkill(config: EmployeeConfig): RuntimeSkillConfig | null {
  const runtimeSkill = config.runtimeSkill;
  if (!runtimeSkill || runtimeSkill.enabled === false) return null;
  return runtimeSkill;
}

export function buildEnrichedEmployeeList(employees: EmployeeRow[]): string {
  return employees
    .map((employee) => {
      const persona = parseEmployeePersona(employee.persona_json);
      const config = parseEmployeeConfig(employee.config_json);
      const expertise =
        persona.expertise && persona.expertise.trim().length > 0
          ? ` | expertise: ${persona.expertise.trim()}`
          : '';
      const runtimeSkill = readRuntimeSkill(config);
      const skill =
        runtimeSkill?.skillName && runtimeSkill.skillName.trim().length > 0
          ? ` | skill: ${runtimeSkill.skillName.trim()}${
              runtimeSkill.summary && runtimeSkill.summary.trim().length > 0
                ? ` (${runtimeSkill.summary.trim()})`
                : ''
            }`
          : '';
      return `- ${employee.employee_id}: ${employee.name} (${employee.role_slug})${expertise}${skill}`;
    })
    .join('\n');
}

import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';

interface Persona {
  expertise?: string;
  tone?: string;
  constraints?: string;
}

function parsePersona(json: string | null): Persona {
  if (!json) return {};
  try {
    return JSON.parse(json) as Persona;
  } catch {
    return {};
  }
}

export function buildEmployeePrompt(
  employee: EmployeeRow,
  company: CompanyRow,
  taskInput: string,
): string {
  const persona = parsePersona(employee.persona_json);

  const lines: string[] = [
    `You are ${employee.name}, a ${employee.role_slug} at ${company.name}.`,
  ];

  if (persona.expertise) {
    lines.push(`Your expertise: ${persona.expertise}`);
  }
  if (persona.tone) {
    lines.push(`Communication style: ${persona.tone}`);
  }
  if (persona.constraints) {
    lines.push(`Constraints: ${persona.constraints}`);
  }

  lines.push('');
  lines.push(`Current task:\n${taskInput}`);

  return lines.join('\n');
}

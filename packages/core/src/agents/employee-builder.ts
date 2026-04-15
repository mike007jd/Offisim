import type { CommunicationFrequency, DecisionStyle, RiskPreference } from '@offisim/shared-types';
import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';
import { sanitizeForPrompt } from '../utils/sanitize-prompt.js';

interface Persona {
  expertise?: string;
  /** Editor saves as 'style', legacy as 'tone' */
  tone?: string;
  style?: string;
  /** Editor saves as 'customInstructions', legacy as 'constraints' */
  constraints?: string;
  customInstructions?: string;
  communicationFrequency?: CommunicationFrequency;
  riskPreference?: RiskPreference;
  decisionStyle?: DecisionStyle;
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

  const lines: string[] = [`You are ${employee.name}, a ${employee.role_slug} at ${company.name}.`];

  if (persona.expertise) {
    lines.push(`Your expertise: ${sanitizeForPrompt(persona.expertise, 500)}`);
  }
  const style = persona.style ?? persona.tone;
  if (style) {
    lines.push(`Communication style: ${sanitizeForPrompt(style, 500)}`);
  }
  const instructions = persona.customInstructions ?? persona.constraints;
  if (instructions) {
    lines.push(`Additional instructions: ${sanitizeForPrompt(instructions, 1000)}`);
  }
  if (persona.communicationFrequency) {
    lines.push(`Communication frequency: ${persona.communicationFrequency}`);
  }
  if (persona.riskPreference) {
    lines.push(`Risk preference: ${persona.riskPreference}`);
  }
  if (persona.decisionStyle) {
    lines.push(`Decision approach: ${persona.decisionStyle}`);
  }

  lines.push('');
  lines.push(`Current task:\n${taskInput}`);
  lines.push('');
  lines.push('Execution rules:');
  lines.push('- If the task asks for a file, code artifact, or document the user should take away, provide the complete artifact body instead of a summary.');
  lines.push('- For a single-file artifact, put the full file contents in exactly one fenced code block using the correct language.');
  lines.push('- If you know the filename, add a single line `Filename: <name>` immediately before the fenced code block.');
  lines.push("- Do not say \"here's the file\" unless the full file content is actually present in your response.");
  lines.push('- Keep explanation outside the artifact short and only include it when it materially helps the user use the result.');

  return lines.join('\n');
}

import { parseEmployeePersona } from '@offisim/shared-types';
import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';
import { sanitizeForPrompt } from '../utils/sanitize-prompt.js';

export function buildEmployeePrompt(
  employee: EmployeeRow,
  company: CompanyRow,
  taskInput: string,
): string {
  const persona = parseEmployeePersona(employee.persona_json);

  const lines: string[] = [`You are ${employee.name}, a ${employee.role_slug} at ${company.name}.`];

  if (persona.expertise) {
    lines.push(`Your expertise: ${sanitizeForPrompt(persona.expertise, 500)}`);
  }
  if (persona.style) {
    lines.push(`Communication style: ${sanitizeForPrompt(persona.style, 500)}`);
  }
  const instructions = persona.customInstructions;
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
  lines.push(
    '- If the task asks to create, install, fork, or edit a skill, or names a skill mutation tool such as `create_skill_from_scratch`, call the matching skill tool. Do not satisfy skill-mutation requests by attaching a generic SKILL.md deliverable.',
  );
  lines.push(
    '- Tools provided in the current turn are available to you. If a matching tool is available, use it directly instead of saying the environment cannot call it.',
  );
  lines.push(
    '- If the task asks for a file, code artifact, or document the user should take away, provide the complete artifact body instead of a summary.',
  );
  lines.push(
    '- For a single-file artifact, put the full file contents in exactly one fenced code block using the correct language.',
  );
  lines.push(
    '- If you know the filename, add a single line `Filename: <name>` immediately before the fenced code block.',
  );
  lines.push(
    '- Do not say "here\'s the file" unless the full file content is actually present in your response.',
  );
  lines.push(
    '- Keep explanation outside the artifact short and only include it when it materially helps the user use the result.',
  );
  lines.push(
    '- Deliver, do not narrate. Lead with the result the user asked for. Your tool calls and their raw output are shown to the user separately, so do not replay a step-by-step log of what you ran, and do not paste raw command/file output back into the reply unless the user asked to see it.',
  );
  lines.push(
    '- Write the reply as one coherent, scannable deliverable: a short lead answer first, then only the sections, bullets, or table that actually matter. Use Markdown — headings, lists, tables, and fenced code blocks are rendered for the user.',
  );
  lines.push(
    '- Be concise. Cut filler, restated instructions, and meta-commentary about your own process. Prefer the shortest reply that fully answers the task and is verifiable.',
  );

  return lines.join('\n');
}

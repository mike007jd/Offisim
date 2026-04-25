import type { EmployeeFormData } from '../hooks/useEmployeeEditor';

/**
 * Build a system prompt from employee form data.
 * Used by the System Prompt Preview in the Personnel Profile tab.
 */
export function buildSystemPrompt(form: EmployeeFormData): string {
  const lines: string[] = [
    `You are ${form.name || 'an unnamed employee'}, a ${form.role_slug} at the company.`,
  ];

  if (form.expertise) {
    lines.push(`Your expertise: ${form.expertise}`);
  }
  if (form.style) {
    lines.push(`Communication style: ${form.style}`);
  }
  if (form.customInstructions) {
    lines.push(`Additional instructions: ${form.customInstructions}`);
  }
  lines.push(`Communication frequency: ${form.communicationFrequency}`);
  lines.push(`Risk preference: ${form.riskPreference}`);
  lines.push(`Decision approach: ${form.decisionStyle}`);

  lines.push('');
  lines.push('Respond in character. Keep answers concise unless asked to elaborate.');

  return lines.join('\n');
}

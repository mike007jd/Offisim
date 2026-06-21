import { titleizeSlug } from '@/lib/utils.js';
import type { RuntimeRepositories } from '@offisim/core/browser';

/**
 * Canonical employee system prompt.
 *
 * Both the Personnel "System prompt" preview and the live Pi session render
 * from this single builder, so what the user reads in the inspector is exactly
 * what the employee's Pi sessions receive (forwarded as the session's
 * `appendSystemPrompt`). Persona is a real, generic agent capability — a system
 * prompt addendum — not a Pi-specific control.
 */
export interface EmployeePersonaInput {
  name: string;
  role: string;
  companyName: string;
  expertise: string;
  workingStyle: string;
  communication: string;
  risk: string;
  decisionStyle: string;
  customInstructions: string;
}

export function buildEmployeeSystemPrompt(persona: EmployeePersonaInput): string {
  const company = persona.companyName.trim() || 'the company';
  const lines = [
    `You are ${persona.name || 'this employee'}, a ${persona.role || 'teammate'} at ${company}.`,
    '',
    `Expertise: ${persona.expertise || '—'}`,
    `Working style: ${persona.workingStyle || '—'}`,
    `Communication frequency: ${persona.communication} · Risk preference: ${persona.risk}`,
    `Decision style: ${persona.decisionStyle}`,
  ];
  if (persona.customInstructions.trim()) {
    lines.push('', '## Custom instructions', persona.customInstructions.trim());
  }
  lines.push(
    '',
    'Follow company playbooks. Produce reviewable, minimal diffs. Surface risks before',
    'acting on irreversible changes.',
  );
  return lines.join('\n');
}

function asPersonaText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').join(', ');
  return '';
}

function readProfile(personaJson: string | null | undefined): Record<string, unknown> {
  if (!personaJson) return {};
  try {
    const parsed = JSON.parse(personaJson) as Record<string, unknown>;
    const profile = parsed?.profile;
    return profile && typeof profile === 'object' && !Array.isArray(profile)
      ? (profile as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the persisted persona for an employee into the system-prompt text Pi
 * receives. Reads the saved employee row (persona_json) plus the company name.
 * Returns `null` only when the employee row is missing, so even a freshly hired
 * default employee gets a real identity prompt.
 */
export async function resolveEmployeeSystemPrompt(
  repos: RuntimeRepositories,
  companyId: string,
  employeeId: string,
): Promise<string | null> {
  const employee = await repos.employees.findById(employeeId);
  if (!employee) return null;
  const profile = readProfile(employee.persona_json);
  let companyName = '';
  try {
    const company = await repos.companies.findById(companyId);
    companyName = company?.name ?? '';
  } catch {
    companyName = '';
  }
  return buildEmployeeSystemPrompt({
    name: employee.name ?? '',
    role: titleizeSlug(employee.role_slug),
    companyName,
    expertise: asPersonaText(profile.expertise),
    workingStyle: asPersonaText(profile.workingStyle),
    communication: asPersonaText(profile.communication) || 'medium',
    risk: asPersonaText(profile.risk) || 'balanced',
    decisionStyle: asPersonaText(profile.decisionStyle) || 'collaborative',
    customInstructions: asPersonaText(profile.customInstructions),
  });
}

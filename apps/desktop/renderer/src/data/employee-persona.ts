import { titleizeSlug } from '@/lib/utils.js';
import type { EmployeeRow, RuntimeRepositories } from '@offisim/core/browser';

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

/** Build the system-prompt text for an already-loaded employee row + company name. */
function personaFromRow(employee: EmployeeRow, companyName: string): string {
  const profile = readProfile(employee.persona_json);
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

/** A teammate the root agent may delegate to. Opaque on the wire; the Node host's
 *  supervisor builds an in-process child session from it. Excludes the acting
 *  employee and external (A2A) employees — those aren't in-process Pi children. */
interface DelegationRosterEntry {
  employeeId: string;
  name: string;
  roleSlug: string;
  persona: string;
}

/** Everything a turn needs to brief the root agent and its potential teammates:
 *  the acting employee's own persona (Pi's `appendSystemPrompt`) plus the
 *  delegation roster. */
export interface DelegationContext {
  /** The acting employee's system prompt, or null (→ Pi base prompt) if absent. */
  systemPromptAppend: string | null;
  roster: DelegationRosterEntry[];
}

/**
 * Build a turn's full delegation context in ONE pass: a single `findByCompany`
 * (all employee rows) + a single company read derives both the acting employee's
 * persona and the roster of delegable teammates — no per-employee re-read, and no
 * second fetch of the company row. The acting employee's persona resolves even if
 * disabled/external (matches the previous by-id lookup); the roster excludes the
 * acting employee and external (A2A) employees.
 */
export async function buildDelegationContext(
  repos: RuntimeRepositories,
  companyId: string,
  actingEmployeeId: string | null,
): Promise<DelegationContext> {
  const [employees, company] = await Promise.all([
    repos.employees.findByCompany(companyId),
    repos.companies.findById(companyId).catch(() => null),
  ]);
  const companyName = company?.name ?? '';
  const acting = actingEmployeeId
    ? (employees.find((e) => e.employee_id === actingEmployeeId) ?? null)
    : null;
  const roster = employees
    .filter((e) => e.enabled === 1 && e.is_external !== 1 && e.employee_id !== actingEmployeeId)
    .map((e) => ({
      employeeId: e.employee_id,
      name: e.name ?? e.employee_id,
      roleSlug: e.role_slug,
      persona: personaFromRow(e, companyName),
    }));
  return {
    systemPromptAppend: acting ? personaFromRow(acting, companyName) : null,
    roster,
  };
}

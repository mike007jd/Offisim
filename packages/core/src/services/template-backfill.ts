import type { RoleSlug, Zone } from '@offisim/shared-types';
import { resolveHomeZone } from '@offisim/shared-types';
import type { RuntimeRepositories } from '../runtime/repositories.js';
import { buildZoneHomeWorkstation } from './home-workstation.js';
import { hydrateZone } from './zone-service.js';

/**
 * One-time, idempotent repair for company rows created before the template
 * truth repair (source plan §4.4): existing template companies whose employees
 * have no home workstation and/or a pre-v2 (flat) persona.
 *
 *  - Home workstation: when `workstation_id` is null, resolve the role's home
 *    zone against the company's real zones, upsert a zone-level workstation
 *    (workstation id == zone id, matching the office scene's seat resolution),
 *    and point the employee at it.
 *  - Persona: when `persona_json` has no `.profile`, wrap the legacy flat
 *    `{ expertise, style, ... }` into the v2 `{ schemaVersion, profile, appearance }`
 *    shape the live persona reader expects, so the template's expertise/style
 *    actually reaches the Pi system prompt.
 *
 * Idempotent: only employees missing a workstation or a `.profile` are touched.
 * Scoped to template companies (`company.template_id` set), the only rows with a
 * known role→home-zone mapping.
 */
export interface TemplateBackfillResult {
  companyId: string;
  assignedWorkstations: number;
  upgradedPersonas: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pickCommunication(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function pickRisk(value: unknown): 'conservative' | 'balanced' | 'aggressive' {
  return value === 'conservative' || value === 'aggressive' ? value : 'balanced';
}

/** Any pre-v2 persona field worth migrating into `profile`. A persona with none
 *  of these (e.g. appearance-only) has nothing to upgrade. */
const LEGACY_PERSONA_KEYS = [
  'expertise',
  'style',
  'workingStyle',
  'communicationFrequency',
  'communication',
  'riskPreference',
  'risk',
  'decisionStyle',
  'customInstructions',
] as const;

function hasLegacyPersonaFields(persona: Record<string, unknown>): boolean {
  return LEGACY_PERSONA_KEYS.some((key) => key in persona);
}

/** Build the v2 persona payload from a legacy flat persona, preserving appearance
 *  and any unknown keys while moving expertise/style into `profile`. */
function upgradePersona(flat: Record<string, unknown>): Record<string, unknown> {
  const upgraded: Record<string, unknown> = { ...flat };
  upgraded.schemaVersion = 2;
  upgraded.profile = {
    expertise: asString(flat.expertise),
    workingStyle: asString(flat.style) || asString(flat.workingStyle),
    communication: pickCommunication(flat.communicationFrequency ?? flat.communication),
    risk: pickRisk(flat.riskPreference ?? flat.risk),
    decisionStyle: asString(flat.decisionStyle) || 'collaborative',
    customInstructions: asString(flat.customInstructions),
  };
  // The flat top-level fields now live under `profile`.
  for (const key of ['expertise', 'style', 'communicationFrequency', 'riskPreference']) {
    delete upgraded[key];
  }
  return upgraded;
}

export async function backfillTemplateCompany(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<TemplateBackfillResult> {
  const result: TemplateBackfillResult = { companyId, assignedWorkstations: 0, upgradedPersonas: 0 };

  const company = await repos.companies.findById(companyId);
  if (!company || !company.template_id) return result;

  const [employees, zoneRows] = await Promise.all([
    repos.employees.findByCompany(companyId),
    repos.zones.findByCompany(companyId),
  ]);
  if (employees.length === 0) return result;

  const zones: Zone[] = zoneRows.map(hydrateZone);

  // Pre-resolve each employee's home zone so workstation seat capacity reflects
  // the real headcount per zone. Uses the same resolver as materialization so
  // backfilled placement matches a freshly-created company.
  const homeZoneByEmployee = new Map<string, Zone>();
  const seatZones = new Map<string, Zone>();
  const seatCounts = new Map<string, number>();
  for (const emp of employees) {
    if (emp.workstation_id) continue;
    const zone = resolveHomeZone({ role: emp.role_slug as RoleSlug }, zones);
    if (!zone) continue;
    homeZoneByEmployee.set(emp.employee_id, zone);
    seatZones.set(zone.zoneId, zone);
    seatCounts.set(zone.zoneId, (seatCounts.get(zone.zoneId) ?? 0) + 1);
  }

  const now = new Date().toISOString();
  for (const [zoneId, zone] of seatZones) {
    await repos.workstations.upsert(
      buildZoneHomeWorkstation(zone, companyId, seatCounts.get(zoneId) ?? 1, now),
    );
  }

  for (const emp of employees) {
    const patch: { workstation_id?: string; persona_json?: string } = {};

    const zone = homeZoneByEmployee.get(emp.employee_id);
    if (zone) {
      patch.workstation_id = zone.zoneId;
      result.assignedWorkstations += 1;
    }

    const persona = safeParse(emp.persona_json);
    if (persona && !isRecord(persona.profile) && hasLegacyPersonaFields(persona)) {
      patch.persona_json = JSON.stringify(upgradePersona(persona));
      result.upgradedPersonas += 1;
    }

    if (patch.workstation_id !== undefined || patch.persona_json !== undefined) {
      await repos.employees.update(emp.employee_id, patch);
    }
  }

  return result;
}

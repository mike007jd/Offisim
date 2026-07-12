import type {
  CommunicationFrequency,
  EmployeeAppearance,
  RiskPreference,
  RoleSlug,
  SystemZoneTemplate,
  ZonePresetPrefab,
} from '@offisim/shared-types';

import { agencyLiteTemplate } from './agency-lite.js';
import { aiStartupTemplate } from './ai-startup.js';
import { contentStudioTemplate } from './content-studio.js';
import { productTeamTemplate } from './product-team.js';
import { rdCompanyTemplate } from './rd-company.js';
import { vibeCodingStudioTemplate } from './vibe-coding-studio.js';

export { agencyLiteTemplate } from './agency-lite.js';
export { aiStartupTemplate } from './ai-startup.js';
export { contentStudioTemplate } from './content-studio.js';
export { productTeamTemplate } from './product-team.js';
export { rdCompanyTemplate } from './rd-company.js';
export { vibeCodingStudioTemplate } from './vibe-coding-studio.js';

export type TemplateModelTier = 'best' | 'economical' | 'balanced';

/**
 * Canonical persona profile authored by a built-in template.
 *
 * This is the SAME nested `profile` shape the live persona reader consumes:
 * the desktop renderer's `buildEmployeeSystemPrompt` reads
 * `persona_json.profile.{expertise,workingStyle,communication,risk,decisionStyle,customInstructions}`
 * for the Pi `appendSystemPrompt`, and the Personnel editor round-trips the same
 * keys. `expertise` is a plain string so it survives both readers verbatim.
 */
export interface TemplatePersonaProfile {
  readonly expertise: string;
  readonly workingStyle: string;
  readonly communication: CommunicationFrequency;
  readonly risk: RiskPreference;
  readonly decisionStyle: string;
  readonly customInstructions: string;
}

/** Persona payload: profile (Pi prompt) + appearance (puppet). */
export interface TemplateEmployeePersona {
  readonly profile: TemplatePersonaProfile;
  readonly appearance: EmployeeAppearance;
}

/**
 * One employee in a canonical template.
 *
 * Separation of concerns (source plan §4.2):
 *  - `roleSlug`      — broad operational family (delegation/zone resolution)
 *  - `displayTitle`  — human-readable specialized title (e.g. "ML Engineer")
 *  - `capabilities`  — structured delegation/match tags (NOT a Pi prompt input)
 *  - `persona.profile` — the only thing that reaches the Pi system prompt
 *  - `homeZoneSlug`  — optional override; absent → role→zone resolution decides
 */
export interface TemplateEmployeeDefinition {
  readonly key: string;
  readonly name: string;
  readonly roleSlug: RoleSlug;
  readonly displayTitle: string;
  readonly capabilities: readonly string[];
  readonly persona: TemplateEmployeePersona;
  /** Model capability intent for wizard guidance; never a model id or default. */
  readonly modelTier?: TemplateModelTier;
  /** Plain-language guidance shown beside the optional model assignment. */
  readonly tierHint?: string;
  readonly homeZoneSlug?: string;
}

/** Wizard presentation metadata (renderer-agnostic; `icon` is a lucide name). */
export interface TemplatePresentation {
  readonly icon: string;
  readonly accent: string;
  readonly tagline: string;
  readonly bestFor: readonly string[];
  readonly capabilities: readonly string[];
}

export interface TemplateZoneBlueprint extends SystemZoneTemplate {
  defaultPrefabs?: readonly ZonePresetPrefab[];
}

/**
 * Canonical company template — the single source of truth consumed by both the
 * renderer wizard (display) and `CompanyTemplateService` (materialization). No
 * separate renderer roster / preview-zone / employee-bio source exists anymore.
 */
export interface CompanyTemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly presentation: TemplatePresentation;
  readonly employees: readonly TemplateEmployeeDefinition[];
  /** Custom zones; when absent the company falls back to SYSTEM_ZONE_TEMPLATES. */
  readonly zones?: readonly TemplateZoneBlueprint[];
  readonly layoutPreset: string;
}

const TEMPLATES: readonly CompanyTemplateDefinition[] = [
  rdCompanyTemplate,
  contentStudioTemplate,
  productTeamTemplate,
  agencyLiteTemplate,
  aiStartupTemplate,
  vibeCodingStudioTemplate,
];

export function listTemplates(): readonly CompanyTemplateDefinition[] {
  return TEMPLATES;
}

export function getTemplate(id: string): CompanyTemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Serialize a template employee's persona into the persisted `persona_json`.
 *
 * Top-level `displayTitle`/`capabilities` sit alongside `profile`/`appearance`;
 * the Personnel editor's Save only overwrites `profile`/`appearance`, so these
 * survive edits. The Pi reader reads `profile.*`; `employeeToVm` reads top-level
 * `appearance`.
 */
export function serializeTemplatePersona(employee: TemplateEmployeeDefinition): string {
  return JSON.stringify({
    displayTitle: employee.displayTitle,
    capabilities: employee.capabilities,
    profile: employee.persona.profile,
    appearance: employee.persona.appearance,
  });
}

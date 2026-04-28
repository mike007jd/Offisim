import type { SkillRow } from '@offisim/shared-types';
import type {
  EmployeeRepository,
  EmployeeRow,
  RuntimeRepositories,
  SettingsRepository,
  SkillRepository,
} from '../runtime/repositories.js';
import type { CompanyRepository } from '../runtime/repositories.js';
import { Logger } from '../services/logger.js';
import type { VaultFileSystem } from '../vault/fs.js';
import { employeeSlug } from '../vault/slug.js';
import type { SkillLoader } from './skill-loader.js';
import { serializeSkillMd } from './skill-md.js';
import { resolveSkillPath } from './skill-path.js';
import { skillSlug } from './skill-slug.js';

const MIGRATION_MARKER = 'skills_migration_v1_done';

const logger = new Logger('skills-bootstrap');

export interface MigrateRuntimeSkillsDeps {
  skills: SkillRepository;
  settings: SettingsRepository;
  employees: EmployeeRepository;
  companies: CompanyRepository;
  fs: VaultFileSystem;
  /** Epoch-ms provider; injectable for tests. */
  now?: () => number;
  /** Random id provider; injectable for tests. */
  newId?: () => string;
}

interface LegacyRuntimeSkill {
  skillName?: string;
  summary?: string;
  enabled?: boolean;
  instructions?: string;
  instructionMode?: string;
  instructionExcerpt?: string;
  capabilityIndex?: {
    summary?: string;
    requiredCapabilities?: string[];
    capabilities?: Array<{ label?: string; key?: string; kind?: string }>;
  };
  allowedTools?: string[];
}

interface LegacyConfig {
  runtimeSkill?: LegacyRuntimeSkill;
  [key: string]: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseLegacyConfig(configJson: string | null): LegacyConfig | null {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as LegacyConfig;
    }
    return null;
  } catch {
    return null;
  }
}

function buildBody(runtimeSkill: LegacyRuntimeSkill): string {
  const parts: string[] = [];
  if (runtimeSkill.instructions) parts.push(runtimeSkill.instructions);
  const capSummary = runtimeSkill.capabilityIndex?.summary;
  const caps = runtimeSkill.capabilityIndex?.capabilities ?? [];
  if (capSummary || caps.length > 0) {
    const lines: string[] = ['', '## Capabilities', ''];
    if (capSummary) lines.push(capSummary, '');
    for (const cap of caps) {
      const label = cap.label ?? cap.key ?? cap.kind;
      if (label) lines.push(`- ${label}`);
    }
    parts.push(lines.join('\n'));
  }
  return `${parts.join('\n').trim()}\n`;
}

async function migrateEmployee(
  employee: EmployeeRow,
  legacy: LegacyRuntimeSkill,
  skills: SkillRepository,
  employees: EmployeeRepository,
  fs: VaultFileSystem,
  now: () => number,
  newId: () => string,
): Promise<void> {
  const rawName = asString(legacy.skillName);
  const summary = asString(legacy.summary);
  if (!rawName || !summary) {
    logger.warn('Skipping employee with malformed runtimeSkill (missing skillName/summary)', {
      employeeId: employee.employee_id,
    });
    return;
  }
  const skillId = newId();
  const slug = skillSlug(rawName, skillId);
  const empSlug = employeeSlug(employee.name, employee.employee_id);
  const paths = resolveSkillPath({
    companyId: employee.company_id,
    scope: 'employee',
    employeeSlug: empSlug,
    skillSlug: slug,
  });
  const body = buildBody(legacy);
  const allowedTools = Array.isArray(legacy.allowedTools)
    ? legacy.allowedTools.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : undefined;
  const skillMd = serializeSkillMd({
    name: slug,
    description: summary,
    ...(allowedTools !== undefined ? { allowedTools } : {}),
    body,
  });

  await fs.writeFile(paths.skillMdPath, skillMd);

  const ts = String(now());
  const row: SkillRow = {
    skill_id: skillId,
    company_id: employee.company_id,
    employee_id: employee.employee_id,
    scope: 'employee',
    slug,
    name: slug,
    description: summary,
    version: '0.1.0',
    source_kind: 'synthesized',
    source_ref: 'legacy:runtimeSkill',
    vault_path: paths.skillMdPath,
    created_at: ts,
    updated_at: ts,
  };
  await skills.insert(row);

  const parsed = parseLegacyConfig(employee.config_json) ?? {};
  parsed.runtimeSkill = undefined;
  const nextConfigJson = Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : null;
  await employees.update(employee.employee_id, { config_json: nextConfigJson });
}

/**
 * One-shot migration: move each employee's legacy `config_json.runtimeSkill`
 * blob into an employee-scope SKILL.md + `skills` row, then strip the legacy
 * field. Guarded by a `settings.skills_migration_v1_done` marker so subsequent
 * runs are a cheap no-op.
 *
 * Failures on a single employee are logged and skipped (best-effort); the
 * marker is written after a full pass so retries don't re-run on good data.
 */
export async function migrateRuntimeSkills(deps: MigrateRuntimeSkillsDeps): Promise<void> {
  const marker = await deps.settings.get(MIGRATION_MARKER);
  if (marker === 'true') return;

  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => `sk_${now()}_${Math.random().toString(36).slice(2, 10)}`);

  const companies = await deps.companies.findAll();
  for (const company of companies) {
    const employees = await deps.employees.findByCompany(company.company_id);
    for (const employee of employees) {
      const legacy = parseLegacyConfig(employee.config_json)?.runtimeSkill;
      if (!legacy) continue;
      try {
        await migrateEmployee(employee, legacy, deps.skills, deps.employees, deps.fs, now, newId);
      } catch (err) {
        logger.warn('runtimeSkill migration failed for employee', {
          employeeId: employee.employee_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await deps.settings.set(MIGRATION_MARKER, 'true');
}

/**
 * Shared vault-activation handler: swap the loader's fs to the live one and
 * fire the one-shot `runtimeSkill` migration. Used by browser / tauri
 * runtimes so the setFs + migrate choreography is not duplicated three ways.
 */
export async function onVaultReadyForSkills(
  loader: SkillLoader | null,
  repos: RuntimeRepositories,
  fs: VaultFileSystem,
): Promise<void> {
  if (!loader) return;
  loader.setFs(fs);
  if (!repos.skills || !repos.settings) return;
  try {
    await migrateRuntimeSkills({
      skills: repos.skills,
      settings: repos.settings,
      employees: repos.employees,
      companies: repos.companies,
      fs,
    });
  } catch (err) {
    logger.warn('runtimeSkill migration failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

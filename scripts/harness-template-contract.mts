/**
 * Template contract gate (source plan §15 "Template fixtures").
 *
 * Locks the Phase 0 "template truth repair" invariants by materializing every
 * built-in template into an in-memory backend and asserting the persisted rows
 * match the single canonical definition:
 *
 *  - unique id/name; non-empty capabilities; valid v2 persona profile;
 *  - persona_json carries the v2 `.profile` the live Pi reader consumes, plus
 *    top-level appearance / displayTitle / capabilities;
 *  - NO legacy modelPreference / temperature / maxTokens;
 *  - materialized employees match the canonical roster (count, role, persona,
 *    appearance, displayTitle, capabilities);
 *  - every employee resolves to exactly one workspace-archetype zone via a
 *    home workstation (workstation id == zone id);
 *  - materialized zone labels == the canonical (preview) zone labels;
 *  - the backfill re-homes + upgrades a synthetic legacy company and is idempotent.
 *
 * Pure Node via tsx against core source — no DOM, no three.js, no app.
 */
import {
  CompanyTemplateService,
  InMemoryEventBus,
  TEMPLATE_EMPLOYEE_CONFIG_JSON,
  backfillTemplateCompany,
  createMemoryRepositories,
  getTemplate,
  listTemplates,
  serializeTemplatePersona,
} from '../packages/core/src/browser.js';
import { SYSTEM_ZONE_TEMPLATES } from '../packages/shared-types/src/index.js';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const COMMUNICATION = new Set(['low', 'medium', 'high']);
const RISK = new Set(['conservative', 'balanced', 'aggressive']);
const LEGACY_CONFIG_KEYS = ['modelPreference', 'temperature', 'maxTokens'];

function expectedZoneLabels(templateId: string): string[] {
  const t = getTemplate(templateId);
  const zones = t?.zones ?? SYSTEM_ZONE_TEMPLATES;
  return [...zones].sort((a, b) => a.sortOrder - b.sortOrder).map((z) => z.label);
}

console.log('template-contract gate');

// ── Static definition invariants ────────────────────────────────────────────
const templates = listTemplates();
const ids = new Set<string>();
const names = new Set<string>();

check('exactly 5 built-in templates', templates.length === 5, `got ${templates.length}`);

for (const t of templates) {
  console.log(`\n[${t.id}] static`);
  check(`${t.id}: unique id`, !ids.has(t.id), 'duplicate id');
  ids.add(t.id);
  check(`${t.id}: unique name`, !names.has(t.name), 'duplicate name');
  names.add(t.name);
  check(`${t.id}: presentation.icon is a non-empty string`, typeof t.presentation.icon === 'string' && t.presentation.icon.length > 0);
  check(`${t.id}: has employees`, t.employees.length > 0);

  for (const e of t.employees) {
    const tag = `${t.id}/${e.key}`;
    check(`${tag}: non-empty capabilities`, Array.isArray(e.capabilities) && e.capabilities.length > 0);
    check(`${tag}: displayTitle present`, typeof e.displayTitle === 'string' && e.displayTitle.length > 0);
    check(`${tag}: persona schemaVersion 2`, e.persona.schemaVersion === 2);
    check(`${tag}: profile.expertise non-empty`, typeof e.persona.profile.expertise === 'string' && e.persona.profile.expertise.length > 0);
    check(`${tag}: profile.workingStyle non-empty`, typeof e.persona.profile.workingStyle === 'string' && e.persona.profile.workingStyle.length > 0);
    check(`${tag}: communication valid`, COMMUNICATION.has(e.persona.profile.communication));
    check(`${tag}: risk valid`, RISK.has(e.persona.profile.risk));
    check(`${tag}: decisionStyle present`, typeof e.persona.profile.decisionStyle === 'string' && e.persona.profile.decisionStyle.length > 0);
    check(`${tag}: appearance.skinColor is a number`, typeof e.persona.appearance.skinColor === 'number');

    // Serialized persona = what gets persisted + read by Pi / Personnel / avatar.
    const serialized = parseJson(serializeTemplatePersona(e));
    const profile = (serialized.profile ?? {}) as Record<string, unknown>;
    const appearance = (serialized.appearance ?? {}) as Record<string, unknown>;
    check(`${tag}: serialized .profile.expertise reaches Pi reader`, profile.expertise === e.persona.profile.expertise);
    check(`${tag}: serialized top-level appearance for avatar`, appearance.skinColor === e.persona.appearance.skinColor);
    check(`${tag}: serialized displayTitle preserved`, serialized.displayTitle === e.displayTitle);
    check(
      `${tag}: serialized capabilities preserved`,
      JSON.stringify(serialized.capabilities) === JSON.stringify(e.capabilities),
    );
    check(
      `${tag}: no legacy runtime config keys in persona`,
      LEGACY_CONFIG_KEYS.every((k) => !(k in serialized)),
    );
  }
}

check('template config is empty (no legacy runtime config)', TEMPLATE_EMPLOYEE_CONFIG_JSON === '{}');

// ── Materialization invariants ──────────────────────────────────────────────
for (const t of templates) {
  console.log(`\n[${t.id}] materialize`);
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const companyId = `co-${t.id}`;
  const nowIso = new Date().toISOString();
  await repos.companies.create({
    company_id: companyId,
    name: t.name,
    status: 'active',
    template_id: t.id,
    template_label: t.name,
    workspace_root: null,
    description_json: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  const service = new CompanyTemplateService(
    repos.employees,
    repos.officeLayouts,
    eventBus,
    repos.prefabInstances,
    undefined,
    repos.zones,
    repos.workstations,
  );
  await service.materializeTemplate(t.id, companyId);

  const employees = await repos.employees.findByCompany(companyId);
  const zones = await repos.zones.findByCompany(companyId);
  const workstations = await repos.workstations.findByCompany(companyId);
  const zoneById = new Map(zones.map((z) => [z.zone_id, z]));
  const workstationIds = new Set(workstations.map((w) => w.workstation_id));

  check(`${t.id}: materialized employee count`, employees.length === t.employees.length, `${employees.length} vs ${t.employees.length}`);

  const expectedLabels = expectedZoneLabels(t.id).slice().sort();
  const actualLabels = zones.map((z) => z.label).sort();
  check(
    `${t.id}: materialized zone labels == canonical (preview) zone labels`,
    JSON.stringify(actualLabels) === JSON.stringify(expectedLabels),
    `${JSON.stringify(actualLabels)} vs ${JSON.stringify(expectedLabels)}`,
  );

  for (const def of t.employees) {
    const row = employees.find((e) => e.name === def.name);
    const tag = `${t.id}/${def.key}`;
    if (!row) {
      check(`${tag}: materialized row exists`, false, `no employee named ${def.name}`);
      continue;
    }
    check(`${tag}: role_slug matches`, row.role_slug === def.roleSlug, `${row.role_slug} vs ${def.roleSlug}`);
    check(`${tag}: config has no legacy fields`, row.config_json === TEMPLATE_EMPLOYEE_CONFIG_JSON, row.config_json ?? 'null');

    const persona = parseJson(row.persona_json);
    const profile = (persona.profile ?? {}) as Record<string, unknown>;
    const appearance = (persona.appearance ?? {}) as Record<string, unknown>;
    check(`${tag}: persisted .profile.expertise matches canonical`, profile.expertise === def.persona.profile.expertise);
    check(`${tag}: persisted appearance matches canonical`, appearance.skinColor === def.persona.appearance.skinColor);
    check(`${tag}: persisted displayTitle matches`, persona.displayTitle === def.displayTitle);

    // Resolves to exactly one valid workspace via a home workstation.
    const wsId = row.workstation_id;
    check(`${tag}: has a home workstation`, typeof wsId === 'string' && wsId.length > 0);
    if (typeof wsId === 'string') {
      check(`${tag}: workstation row exists`, workstationIds.has(wsId));
      const zone = zoneById.get(wsId);
      check(`${tag}: home zone is a workspace`, zone?.archetype === 'workspace', zone?.archetype ?? 'no-zone');
    }
  }
}

// ── Backfill invariants (legacy company → safe, idempotent repair) ───────────
{
  console.log('\n[backfill] legacy company repair');
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const companyId = 'co-legacy';
  const nowIso = new Date().toISOString();
  await repos.companies.create({
    company_id: companyId,
    name: 'Legacy Co',
    status: 'active',
    template_id: 'rd-company',
    template_label: 'R&D Company',
    workspace_root: null,
    description_json: null,
    created_at: nowIso,
    updated_at: nowIso,
  });
  const service = new CompanyTemplateService(
    repos.employees,
    repos.officeLayouts,
    eventBus,
    repos.prefabInstances,
    undefined,
    repos.zones,
    repos.workstations,
  );
  await service.materializeTemplate('rd-company', companyId);

  // Downgrade two employees to the pre-v2 (flat persona, no workstation) shape.
  const before = await repos.employees.findByCompany(companyId);
  const victims = before.slice(0, 2);
  for (const v of victims) {
    await repos.employees.update(v.employee_id, {
      workstation_id: null,
      persona_json: JSON.stringify({
        expertise: 'Legacy expertise text',
        style: 'Legacy working style',
        appearance: { skinColor: 0x111111 },
      }),
    });
  }

  const result = await backfillTemplateCompany(repos, companyId);
  check('backfill: assigned 2 workstations', result.assignedWorkstations === 2, String(result.assignedWorkstations));
  check('backfill: upgraded 2 personas', result.upgradedPersonas === 2, String(result.upgradedPersonas));

  const after = await repos.employees.findByCompany(companyId);
  for (const v of victims) {
    const row = after.find((e) => e.employee_id === v.employee_id);
    check(`backfill: ${v.name} re-homed`, typeof row?.workstation_id === 'string' && row.workstation_id.length > 0);
    const persona = parseJson(row?.persona_json ?? null);
    const profile = (persona.profile ?? {}) as Record<string, unknown>;
    check(`backfill: ${v.name} persona upgraded to v2`, profile.expertise === 'Legacy expertise text');
    check(`backfill: ${v.name} legacy flat keys removed`, !('expertise' in persona) && !('style' in persona));
  }

  const second = await backfillTemplateCompany(repos, companyId);
  check('backfill: idempotent (no re-assign)', second.assignedWorkstations === 0, String(second.assignedWorkstations));
  check('backfill: idempotent (no re-upgrade)', second.upgradedPersonas === 0, String(second.upgradedPersonas));
}

console.log(`\ntemplate-contract: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`template-contract gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('template-contract gate PASSED');

import type { EmployeeRow, MemoryEntryRow } from '../runtime/repositories.js';
import { serializeDocument } from './codec.js';
import {
  type EmployeeFrontmatter,
  type MemoryCategory,
  type MemoryFrontmatter,
  type RelationshipsFrontmatter,
  type SoulFrontmatter,
  VAULT_SCHEMA_VERSION,
} from './frontmatter.js';

const MEMORY_CATEGORY_ORDER: readonly MemoryCategory[] = [
  'experience',
  'decision',
  'knowledge',
  'preference',
];

interface ParsedPersona {
  decisionStyle?: SoulFrontmatter['persona']['decisionStyle'];
  riskPreference?: SoulFrontmatter['persona']['riskPreference'];
  communicationFrequency?: SoulFrontmatter['persona']['communicationFrequency'];
  expertise?: string;
  tone?: string;
  freeform?: string;
  [key: string]: unknown;
}

function parsePersona(json: string | null): ParsedPersona {
  if (!json) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ParsedPersona;
    }
  } catch {
    // fall through
  }
  return {};
}

export function renderEmployeeMd(row: EmployeeRow): string {
  const frontmatter: EmployeeFrontmatter = {
    schema: VAULT_SCHEMA_VERSION,
    employee_id: row.employee_id,
    company_id: row.company_id,
    name: row.name,
    role_slug: row.role_slug,
    workstation_id: row.workstation_id ?? null,
    dismissed: row.enabled === 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  const body = [
    `# ${row.name}`,
    '',
    `- Role: \`${row.role_slug}\``,
    `- Workstation: ${row.workstation_id ? `\`${row.workstation_id}\`` : '_unassigned_'}`,
    `- Status: ${row.enabled === 1 ? 'active' : 'dismissed'}`,
  ].join('\n');
  return serializeDocument(frontmatter, body);
}

export function renderSoulMd(row: EmployeeRow): string {
  const persona = parsePersona(row.persona_json);
  const { freeform, ...structured } = persona;
  const frontmatter: SoulFrontmatter = {
    schema: VAULT_SCHEMA_VERSION,
    employee_id: row.employee_id,
    persona: structured,
    updated_at: row.updated_at,
  };
  const bodyText =
    typeof freeform === 'string' && freeform.trim().length > 0
      ? freeform.trim()
      : '_No soul narrative recorded yet. Edit this section to shape the employee._';
  const body = ['# Soul', '', bodyText].join('\n');
  return serializeDocument(frontmatter, body);
}

function formatMemoryLine(entry: MemoryEntryRow): string {
  const importance = entry.importance.toFixed(2);
  const date = entry.last_reinforced_at.slice(0, 10);
  const content = entry.content.replace(/\n+/gu, ' ').trim();
  return `- \`${entry.memory_id}\` · ★${importance} · ${entry.access_count}× · ${date} — ${content}`;
}

// This is a recency-ordered view: entries are displayed newest-first
// (`last_reinforced_at` desc, with importance as a tie-break). Callers must
// fetch the top-N by `last_reinforced_at` so the rows they truncate to are the
// same ones a recency view would surface; truncating by any other criterion
// silently drops recent memories the body claims to show.
//
// Pass `totalCount` (the true memory total, ignoring the display limit) so the
// frontmatter `count` reflects how many memories exist rather than how many
// were rendered; the body then notes the truncation explicitly.
export function renderMemoryMd(
  row: Pick<EmployeeRow, 'employee_id' | 'company_id' | 'updated_at'>,
  memories: readonly MemoryEntryRow[],
  totalCount?: number,
): string {
  const sorted = [...memories].sort((a, b) => {
    if (a.last_reinforced_at === b.last_reinforced_at) {
      return b.importance - a.importance;
    }
    return b.last_reinforced_at.localeCompare(a.last_reinforced_at);
  });
  const shown = sorted.length;
  const total = typeof totalCount === 'number' && totalCount > shown ? totalCount : shown;
  const frontmatter: MemoryFrontmatter = {
    schema: VAULT_SCHEMA_VERSION,
    employee_id: row.employee_id,
    company_id: row.company_id,
    count: total,
    updated_at: row.updated_at,
  };
  const sections: string[] = ['# Memories', ''];
  if (total > shown) {
    sections.push(`_Showing ${shown} of ${total} memories (most recent first)._`);
    sections.push('');
  }
  for (const category of MEMORY_CATEGORY_ORDER) {
    const entries = sorted.filter((entry) => entry.category === category);
    sections.push(`## ${category}`);
    sections.push('');
    if (entries.length === 0) {
      sections.push('_No entries yet._');
    } else {
      for (const entry of entries) {
        sections.push(formatMemoryLine(entry));
      }
    }
    sections.push('');
  }
  return serializeDocument(frontmatter, sections.join('\n').trimEnd());
}

// Intentionally-deferred stub: relationship rows are not yet modeled, so this
// always renders an empty `relationships` frontmatter array and a placeholder
// body. `relationship.*` events still schedule a write of this constant
// content (see VaultSyncService); that no-op write is accepted for now. When
// relationship data lands, give this the same shape as `renderMemoryMd` —
// accept the real rows and populate the frontmatter — instead of ignoring them.
export function renderRelationshipsMd(
  row: Pick<EmployeeRow, 'employee_id' | 'company_id' | 'updated_at'>,
): string {
  const frontmatter: RelationshipsFrontmatter = {
    schema: VAULT_SCHEMA_VERSION,
    employee_id: row.employee_id,
    company_id: row.company_id,
    relationships: [],
    updated_at: row.updated_at,
  };
  const body = ['# Relationships', '', '_No relationship entries recorded yet._'].join('\n');
  return serializeDocument(frontmatter, body);
}

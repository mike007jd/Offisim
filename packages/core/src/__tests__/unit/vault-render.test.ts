import { describe, expect, it } from 'vitest';
import type { MemoryEntryRow } from '../../runtime/repositories.js';
import { parseDocument } from '../../vault/codec.js';
import {
  employeeFrontmatterSchema,
  memoryFrontmatterSchema,
  relationshipsFrontmatterSchema,
  soulFrontmatterSchema,
} from '../../vault/frontmatter.js';
import {
  renderEmployeeMd,
  renderMemoryMd,
  renderRelationshipsMd,
  renderSoulMd,
} from '../../vault/render.js';
import { makeEmployee } from '../helpers/fixtures.js';

function makeMemory(overrides?: Partial<MemoryEntryRow>): MemoryEntryRow {
  return {
    memory_id: 'mem-1',
    company_id: 'c-test',
    scope: 'employee',
    owner_id: 'e-dev-1',
    category: 'experience',
    content: 'Boss prefers concise replies.',
    importance: 0.8,
    confidence: 0.9,
    dedupe_key: 'boss-prefers-concise',
    reinforcement_count: 1,
    last_reinforced_at: '2026-04-13T10:00:00.000Z',
    metadata_json: null,
    source_thread_id: 't-1',
    source_task_run_id: null,
    created_at: '2026-04-13T10:00:00.000Z',
    accessed_at: '2026-04-13T10:00:00.000Z',
    access_count: 2,
    ...overrides,
  };
}

describe('vault/render', () => {
  it('employee.md frontmatter validates and body highlights role/status', () => {
    const row = makeEmployee({ name: 'Alex', workstation_id: 'ws-7', enabled: 1 });
    const md = renderEmployeeMd(row);
    const parsed = parseDocument(md);
    const fm = employeeFrontmatterSchema.parse(parsed.frontmatter);

    expect(fm.name).toBe('Alex');
    expect(fm.role_slug).toBe('developer');
    expect(fm.workstation_id).toBe('ws-7');
    expect(fm.dismissed).toBe(false);
    expect(parsed.body).toContain('# Alex');
    expect(parsed.body).toContain('ws-7');
  });

  it('employee.md marks dismissed employees without deleting metadata', () => {
    const row = makeEmployee({ enabled: 0 });
    const md = renderEmployeeMd(row);
    const fm = employeeFrontmatterSchema.parse(parseDocument(md).frontmatter);

    expect(fm.dismissed).toBe(true);
  });

  it('soul.md splits structured persona fields from freeform body', () => {
    const row = makeEmployee({
      persona_json: JSON.stringify({
        decisionStyle: 'analytical',
        riskPreference: 'conservative',
        communicationFrequency: 'high',
        expertise: 'code review',
        freeform: 'Values precision. Pushes back politely.',
      }),
    });
    const md = renderSoulMd(row);
    const parsed = parseDocument(md);
    const fm = soulFrontmatterSchema.parse(parsed.frontmatter);

    expect(fm.persona.decisionStyle).toBe('analytical');
    expect(fm.persona.riskPreference).toBe('conservative');
    expect(fm.persona.expertise).toBe('code review');
    expect('freeform' in fm.persona).toBe(false);
    expect(parsed.body).toContain('Values precision.');
  });

  it('memory.md orders entries newest-first inside each category', () => {
    const base = makeEmployee();
    const memories: MemoryEntryRow[] = [
      makeMemory({
        memory_id: 'mem-a',
        category: 'experience',
        last_reinforced_at: '2026-04-10T00:00:00.000Z',
      }),
      makeMemory({
        memory_id: 'mem-b',
        category: 'experience',
        last_reinforced_at: '2026-04-12T00:00:00.000Z',
      }),
      makeMemory({
        memory_id: 'mem-c',
        category: 'decision',
        last_reinforced_at: '2026-04-13T00:00:00.000Z',
      }),
    ];
    const md = renderMemoryMd(base, memories);
    const parsed = parseDocument(md);
    const fm = memoryFrontmatterSchema.parse(parsed.frontmatter);

    expect(fm.count).toBe(3);

    const experienceSection = parsed.body.split('## decision')[0] ?? '';
    const orderedIds = Array.from(experienceSection.matchAll(/`(mem-[a-z])`/gu)).map((m) => m[1]);
    expect(orderedIds).toEqual(['mem-b', 'mem-a']);

    expect(parsed.body).toContain('## knowledge');
    expect(parsed.body).toContain('## preference');
    expect(parsed.body).toContain('No entries yet');
  });

  it('relationships.md renders a Phase-6 placeholder with valid schema', () => {
    const row = makeEmployee();
    const md = renderRelationshipsMd(row);
    const parsed = parseDocument(md);
    const fm = relationshipsFrontmatterSchema.parse(parsed.frontmatter);

    expect(fm.relationships).toEqual([]);
    expect(parsed.body).toContain('Phase 6');
  });
});

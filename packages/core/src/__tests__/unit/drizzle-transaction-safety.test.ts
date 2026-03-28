import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Tests for atomic DB operations in drizzle-repositories:
 *   - setActive(): two-UPDATE sequence wrapped in a transaction
 *   - upsert(): onConflictDoUpdate instead of SELECT-then-INSERT/UPDATE
 */
import * as schema from '@offisim/db-local';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleRepositories } from '../../runtime/drizzle-repositories.js';

// Run migration SQL files in order, then create any tables that only exist in
// schema.ts but not yet have a migration file (office_layouts is schema 012).
const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? '.',
  '../../../../../packages/db-local/src/migrations',
);

const MIGRATION_FILES = [
  '001_core_tables.sql',
  '002_install_tables.sql',
  '003_runtime_orchestration.sql',
  '004_audit_and_events.sql',
  '005_memory_system.sql',
  '006_employee_versions.sql',
  '007_model_cost_rates.sql',
  '008_workstation_racks.sql',
  '009_prefab_instances.sql',
];

// Tables in schema.ts that don't have a corresponding migration file yet.
const EXTRA_DDL = `
CREATE TABLE IF NOT EXISTS office_layouts (
  layout_id   TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_office_layouts_company ON office_layouts(company_id);
`;

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8');
    sqlite.exec(sql);
  }
  sqlite.exec(EXTRA_DDL);
  return drizzle(sqlite, { schema });
}

// Seed helper
const TS = new Date().toISOString();

describe('setActive — transaction atomicity', () => {
  let repos: ReturnType<typeof createDrizzleRepositories>;

  beforeEach(() => {
    const db = createTestDb();
    repos = createDrizzleRepositories(db);
    db.insert(schema.companies)
      .values({
        company_id: 'c-1',
        name: 'Test Corp',
        status: 'active',
        created_at: TS,
        updated_at: TS,
      })
      .run();
  });

  it('switches active layout atomically', async () => {
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'Layout A',
      layout_json: '{}',
      is_active: 1,
    });
    await repos.officeLayouts.create({
      layout_id: 'l-2',
      company_id: 'c-1',
      name: 'Layout B',
      layout_json: '{}',
      is_active: 0,
    });

    await repos.officeLayouts.setActive('c-1', 'l-2');

    const l1 = await repos.officeLayouts.findById('l-1');
    const l2 = await repos.officeLayouts.findById('l-2');
    expect(l1?.is_active).toBe(0);
    expect(l2?.is_active).toBe(1);
  });

  it('throws and leaves previous layout active when layoutId does not exist', async () => {
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'Layout A',
      layout_json: '{}',
      is_active: 1,
    });

    await expect(repos.officeLayouts.setActive('c-1', 'nonexistent')).rejects.toThrow(/not found/);

    // The previous layout must still be active (transaction rolled back)
    const l1 = await repos.officeLayouts.findById('l-1');
    expect(l1?.is_active).toBe(1);
  });

  it('does not activate a layout that belongs to a different company', async () => {
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'Layout A',
      layout_json: '{}',
      is_active: 1,
    });
    // Layout from a different company (no FK enforcement needed — just a different company_id)
    await repos.officeLayouts.create({
      layout_id: 'l-other',
      company_id: 'c-1',
      name: 'Other',
      layout_json: '{}',
      is_active: 0,
    });

    // Attempt to activate l-other for a non-existent company should throw
    await expect(repos.officeLayouts.setActive('c-99', 'l-other')).rejects.toThrow(/not found/);
  });
});

describe('upsert (modelCostRates) — idempotency via onConflictDoUpdate', () => {
  let repos: ReturnType<typeof createDrizzleRepositories>;

  beforeEach(() => {
    const db = createTestDb();
    repos = createDrizzleRepositories(db);
  });

  it('inserts a new rate when none exists', async () => {
    const rate = await repos.costRates.upsert({
      provider: 'openai',
      model_pattern: 'gpt-4o',
      input_cost_per_mtok: 5.0,
      output_cost_per_mtok: 15.0,
      effective_from: '2024-01-01',
      effective_until: null,
    });

    expect(rate.provider).toBe('openai');
    expect(rate.model_pattern).toBe('gpt-4o');
    expect(rate.input_cost_per_mtok).toBe(5.0);
  });

  it('updates an existing rate without creating a duplicate row', async () => {
    const key = {
      provider: 'openai',
      model_pattern: 'gpt-4o',
      effective_from: '2024-01-01',
      effective_until: null as string | null,
    };

    await repos.costRates.upsert({ ...key, input_cost_per_mtok: 5.0, output_cost_per_mtok: 15.0 });
    const updated = await repos.costRates.upsert({
      ...key,
      input_cost_per_mtok: 3.0,
      output_cost_per_mtok: 12.0,
    });

    // Exactly one row should exist
    const all = await repos.costRates.findAll();
    expect(all).toHaveLength(1);

    // Updated values should be reflected
    expect(updated.input_cost_per_mtok).toBe(3.0);
    expect(updated.output_cost_per_mtok).toBe(12.0);
  });

  it('distinct effective_from creates separate rows', async () => {
    const base = {
      provider: 'openai',
      model_pattern: 'gpt-4o',
      input_cost_per_mtok: 5.0,
      output_cost_per_mtok: 15.0,
      effective_until: null as string | null,
    };

    await repos.costRates.upsert({ ...base, effective_from: '2024-01-01' });
    await repos.costRates.upsert({ ...base, effective_from: '2025-01-01' });

    const all = await repos.costRates.findAll();
    expect(all).toHaveLength(2);
  });
});

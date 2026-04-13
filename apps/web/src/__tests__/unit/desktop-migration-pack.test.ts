import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rustMigrationRegistryPath = path.resolve(
  __dirname,
  '../../../../desktop/src-tauri/src/lib.rs',
);
const docsMigrationDir = path.resolve(
  __dirname,
  '../../../../../Docs/03_migrations/offisim_migrations_local_v0.1',
);

const REQUIRED_DESKTOP_MIGRATIONS = [
  {
    version: 22,
    file: '022_file_history.sql',
    description: 'file history',
  },
  {
    version: 23,
    file: '023_thread_compact_baseline.sql',
    description: 'thread compact baseline',
  },
  {
    version: 24,
    file: '024_durable_interactions.sql',
    description: 'durable interactions',
  },
  {
    version: 25,
    file: '025_fix_mcp_audit_fk.sql',
    description: 'mcp audit fk fix',
  },
  {
    version: 26,
    file: '026_company_template_metadata.sql',
    description: 'company template metadata',
  },
  {
    version: 27,
    file: '027_zones.sql',
    description: 'zones',
  },
  {
    version: 28,
    file: '028_memory_entries_v2.sql',
    description: 'memory entries v2',
  },
] as const;

describe('desktop migration pack', () => {
  it('embeds the runtime-critical local migrations that exist in package db-local', async () => {
    const rustRegistry = await fs.readFile(rustMigrationRegistryPath, 'utf8');
    const docFiles = new Set(await fs.readdir(docsMigrationDir));

    for (const migration of REQUIRED_DESKTOP_MIGRATIONS) {
      expect(docFiles.has(migration.file)).toBe(true);
      expect(rustRegistry).toContain(`version: ${migration.version}`);
      expect(rustRegistry).toContain(migration.description);
      expect(rustRegistry).toContain(migration.file);
    }
  });
});

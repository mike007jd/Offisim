#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const schemaPath = join(root, 'packages/db-platform/src/schema.ts');
const baselinePath = join(root, 'packages/db-platform/schema.sql');
const legacyMigrationsDir = join(root, 'packages/db-platform/migrations');
const drizzleKit = join(root, 'node_modules/.bin/drizzle-kit');
const selfTestStaleBaseline = process.argv.includes('--self-test-stale-baseline');

if (process.argv.length > 2 && !selfTestStaleBaseline) {
  console.error('Unknown platform schema drift check argument.');
  process.exit(1);
}

function normalizeSql(sql) {
  return sql
    .replace(/\r\n/gu, '\n')
    .replace(/[ \t]+$/gmu, '')
    .trim();
}

if (!existsSync(drizzleKit)) {
  console.error('Platform schema drift check requires the pinned drizzle-kit dependency.');
  process.exit(1);
}

const legacyMigrations = existsSync(legacyMigrationsDir)
  ? readdirSync(legacyMigrationsDir).filter((name) => name.endsWith('.sql'))
  : [];
if (legacyMigrations.length > 0) {
  console.error(
    `Platform schema must remain one prelaunch baseline; remove numbered migrations: ${legacyMigrations.join(', ')}`,
  );
  process.exit(1);
}

const generated = execFileSync(
  drizzleKit,
  ['export', '--dialect=postgresql', `--schema=${schemaPath}`],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  },
);
const baseline = selfTestStaleBaseline
  ? '-- intentionally stale platform baseline\n'
  : readFileSync(baselinePath, 'utf8');

if (normalizeSql(generated) !== normalizeSql(baseline)) {
  console.error(
    'Platform schema drift detected: packages/db-platform/schema.sql does not match the current Drizzle schema export.',
  );
  console.error(
    'Regenerate the baseline with the documented Drizzle export command in Docs/DEPLOYMENT.md.',
  );
  process.exit(1);
}

const tableCount = [...generated.matchAll(/CREATE TABLE/gu)].length;
const foreignKeyCount = [...generated.matchAll(/FOREIGN KEY/gu)].length;
const indexCount = [...generated.matchAll(/CREATE INDEX/gu)].length;
if (tableCount === 0 || foreignKeyCount === 0 || indexCount === 0) {
  console.error('Platform baseline is incomplete: expected tables, foreign keys, and indexes.');
  process.exit(1);
}

console.log(
  `Platform schema drift check passed (${tableCount} tables, ${foreignKeyCount} foreign keys, ${indexCount} indexes).`,
);

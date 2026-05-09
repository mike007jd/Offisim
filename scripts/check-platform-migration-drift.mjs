#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const schemaPath =
  process.env.OFFISIM_PLATFORM_SCHEMA_PATH ?? join(root, 'packages/db-platform/src/schema.ts');
const migrationsDir =
  process.env.OFFISIM_PLATFORM_MIGRATIONS_DIR ?? join(root, 'packages/db-platform/migrations');

function readText(path) {
  return readFileSync(path, 'utf8');
}

function listMigrationFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(dir, name));
}

const schemaText = readText(schemaPath);
const migrationText = listMigrationFiles(migrationsDir).map(readText).join('\n');

const schemaConstraints = [...schemaText.matchAll(/unique\('([^']+)'\)\.on\(/g)].map(
  (match) => match[1],
);
const migrationConstraints = new Set(
  [...migrationText.matchAll(/CONSTRAINT\s+([a-zA-Z0-9_]+)/g)].map((match) => match[1]),
);

const missing = schemaConstraints.filter((name) => !migrationConstraints.has(name));

if (missing.length > 0) {
  console.error('Platform migration drift detected. Missing SQL constraints:');
  for (const name of missing) console.error(`- ${name}`);
  process.exit(1);
}

console.log(
  `Platform migration drift check passed (${schemaConstraints.length} named constraints covered).`,
);

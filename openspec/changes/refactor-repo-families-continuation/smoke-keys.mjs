// Runtime smoke: instantiate drizzle + memory factories and dump Object.keys().sort()
// Intent: prove repo keys match archived baseline (drizzle 36 / memory 37).
// Tauri is verified via desktop boot separately (pending user smoke).
// Must be copied to packages/core/ and run from there to pick up local deps.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '@offisim/db-local/dist/schema.js';
import { createDrizzleRepositories } from '@offisim/core/drizzle';
import { createMemoryRepositories } from '@offisim/core';

const sqlite = new Database(':memory:');
const db = drizzle(sqlite, { schema });

const drizzleRepos = createDrizzleRepositories(db);
const memoryRepos = createMemoryRepositories();

const drizzleKeys = Object.keys(drizzleRepos).sort();
const memoryKeys = Object.keys(memoryRepos).sort();

console.log('DRIZZLE_COUNT', drizzleKeys.length);
console.log('DRIZZLE_KEYS', drizzleKeys.join(','));
console.log('MEMORY_COUNT', memoryKeys.length);
console.log('MEMORY_KEYS', memoryKeys.join(','));

const snap1 = memoryRepos.snapshot();
console.log('MEMORY_SNAPSHOT_KEYS', Object.keys(snap1).sort().length);

const now = new Date().toISOString();
memoryRepos.seed.companies([
  { company_id: 'c1', name: 'smoke', template_id: 't', created_at: now, updated_at: now, config_json: null },
]);
const all = await memoryRepos.companies.findAll();
console.log('MEMORY_SEED_ROUNDTRIP', all.length);

const txResult = drizzleRepos.transact(() => 42);
console.log('DRIZZLE_TRANSACT_RESULT', txResult);

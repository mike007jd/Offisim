import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from '@offisim/db-local';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleRepositories } from '../../runtime/drizzle-repositories.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import type { RuntimeRepositories } from '../../runtime/repositories.js';

const DDL_PATH = resolve(
  import.meta.dirname ?? '.',
  '../../../../../Docs/02_contracts_and_schemas/offisim_local_runtime_schema.sql',
);

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const ddl = readFileSync(DDL_PATH, 'utf-8');
  sqlite.exec(ddl);
  return drizzle(sqlite, { schema });
}

function seedCompany(repos: RuntimeRepositories) {
  return repos.companies.create({
    company_id: 'c-1',
    name: 'Test Corp',
    status: 'active',
    template_id: null,
    template_label: null,
    workspace_root: null,
    default_model_policy_json: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

// Run the same test suite for both implementations
function runProjectRepoTests(label: string, getRepos: () => RuntimeRepositories) {
  describe(`ProjectRepository (${label})`, () => {
    let repos: RuntimeRepositories;

    beforeEach(async () => {
      repos = getRepos();
      await seedCompany(repos);
    });

    it('create and findById', async () => {
      const project = await repos.projects.create({
        project_id: 'p-1',
        company_id: 'c-1',
        thread_id: null,
        name: 'Test Project',
        description: 'A test project',
        status: 'planning',
      });
      expect(project.project_id).toBe('p-1');
      expect(project.name).toBe('Test Project');
      expect(project.created_at).toBeTruthy();
      expect(project.updated_at).toBeTruthy();

      const found = await repos.projects.findById('p-1');
      expect(found?.name).toBe('Test Project');
      expect(found?.status).toBe('planning');
    });

    it('findById returns null for unknown id', async () => {
      const found = await repos.projects.findById('nonexistent');
      expect(found).toBeNull();
    });

    it('findByCompany returns all projects for a company', async () => {
      await repos.projects.create({
        project_id: 'p-1',
        company_id: 'c-1',
        thread_id: null,
        name: 'Project Alpha',
        description: null,
        status: 'active',
      });
      await repos.projects.create({
        project_id: 'p-2',
        company_id: 'c-1',
        thread_id: null,
        name: 'Project Beta',
        description: null,
        status: 'paused',
      });

      const all = await repos.projects.findByCompany('c-1');
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.project_id)).toContain('p-1');
      expect(all.map((p) => p.project_id)).toContain('p-2');
    });

    it('findActiveByCompany filters by active status', async () => {
      await repos.projects.create({
        project_id: 'p-active',
        company_id: 'c-1',
        thread_id: null,
        name: 'Active Project',
        description: null,
        status: 'active',
      });
      await repos.projects.create({
        project_id: 'p-planning',
        company_id: 'c-1',
        thread_id: null,
        name: 'Planning Project',
        description: null,
        status: 'planning',
      });
      await repos.projects.create({
        project_id: 'p-completed',
        company_id: 'c-1',
        thread_id: null,
        name: 'Done Project',
        description: null,
        status: 'completed',
      });

      const active = await repos.projects.findActiveByCompany('c-1');
      // findActiveByCompany returns planning + active + paused (not completed/archived)
      expect(active).toHaveLength(2);
      const ids = active.map((p) => p.project_id);
      expect(ids).toContain('p-active');
      expect(ids).toContain('p-planning');
      expect(ids).not.toContain('p-completed');
    });

    it('updateStatus changes project status', async () => {
      await repos.projects.create({
        project_id: 'p-1',
        company_id: 'c-1',
        thread_id: null,
        name: 'Test',
        description: null,
        status: 'planning',
      });

      await repos.projects.updateStatus('p-1', 'active');
      const found = await repos.projects.findById('p-1');
      expect(found?.status).toBe('active');
    });

    it('update patches name and description', async () => {
      await repos.projects.create({
        project_id: 'p-1',
        company_id: 'c-1',
        thread_id: null,
        name: 'Old Name',
        description: null,
        status: 'planning',
      });

      await repos.projects.update('p-1', { name: 'New Name', description: 'Added desc' });
      const found = await repos.projects.findById('p-1');
      expect(found?.name).toBe('New Name');
      expect(found?.description).toBe('Added desc');
    });

    it('delete removes a project', async () => {
      await repos.projects.create({
        project_id: 'p-1',
        company_id: 'c-1',
        thread_id: null,
        name: 'To Delete',
        description: null,
        status: 'planning',
      });

      await repos.projects.delete('p-1');
      const found = await repos.projects.findById('p-1');
      expect(found).toBeNull();
    });

    it('findByCompany returns empty array when no projects', async () => {
      const all = await repos.projects.findByCompany('c-1');
      expect(all).toHaveLength(0);
    });
  });
}

// Drizzle implementation tests
runProjectRepoTests('drizzle', () => createDrizzleRepositories(createTestDb()));

// Memory implementation tests
runProjectRepoTests('memory', () => createMemoryRepositories());

// Additional: Thread findByCompanyAndStatus
describe('ThreadRepository.findByCompanyAndStatus', () => {
  let repos: RuntimeRepositories;

  beforeEach(async () => {
    repos = createMemoryRepositories();
    await seedCompany(repos);
  });

  it('returns threads matching company and status', async () => {
    await repos.threads.create({
      thread_id: 't-running',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
      project_id: null,
    });
    await repos.threads.create({
      thread_id: 't-completed',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'completed',
      project_id: null,
    });

    const running = await repos.threads.findByCompanyAndStatus('c-1', 'running');
    expect(running).toHaveLength(1);
    expect(running[0]?.thread_id).toBe('t-running');
  });

  it('returns empty array when no match', async () => {
    const result = await repos.threads.findByCompanyAndStatus('c-1', 'failed');
    expect(result).toHaveLength(0);
  });
});

describe('ThreadRepository.findByCompanyAndStatus (drizzle)', () => {
  let repos: RuntimeRepositories;

  beforeEach(async () => {
    const db = createTestDb();
    repos = createDrizzleRepositories(db);
    await seedCompany(repos);
  });

  it('returns threads matching company and status', async () => {
    await repos.threads.create({
      thread_id: 't-running',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
      project_id: null,
    });
    await repos.threads.create({
      thread_id: 't-completed',
      company_id: 'c-1',
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'completed',
      project_id: null,
    });

    const running = await repos.threads.findByCompanyAndStatus('c-1', 'running');
    expect(running).toHaveLength(1);
    expect(running[0]?.thread_id).toBe('t-running');
  });
});

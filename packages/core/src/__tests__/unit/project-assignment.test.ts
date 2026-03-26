import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Tests for ProjectAssignmentRepository (Drizzle + Memory implementations).
 *
 * Covers: assign, unassign, findByProject, findByEmployee, isAssigned,
 * UNIQUE constraint (idempotent assign), and CASCADE delete.
 */
import * as schema from '@aics/db-local';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDrizzleRepositories } from '../../runtime/drizzle-repositories.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import type { RuntimeRepositories } from '../../runtime/repositories.js';

const DDL_PATH = resolve(
  import.meta.dirname ?? '.',
  '../../../../../Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql',
);

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const ddl = readFileSync(DDL_PATH, 'utf-8');
  sqlite.exec(ddl);
  return drizzle(sqlite, { schema });
}

const TS = new Date().toISOString();

async function seedCompanyAndEmployees(repos: RuntimeRepositories) {
  await repos.companies.create({
    company_id: 'c-1',
    name: 'Test Corp',
    status: 'active',
    workspace_root: null,
    default_model_policy_json: null,
    created_at: TS,
    updated_at: TS,
  });

  await repos.employees.create({
    company_id: 'c-1',
    source_asset_id: null,
    source_package_id: null,
    name: 'Alice',
    role_slug: 'engineer',
  });
  await repos.employees.create({
    company_id: 'c-1',
    source_asset_id: null,
    source_package_id: null,
    name: 'Bob',
    role_slug: 'designer',
  });
}

async function seedProject(repos: RuntimeRepositories, projectId = 'p-1') {
  return repos.projects.create({
    project_id: projectId,
    company_id: 'c-1',
    thread_id: null,
    name: 'Test Project',
    description: null,
    status: 'active',
  });
}

function runProjectAssignmentTests(label: string, getRepos: () => RuntimeRepositories) {
  describe(`ProjectAssignmentRepository (${label})`, () => {
    let repos: RuntimeRepositories;
    let alice: string;
    let bob: string;

    beforeEach(async () => {
      repos = getRepos();
      await seedCompanyAndEmployees(repos);
      await seedProject(repos);
      // Get the employee IDs that were auto-generated
      const employees = await repos.employees.findByCompany('c-1');
      const aliceRow = employees.find((e) => e.name === 'Alice');
      const bobRow = employees.find((e) => e.name === 'Bob');
      expect(aliceRow).toBeDefined();
      expect(bobRow).toBeDefined();
      if (!aliceRow || !bobRow) {
        throw new Error('Expected seeded employees Alice and Bob');
      }
      alice = aliceRow.employee_id;
      bob = bobRow.employee_id;
    });

    it('assign and findByProject', async () => {
      const row = await repos.projectAssignments.assign({
        assignment_id: 'pa-1',
        project_id: 'p-1',
        employee_id: alice,
        role: 'member',
      });
      expect(row.assignment_id).toBe('pa-1');
      expect(row.project_id).toBe('p-1');
      expect(row.employee_id).toBe(alice);
      expect(row.role).toBe('member');
      expect(row.assigned_at).toBeTruthy();

      const assignments = await repos.projectAssignments.findByProject('p-1');
      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.employee_id).toBe(alice);
    });

    it('findByProject returns empty when no assignments', async () => {
      const assignments = await repos.projectAssignments.findByProject('p-1');
      expect(assignments).toHaveLength(0);
    });

    it('unassign removes the assignment', async () => {
      await repos.projectAssignments.assign({
        assignment_id: 'pa-1',
        project_id: 'p-1',
        employee_id: alice,
        role: 'member',
      });

      await repos.projectAssignments.unassign('p-1', alice);

      const assignments = await repos.projectAssignments.findByProject('p-1');
      expect(assignments).toHaveLength(0);
    });

    it('unassign is idempotent (no error when row does not exist)', async () => {
      await expect(repos.projectAssignments.unassign('p-1', alice)).resolves.not.toThrow();
    });

    it('isAssigned returns true after assign', async () => {
      await repos.projectAssignments.assign({
        assignment_id: 'pa-1',
        project_id: 'p-1',
        employee_id: alice,
        role: 'member',
      });

      const result = await repos.projectAssignments.isAssigned('p-1', alice);
      expect(result).toBe(true);
    });

    it('isAssigned returns false when not assigned', async () => {
      const result = await repos.projectAssignments.isAssigned('p-1', alice);
      expect(result).toBe(false);
    });

    it('isAssigned returns false after unassign', async () => {
      await repos.projectAssignments.assign({
        assignment_id: 'pa-1',
        project_id: 'p-1',
        employee_id: alice,
        role: 'member',
      });
      await repos.projectAssignments.unassign('p-1', alice);

      const result = await repos.projectAssignments.isAssigned('p-1', alice);
      expect(result).toBe(false);
    });

    it('findByEmployee returns all projects for an employee', async () => {
      await seedProject(repos, 'p-2');
      await repos.projectAssignments.assign({
        assignment_id: 'pa-1',
        project_id: 'p-1',
        employee_id: alice,
        role: 'member',
      });
      await repos.projectAssignments.assign({
        assignment_id: 'pa-2',
        project_id: 'p-2',
        employee_id: alice,
        role: 'lead',
      });
      // Bob is only in p-1
      await repos.projectAssignments.assign({
        assignment_id: 'pa-3',
        project_id: 'p-1',
        employee_id: bob,
        role: 'member',
      });

      const aliceAssignments = await repos.projectAssignments.findByEmployee(alice);
      expect(aliceAssignments).toHaveLength(2);
      const projectIds = aliceAssignments.map((a) => a.project_id);
      expect(projectIds).toContain('p-1');
      expect(projectIds).toContain('p-2');

      const bobAssignments = await repos.projectAssignments.findByEmployee(bob);
      expect(bobAssignments).toHaveLength(1);
      expect(bobAssignments[0]?.project_id).toBe('p-1');
    });

    it('UNIQUE constraint: assigning the same employee twice does not create a duplicate', async () => {
      await repos.projectAssignments.assign({
        assignment_id: 'pa-1',
        project_id: 'p-1',
        employee_id: alice,
        role: 'member',
      });
      // Second assign with a different assignment_id — should not throw and not duplicate
      await repos.projectAssignments.assign({
        assignment_id: 'pa-1b',
        project_id: 'p-1',
        employee_id: alice,
        role: 'lead',
      });

      const assignments = await repos.projectAssignments.findByProject('p-1');
      expect(assignments).toHaveLength(1);
    });

    it('multiple employees can be assigned to the same project', async () => {
      await repos.projectAssignments.assign({
        assignment_id: 'pa-1',
        project_id: 'p-1',
        employee_id: alice,
        role: 'member',
      });
      await repos.projectAssignments.assign({
        assignment_id: 'pa-2',
        project_id: 'p-1',
        employee_id: bob,
        role: 'member',
      });

      const assignments = await repos.projectAssignments.findByProject('p-1');
      expect(assignments).toHaveLength(2);
    });
  });
}

// Drizzle implementation (uses the full contract schema SQL including project_assignments)
runProjectAssignmentTests('drizzle', () => createDrizzleRepositories(createTestDb()));

// Memory implementation
runProjectAssignmentTests('memory', () => createMemoryRepositories());

// CASCADE delete: deleting a project should remove its assignments (Drizzle only — SQLite FK)
describe('ProjectAssignment CASCADE delete (drizzle)', () => {
  let repos: ReturnType<typeof createDrizzleRepositories>;
  let alice: string;

  beforeEach(async () => {
    const db = createTestDb();
    repos = createDrizzleRepositories(db);
    await repos.companies.create({
      company_id: 'c-1',
      name: 'Test Corp',
      status: 'active',
      workspace_root: null,
      default_model_policy_json: null,
      created_at: TS,
      updated_at: TS,
    });
    await repos.employees.create({
      company_id: 'c-1',
      source_asset_id: null,
      source_package_id: null,
      name: 'Alice',
      role_slug: 'engineer',
    });
    await repos.projects.create({
      project_id: 'p-1',
      company_id: 'c-1',
      thread_id: null,
      name: 'To Delete',
      description: null,
      status: 'active',
    });
    const employees = await repos.employees.findByCompany('c-1');
    const [firstEmployee] = employees;
    expect(firstEmployee).toBeDefined();
    if (!firstEmployee) throw new Error('Expected seeded employee Alice');
    alice = firstEmployee.employee_id;
  });

  it('deleting a project cascades to project_assignments', async () => {
    await repos.projectAssignments.assign({
      assignment_id: 'pa-1',
      project_id: 'p-1',
      employee_id: alice,
      role: 'member',
    });

    // Verify assignment exists
    const before = await repos.projectAssignments.findByProject('p-1');
    expect(before).toHaveLength(1);

    // Delete the project — FK ON DELETE CASCADE should remove assignments
    await repos.projects.delete('p-1');

    const after = await repos.projectAssignments.findByProject('p-1');
    expect(after).toHaveLength(0);
  });
});

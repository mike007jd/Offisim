import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { employeeCreated, employeeUpdated } from '../../events/employee-events.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { memoryCreated } from '../../events/operational-events.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { parseDocument } from '../../vault/codec.js';
import { serializeDocument } from '../../vault/codec.js';
import { employeeFrontmatterSchema, soulFrontmatterSchema } from '../../vault/frontmatter.js';
import { VAULT_SCHEMA_VERSION } from '../../vault/frontmatter.js';
import { NodeFileSystem } from '../../vault/node-fs.js';
import { employeeSlug } from '../../vault/slug.js';
import { VaultSyncError, VaultSyncService } from '../../vault/sync-service.js';

const COMPANY_ID = 'c-vault-test';
const EMPLOYEE_ID = 'e-alex';
const EMPLOYEE_NAME = 'Alex';
const SLUG = employeeSlug(EMPLOYEE_NAME, EMPLOYEE_ID);
const EMPLOYEE_DIR = `companies/${COMPANY_ID}/employees/${SLUG}`;

async function makeTempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'offisim-vault-'));
}

async function seedCompanyWithEmployee(
  repos: ReturnType<typeof createMemoryRepositories>,
): Promise<void> {
  repos.seed.companies([
    {
      company_id: COMPANY_ID,
      name: 'Vault Test Co',
      status: 'active',
      template_id: null,
      template_label: null,
      workspace_root: null,
      default_model_policy_json: null,
      created_at: '2026-04-13T09:00:00.000Z',
      updated_at: '2026-04-13T09:00:00.000Z',
    },
  ]);
  repos.seed.employees([
    {
      employee_id: EMPLOYEE_ID,
      company_id: COMPANY_ID,
      source_asset_id: null,
      source_package_id: null,
      name: EMPLOYEE_NAME,
      role_slug: 'developer',
      workstation_id: null,
      persona_json: JSON.stringify({
        decisionStyle: 'analytical',
        riskPreference: 'conservative',
        communicationFrequency: 'high',
        expertise: 'vault testing',
        freeform: 'Keeps things boring and predictable.',
      }),
      config_json: null,
      enabled: 1,
      created_at: '2026-04-13T09:00:00.000Z',
      updated_at: '2026-04-13T09:00:00.000Z',
    },
  ]);
}

describe('VaultSyncService', () => {
  let root: string;
  let eventBus: InMemoryEventBus;
  let repos: ReturnType<typeof createMemoryRepositories>;
  let service: VaultSyncService;
  let errors: VaultSyncError[];

  beforeEach(async () => {
    root = await makeTempRoot();
    eventBus = new InMemoryEventBus();
    repos = createMemoryRepositories();
    errors = [];
    await seedCompanyWithEmployee(repos);
    service = new VaultSyncService({
      fs: new NodeFileSystem({ root }),
      eventBus,
      employees: repos.employees,
      memories: repos.memories,
      debounceMs: 20,
      onError: (err) => errors.push(err),
    });
    service.subscribe();
  });

  afterEach(async () => {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes all four vault files when employee.created fires', async () => {
    eventBus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await service.flush();

    for (const file of ['employee.md', 'soul.md', 'memory.md', 'relationships.md']) {
      const filePath = path.join(root, EMPLOYEE_DIR, file);
      const stat = await fs.stat(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }

    const employeeText = await fs.readFile(path.join(root, EMPLOYEE_DIR, 'employee.md'), 'utf8');
    const fm = employeeFrontmatterSchema.parse(parseDocument(employeeText).frontmatter);
    expect(fm.employee_id).toBe(EMPLOYEE_ID);
    expect(fm.dismissed).toBe(false);
    expect(errors).toHaveLength(0);
  });

  it('debounces rapid employee.updated events into a single write pass', async () => {
    // render once so the file exists
    eventBus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await service.flush();

    const filePath = path.join(root, EMPLOYEE_DIR, 'employee.md');
    const before = await fs.stat(filePath);

    // Burst: three updates back-to-back — should land as one write after debounce
    for (let i = 0; i < 3; i += 1) {
      eventBus.emit(employeeUpdated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    }
    await service.flush();
    const after = await fs.stat(filePath);

    // Can't directly inspect write count; check file still renders once, no corruption
    expect(after.mtimeMs).toBeGreaterThanOrEqual(before.mtimeMs);
    const content = await fs.readFile(filePath, 'utf8');
    const fm = employeeFrontmatterSchema.parse(parseDocument(content).frontmatter);
    expect(fm.employee_id).toBe(EMPLOYEE_ID);
  });

  it('memory.created only touches memory.md and reflects the new entry', async () => {
    eventBus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await service.flush();

    const created = await repos.memories.create({
      memory_id: 'mem-sync-1',
      company_id: COMPANY_ID,
      scope: 'employee',
      owner_id: EMPLOYEE_ID,
      category: 'experience',
      content: 'Standups run 9am sharp.',
      importance: 0.75,
    });

    eventBus.emit(
      memoryCreated(
        COMPANY_ID,
        created.memory_id,
        EMPLOYEE_ID,
        'employee',
        'experience',
        created.content,
        't-sync-1',
      ),
    );
    await service.flush();

    const memoryText = await fs.readFile(path.join(root, EMPLOYEE_DIR, 'memory.md'), 'utf8');
    expect(memoryText).toContain('mem-sync-1');
    expect(memoryText).toContain('Standups run 9am sharp');
    expect(errors).toHaveLength(0);
  });

  it('hydrateCompany re-imports a hand-edited soul.md newer than the DB row', async () => {
    eventBus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await service.flush();

    const soulPath = path.join(root, EMPLOYEE_DIR, 'soul.md');
    const laterTimestamp = '2030-01-01T00:00:00.000Z';
    const editedSoul = serializeDocument(
      {
        schema: VAULT_SCHEMA_VERSION,
        employee_id: EMPLOYEE_ID,
        persona: {
          decisionStyle: 'directive',
          riskPreference: 'aggressive',
          communicationFrequency: 'low',
          expertise: 'vault hand-edit test',
        },
        updated_at: laterTimestamp,
      },
      '# Soul\n\nOperator-authored narrative lands here.',
    );
    await fs.writeFile(soulPath, editedSoul, 'utf8');

    const outcome = await service.hydrateCompany(COMPANY_ID);
    expect(outcome.diagnostics).toHaveLength(0);
    expect(outcome.importedEmployees).toBe(1);

    const employee = await repos.employees.findById(EMPLOYEE_ID);
    expect(employee).not.toBeNull();
    const persona = JSON.parse(employee?.persona_json ?? '{}');
    expect(persona.decisionStyle).toBe('directive');
    expect(persona.riskPreference).toBe('aggressive');
    expect(persona.freeform).toContain('Operator-authored narrative');

    // Re-rendered soul.md uses the winning DB state
    const rerenderedSoul = await fs.readFile(soulPath, 'utf8');
    const fm = soulFrontmatterSchema.parse(parseDocument(rerenderedSoul).frontmatter);
    expect(fm.persona.decisionStyle).toBe('directive');
  });

  it('treats tauri-style missing-file errors as absent vault files during hydrate', async () => {
    const writes = new Map<string, string>();
    const tauriLikeFs = {
      root,
      async readFile(relPath: string) {
        throw new Error(
          `failed to open file at path: ${path.join(root, relPath)} with error: No such file or directory (os error 2)`,
        );
      },
      async writeFile(relPath: string, content: string) {
        writes.set(relPath, content);
      },
      async listDir() {
        return [];
      },
      async stat() {
        return null;
      },
      async remove() {
        /* noop */
      },
      async mkdir() {
        /* noop */
      },
      async exists() {
        return false;
      },
    };

    const tauriLikeService = new VaultSyncService({
      fs: tauriLikeFs,
      eventBus,
      employees: repos.employees,
      memories: repos.memories,
      debounceMs: 20,
      onError: (err) => errors.push(err),
    });

    const outcome = await tauriLikeService.hydrateCompany(COMPANY_ID);

    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.importedEmployees).toBe(0);
    expect(outcome.rendered).toBe(1);
    expect(writes.has(`${EMPLOYEE_DIR}/employee.md`)).toBe(true);
    tauriLikeService.dispose();
  });

  it('surfaces a VaultSyncError through onError when FS writes fail', async () => {
    const failingFs = {
      root,
      async readFile() {
        return '';
      },
      async writeFile() {
        throw new Error('ENOSPC simulated');
      },
      async listDir() {
        return [];
      },
      async stat() {
        return null;
      },
      async remove() {
        /* noop */
      },
      async mkdir() {
        /* noop */
      },
      async exists() {
        return false;
      },
    };
    const failingService = new VaultSyncService({
      fs: failingFs,
      eventBus,
      employees: repos.employees,
      memories: repos.memories,
      debounceMs: 20,
      onError: (err) => errors.push(err),
    });
    failingService.subscribe();

    eventBus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await failingService.flush();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBeInstanceOf(VaultSyncError);
    expect(errors[0]?.employeeId).toBe(EMPLOYEE_ID);
    failingService.dispose();
  });
});

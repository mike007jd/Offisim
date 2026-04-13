import type { VaultFileSystem } from '@offisim/core/browser';
import {
  InMemoryEventBus,
  createMemoryRepositories,
  employeeCreated,
  employeeFrontmatterSchema,
  employeeSlug,
  parseDocument,
} from '@offisim/core/browser';
import type { RuntimeEvent, VaultSyncFailedPayload } from '@offisim/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { activateVaultSync } from '../vault-activation';

const COMPANY_ID = 'c-activation';
const EMPLOYEE_ID = 'e-activation-alex';
const EMPLOYEE_NAME = 'Alex';
const SLUG = employeeSlug(EMPLOYEE_NAME, EMPLOYEE_ID);

class InMemoryFs implements VaultFileSystem {
  readonly root = 'memory://';
  readonly files = new Map<string, string>();

  async readFile(relPath: string): Promise<string> {
    const value = this.files.get(relPath);
    if (value === undefined) {
      const err = new Error(`ENOENT: ${relPath}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return value;
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    this.files.set(relPath, content);
  }

  async listDir(relPath: string): Promise<string[]> {
    const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
    return [...this.files.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  async stat(): Promise<null> {
    return null;
  }

  async remove(relPath: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key === relPath || key.startsWith(`${relPath}/`)) {
        this.files.delete(key);
      }
    }
  }

  async mkdir(): Promise<void> {
    // in-memory — directories are implicit
  }

  async exists(relPath: string): Promise<boolean> {
    return this.files.has(relPath);
  }
}

function seed(repos: ReturnType<typeof createMemoryRepositories>): void {
  repos.seed.companies([
    {
      company_id: COMPANY_ID,
      name: 'Activation Co',
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
      persona_json: null,
      config_json: null,
      enabled: 1,
      created_at: '2026-04-13T09:00:00.000Z',
      updated_at: '2026-04-13T09:00:00.000Z',
    },
  ]);
}

describe('activateVaultSync', () => {
  let memoryFs: InMemoryFs;

  beforeEach(() => {
    memoryFs = new InMemoryFs();
  });

  it('materialises vault md when the activated service sees an employee event', async () => {
    const bus = new InMemoryEventBus();
    const repos = createMemoryRepositories();
    seed(repos);

    const activation = activateVaultSync({
      fs: memoryFs,
      eventBus: bus,
      repos,
      companyId: COMPANY_ID,
    });
    try {
      bus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
      await activation.service.flush();

      const employeeDoc = memoryFs.files.get(
        `companies/${COMPANY_ID}/employees/${SLUG}/employee.md`,
      );
      expect(employeeDoc).toBeDefined();
      const fm = employeeFrontmatterSchema.parse(parseDocument(employeeDoc ?? '').frontmatter);
      expect(fm.employee_id).toBe(EMPLOYEE_ID);
      expect(fm.dismissed).toBe(false);
    } finally {
      activation.dispose();
    }
  });

  it('hydrate() renders every employee and reports zero diagnostics on a fresh activation', async () => {
    const bus = new InMemoryEventBus();
    const repos = createMemoryRepositories();
    seed(repos);

    const activation = activateVaultSync({
      fs: memoryFs,
      eventBus: bus,
      repos,
      companyId: COMPANY_ID,
    });
    try {
      const result = await activation.hydrate();
      expect(result.rendered).toBe(1);
      expect(result.importedEmployees).toBe(0);
      expect(result.diagnostics).toEqual([]);
    } finally {
      activation.dispose();
    }
  });

  it('routes vault.sync.failed onto the event bus when the fs rejects writes', async () => {
    const bus = new InMemoryEventBus();
    const repos = createMemoryRepositories();
    seed(repos);

    const failures: RuntimeEvent<VaultSyncFailedPayload>[] = [];
    bus.on('vault.sync.failed', (event) => {
      failures.push(event as RuntimeEvent<VaultSyncFailedPayload>);
    });

    const failingFs: VaultFileSystem = {
      root: 'memory://failing',
      async readFile() {
        return '';
      },
      async writeFile() {
        throw new Error('disk refused');
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
    const activation = activateVaultSync({
      fs: failingFs,
      eventBus: bus,
      repos,
      companyId: COMPANY_ID,
    });
    try {
      bus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
      await activation.service.flush();

      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0]?.payload.employeeId).toBe(EMPLOYEE_ID);
      expect(failures[0]?.payload.target).toBe('write');
    } finally {
      activation.dispose();
    }
  });
});

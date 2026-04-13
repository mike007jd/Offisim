import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeEvent, VaultSyncFailedPayload } from '@offisim/shared-types';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { employeeCreated } from '../../events/employee-events.js';
import { memoryCreated } from '../../events/operational-events.js';
import { parseDocument } from '../../vault/codec.js';
import { memoryFrontmatterSchema } from '../../vault/frontmatter.js';
import { NodeFileSystem } from '../../vault/node-fs.js';
import { employeeSlug } from '../../vault/slug.js';
import { VaultSyncService } from '../../vault/sync-service.js';
import { createAiRuntime, describeIfMinimax, requireMinimaxKey } from './harness.js';

describeIfMinimax('Phase 1b - Vault attached to real AI runtime [AI]', () => {
  let root: string;
  let runtime: ReturnType<typeof createAiRuntime>;
  let service: VaultSyncService | null = null;

  beforeEach(async () => {
    requireMinimaxKey();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'offisim-vault-runtime-'));
    runtime = createAiRuntime();
  });

  afterEach(async () => {
    service?.dispose();
    service = null;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('renders vault files for a fresh employee and mirrors a real-LLM-generated memory', async () => {
    const failureEvents: RuntimeEvent<VaultSyncFailedPayload>[] = [];
    runtime.eventBus.on('vault.sync.failed', (event) => {
      failureEvents.push(event as RuntimeEvent<VaultSyncFailedPayload>);
    });

    service = new VaultSyncService({
      fs: new NodeFileSystem({ root }),
      eventBus: runtime.eventBus,
      employees: runtime.repos.employees,
      memories: runtime.repos.memories,
      debounceMs: 20,
    });
    service.subscribe();

    // Drive a real LLM chat turn — minimax produces a non-empty reply.
    const reply = await runtime.runSmokeTask(
      'Answer in one short sentence: what do operators expect from this agent?',
    );
    expect(reply.trim().length).toBeGreaterThan(0);

    // Feed the LLM output into the memory pipeline exactly the way the runtime does
    // (via MemoryRepository.create + memory.created event). This is the real path
    // MemoryService uses; we bypass MemoryService itself because this suite avoids
    // coupling Phase 1 to reflection/extraction flows owned by Phase 3.
    const created = await runtime.repos.memories.create({
      memory_id: 'mem-phase1b-1',
      company_id: runtime.companyId,
      scope: 'employee',
      owner_id: runtime.employeeId,
      category: 'experience',
      content: reply.slice(0, 240),
      importance: 0.7,
    });

    runtime.eventBus.emit(
      memoryCreated(
        runtime.companyId,
        created.memory_id,
        runtime.employeeId,
        'employee',
        'experience',
        created.content,
        runtime.threadId,
      ),
    );

    // Seed employee.created so vault writes the full bundle too.
    runtime.eventBus.emit(
      employeeCreated(runtime.companyId, runtime.employeeId, 'Runtime Smoke Dev', 'developer'),
    );

    await service.flush();

    const slug = employeeSlug('Runtime Smoke Dev', runtime.employeeId);
    const dir = path.join(root, 'companies', runtime.companyId, 'employees', slug);
    for (const file of ['employee.md', 'soul.md', 'memory.md', 'relationships.md']) {
      const stat = await fs.stat(path.join(dir, file));
      expect(stat.size).toBeGreaterThan(0);
    }

    const memoryText = await fs.readFile(path.join(dir, 'memory.md'), 'utf8');
    const parsed = parseDocument(memoryText);
    const fm = memoryFrontmatterSchema.parse(parsed.frontmatter);
    expect(fm.count).toBe(1);
    expect(parsed.body).toContain('mem-phase1b-1');
    expect(failureEvents).toHaveLength(0);
  }, 90_000);

  it('emits vault.sync.failed on the event bus when the filesystem rejects a write', async () => {
    const failureEvents: RuntimeEvent<VaultSyncFailedPayload>[] = [];
    runtime.eventBus.on('vault.sync.failed', (event) => {
      failureEvents.push(event as RuntimeEvent<VaultSyncFailedPayload>);
    });

    service = new VaultSyncService({
      fs: {
        root,
        async readFile() {
          return '';
        },
        async writeFile() {
          throw new Error('rejected');
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
      },
      eventBus: runtime.eventBus,
      employees: runtime.repos.employees,
      memories: runtime.repos.memories,
      debounceMs: 20,
    });
    service.subscribe();

    runtime.eventBus.emit(
      employeeCreated(runtime.companyId, runtime.employeeId, 'Runtime Smoke Dev', 'developer'),
    );
    await service.flush();

    expect(failureEvents.length).toBeGreaterThan(0);
    const failure = failureEvents[0];
    expect(failure?.type).toBe('vault.sync.failed');
    expect(failure?.payload.employeeId).toBe(runtime.employeeId);
    expect(failure?.payload.target).toBe('write');
  });
});

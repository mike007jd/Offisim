import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { employeeCreated, employeeUpdated } from '../../events/employee-events.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { memoryCreated } from '../../events/operational-events.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { parseDocument, serializeDocument } from '../../vault/codec.js';
import {
  VAULT_SCHEMA_VERSION,
  employeeFrontmatterSchema,
  memoryFrontmatterSchema,
  soulFrontmatterSchema,
} from '../../vault/frontmatter.js';
import { NodeFileSystem } from '../../vault/node-fs.js';
import { employeeSlug } from '../../vault/slug.js';
import { type VaultSyncError, VaultSyncService } from '../../vault/sync-service.js';
import { describeIfMinimax, requireMinimaxKey } from './harness.js';

const COMPANY_ID = 'c-vault-ai';
const EMPLOYEE_ID = 'e-alex-ai';
const EMPLOYEE_NAME = 'Alex';
const SLUG = employeeSlug(EMPLOYEE_NAME, EMPLOYEE_ID);
const DIR = `companies/${COMPANY_ID}/employees/${SLUG}`;

type HarnessContext = {
  root: string;
  bus: InMemoryEventBus;
  repos: ReturnType<typeof createMemoryRepositories>;
  service: VaultSyncService;
  errors: VaultSyncError[];
};

async function buildHarness(): Promise<HarnessContext> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'offisim-vault-ai-'));
  const bus = new InMemoryEventBus();
  const repos = createMemoryRepositories();
  const errors: VaultSyncError[] = [];
  const service = new VaultSyncService({
    fs: new NodeFileSystem({ root }),
    eventBus: bus,
    employees: repos.employees,
    memories: repos.memories,
    debounceMs: 20,
    onError: (err) => errors.push(err),
  });
  service.subscribe();
  repos.seed.companies([
    {
      company_id: COMPANY_ID,
      name: 'AI Vault Co',
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
        expertise: 'vault AI-backed testing',
        freeform: 'Treats operator preferences as load-bearing.',
      }),
      config_json: null,
      enabled: 1,
      created_at: '2026-04-13T09:00:00.000Z',
      updated_at: '2026-04-13T09:00:00.000Z',
    },
  ]);
  return { root, bus, repos, service, errors };
}

async function teardown(ctx: HarnessContext): Promise<void> {
  ctx.service.dispose();
  await fs.rm(ctx.root, { recursive: true, force: true });
}

describeIfMinimax('Phase 1 - Employee Vault [AI]', () => {
  let ctx: HarnessContext;

  beforeEach(async () => {
    requireMinimaxKey();
    ctx = await buildHarness();
  });

  afterEach(async () => {
    await teardown(ctx);
  });

  it('materialises the four-file vault when an employee is created', async () => {
    ctx.bus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await ctx.service.flush();

    for (const file of ['employee.md', 'soul.md', 'memory.md', 'relationships.md']) {
      const raw = await fs.readFile(path.join(ctx.root, DIR, file), 'utf8');
      const { frontmatter } = parseDocument(raw);
      expect((frontmatter as { schema: number }).schema).toBe(VAULT_SCHEMA_VERSION);
    }

    const employeeDoc = await fs.readFile(path.join(ctx.root, DIR, 'employee.md'), 'utf8');
    const fm = employeeFrontmatterSchema.parse(parseDocument(employeeDoc).frontmatter);
    expect(fm.dismissed).toBe(false);
    expect(fm.role_slug).toBe('developer');
  });

  it('writes a real-LLM-derived memory entry into memory.md after a task runs', async () => {
    ctx.bus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await ctx.service.flush();

    const apiKey = requireMinimaxKey();
    const client = new Anthropic({
      apiKey,
      baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
    });
    const response = await client.messages.create({
      model: process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content:
            'Summarize in one sentence (under 120 chars) what a fresh developer should remember about this workspace: boss prefers concise updates.',
        },
      ],
    });
    const textFromBlock = (block: Anthropic.ContentBlock): string => {
      if (block.type === 'text') {
        return block.text;
      }
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        return block.thinking;
      }
      return '';
    };
    const text = response.content.map(textFromBlock).join(' ').replace(/\s+/gu, ' ').trim();
    if (text.length === 0) {
      // MiniMax occasionally replies with only thinking frames; skip rather than flake.
      console.warn('[phase-01-vault] MiniMax returned empty content; skipping memory assertion');
      return;
    }
    expect(text.length).toBeGreaterThan(0);

    const created = await ctx.repos.memories.create({
      memory_id: 'mem-ai-1',
      company_id: COMPANY_ID,
      scope: 'employee',
      owner_id: EMPLOYEE_ID,
      category: 'preference',
      content: text,
      importance: 0.8,
    });

    ctx.bus.emit(
      memoryCreated(
        COMPANY_ID,
        created.memory_id,
        EMPLOYEE_ID,
        'employee',
        'preference',
        created.content,
        't-ai-1',
      ),
    );
    await ctx.service.flush();

    const raw = await fs.readFile(path.join(ctx.root, DIR, 'memory.md'), 'utf8');
    const parsed = parseDocument(raw);
    const fm = memoryFrontmatterSchema.parse(parsed.frontmatter);
    expect(fm.count).toBe(1);
    expect(parsed.body).toContain('mem-ai-1');
    // LLM-generated content landed inside the markdown body
    expect(parsed.body).toContain(text.split('\n')[0]?.slice(0, 20) ?? '');
  }, 60_000);

  it('re-imports a hand-edited soul.md that is newer than the DB row', async () => {
    ctx.bus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await ctx.service.flush();

    const soulPath = path.join(ctx.root, DIR, 'soul.md');
    const editedSoul = serializeDocument(
      {
        schema: VAULT_SCHEMA_VERSION,
        employee_id: EMPLOYEE_ID,
        persona: {
          decisionStyle: 'directive',
          riskPreference: 'aggressive',
          communicationFrequency: 'low',
          expertise: 'operator hand-edit',
        },
        updated_at: '2030-01-01T00:00:00.000Z',
      },
      '# Soul\n\nOperator rewrote the persona narrative here.',
    );
    await fs.writeFile(soulPath, editedSoul, 'utf8');

    const outcome = await ctx.service.hydrateCompany(COMPANY_ID);
    expect(outcome.diagnostics).toHaveLength(0);
    expect(outcome.importedEmployees).toBe(1);

    const updated = await ctx.repos.employees.findById(EMPLOYEE_ID);
    const persona = JSON.parse(updated?.persona_json ?? '{}');
    expect(persona.decisionStyle).toBe('directive');
    expect(persona.freeform).toContain('Operator rewrote');
    const refreshed = await fs.readFile(soulPath, 'utf8');
    const fm = soulFrontmatterSchema.parse(parseDocument(refreshed).frontmatter);
    expect(fm.persona.decisionStyle).toBe('directive');
  });

  it('marks the employee as dismissed in employee.md without deleting the folder', async () => {
    ctx.bus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await ctx.service.flush();

    await ctx.repos.employees.update(EMPLOYEE_ID, { enabled: 0 });
    ctx.bus.emit(employeeUpdated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await ctx.service.flush();

    const raw = await fs.readFile(path.join(ctx.root, DIR, 'employee.md'), 'utf8');
    const fm = employeeFrontmatterSchema.parse(parseDocument(raw).frontmatter);
    expect(fm.dismissed).toBe(true);

    // folder and peer files must still exist
    for (const file of ['soul.md', 'memory.md', 'relationships.md']) {
      await fs.stat(path.join(ctx.root, DIR, file));
    }
  });

  it('surfaces a VaultSyncError when the filesystem rejects writes', async () => {
    ctx.service.dispose();
    const collected: VaultSyncError[] = [];
    const failingService = new VaultSyncService({
      fs: {
        root: ctx.root,
        async readFile() {
          return '';
        },
        async writeFile() {
          throw new Error('simulated disk full');
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
      eventBus: ctx.bus,
      employees: ctx.repos.employees,
      memories: ctx.repos.memories,
      debounceMs: 20,
      onError: (err) => collected.push(err),
    });
    failingService.subscribe();
    ctx.bus.emit(employeeCreated(COMPANY_ID, EMPLOYEE_ID, EMPLOYEE_NAME, 'developer'));
    await failingService.flush();
    failingService.dispose();

    expect(collected.length).toBeGreaterThan(0);
    expect(collected[0]?.employeeId).toBe(EMPLOYEE_ID);
    expect(collected[0]?.cause).toBeInstanceOf(Error);
  });
});

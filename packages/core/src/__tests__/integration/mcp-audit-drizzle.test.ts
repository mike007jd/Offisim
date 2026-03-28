import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from '@offisim/db-local';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { AuditingToolExecutor } from '../../mcp/auditing-tool-executor.js';
import { McpToolExecutor } from '../../mcp/mcp-tool-executor.js';
import type {
  McpClientFactory,
  McpConnection,
  McpServerConfig,
  McpToolDef,
} from '../../mcp/types.js';
import { createDrizzleRepositories } from '../../runtime/drizzle-repositories.js';
import type { ToolCallRequest } from '../../runtime/tool-executor.js';

const DDL_PATH = resolve(
  import.meta.dirname ?? '.',
  '../../../../../Docs/02_contracts_and_schemas/offisim_local_runtime_schema.sql',
);
const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? '.',
  '../../../../../Docs/03_migrations/offisim_migrations_local_v0.1',
);

class TestMcpClientFactory implements McpClientFactory {
  private readonly serverTools = new Map<string, McpToolDef[]>();
  private readonly toolHandlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  register(
    serverName: string,
    tools: McpToolDef[],
    handlers: Record<string, (args: Record<string, unknown>) => unknown>,
  ): void {
    this.serverTools.set(serverName, tools);
    for (const [name, handler] of Object.entries(handlers)) {
      this.toolHandlers.set(`${serverName}:${name}`, handler);
    }
  }

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    const tools = this.serverTools.get(config.name) ?? [];
    const handlers = this.toolHandlers;

    return {
      config,
      tools,
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        const handler = handlers.get(`${config.name}:${name}`);
        if (!handler) {
          throw new Error(`No handler for tool '${name}' on server '${config.name}'`);
        }
        return handler(args);
      },
      async close(): Promise<void> {},
    };
  }
}

function createSchemaContractDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(readFileSync(DDL_PATH, 'utf-8'));
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

function createMigratedDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

async function createHarness(createDb: typeof createMigratedDb | typeof createSchemaContractDb) {
  const testDb = createDb();
  const repos = createDrizzleRepositories(testDb.db);
  const eventBus = new InMemoryEventBus();

  testDb.db
    .insert(schema.companies)
    .values({
      company_id: 'company-1',
      name: 'Audit Corp',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .run();

  await repos.threads.create({
    thread_id: 'thread-1',
    company_id: 'company-1',
    entry_mode: 'boss_chat',
    root_task_id: null,
    status: 'running',
  });

  const clientFactory = new TestMcpClientFactory();
  clientFactory.register(
    'fs-server',
    [
      {
        name: 'readFile',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ],
    {
      readFile: (args) => ({ content: `opened:${String(args.path)}` }),
    },
  );

  const inner = new McpToolExecutor({
    eventBus,
    companyId: 'company-1',
    clientFactory,
  });
  await inner.addServer({ name: 'fs-server', transport: 'stdio', command: 'mock' });

  const executor = new AuditingToolExecutor(
    inner,
    repos.mcpAudit,
    eventBus,
    'company-1',
    'thread-1',
  );

  return {
    sqlite: testDb.sqlite,
    repos,
    eventBus,
    inner,
    executor,
  };
}

describe('MCP audit integration with Drizzle repositories', () => {
  let sqlite: Database.Database;
  let repos: ReturnType<typeof createDrizzleRepositories>;
  let eventBus: InMemoryEventBus;
  let inner: McpToolExecutor;
  let executor: AuditingToolExecutor;

  beforeEach(async () => {
    ({ sqlite, repos, eventBus, inner, executor } = await createHarness(createMigratedDb));
  });

  afterEach(async () => {
    await inner.dispose();
    sqlite.close();
  });

  it('persists MCP audit rows in SQLite and emits paired events on success', async () => {
    const calledEvents: Array<{ serverName: string; toolName: string }> = [];
    const resultEvents: Array<{ serverName: string; toolName: string; toolCallId: string }> = [];

    eventBus.on('mcp.tool.called', (event) => {
      calledEvents.push({
        serverName: event.payload.serverName,
        toolName: event.payload.toolName,
      });
    });
    eventBus.on('mcp.tool.result', (event) => {
      resultEvents.push({
        serverName: event.payload.serverName,
        toolName: event.payload.toolName,
        toolCallId: event.payload.toolCallId,
      });
    });

    const call: ToolCallRequest = {
      toolCallId: 'tc-42',
      name: 'readFile',
      arguments: { path: 'docs/spec.md' },
      employeeId: 'emp-1',
    };

    const response = await executor.execute(call);
    const rows = await repos.mcpAudit.listByThread('thread-1');

    expect(response).toEqual({
      success: true,
      result: { content: 'opened:docs/spec.md' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.server_name).toBe('fs-server');
    expect(rows[0]?.tool_name).toBe('readFile');
    expect(rows[0]?.employee_id).toBe('emp-1');
    expect(rows[0]?.arguments_json).toBe(JSON.stringify({ path: 'docs/spec.md' }));
    expect(rows[0]?.result_json).toBe(JSON.stringify({ content: 'opened:docs/spec.md' }));
    expect(rows[0]?.error).toBeNull();
    expect(calledEvents).toEqual([{ serverName: 'fs-server', toolName: 'readFile' }]);
    expect(resultEvents).toHaveLength(1);
  });

  it('fails against the published local runtime schema because mcp_audit_log is missing', async () => {
    const contractHarness = await createHarness(createSchemaContractDb);

    await contractHarness.executor.execute({
      toolCallId: 'tc-contract',
      name: 'readFile',
      arguments: { path: 'README.md' },
      employeeId: 'emp-1',
    });

    expect(() => contractHarness.sqlite.prepare('select * from mcp_audit_log').all()).toThrow(
      /no such table: mcp_audit_log/i,
    );

    await contractHarness.inner.dispose();
    contractHarness.sqlite.close();
  });

  it('emits mcp.tool.result with the original toolCallId so UI can pair call and result', async () => {
    let resultEventToolCallId: string | null = null;

    eventBus.on('mcp.tool.result', (event) => {
      resultEventToolCallId = event.payload.toolCallId;
    });

    await executor.execute({
      toolCallId: 'tc-original',
      name: 'readFile',
      arguments: { path: 'README.md' },
      employeeId: 'emp-1',
    });

    expect(resultEventToolCallId).toBe('tc-original');
  });
});

import type { RuntimeEvent } from '@offisim/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { McpToolExecutor } from '../../mcp/mcp-tool-executor.js';
import type {
  McpClientFactory,
  McpConnection,
  McpServerConfig,
  McpToolDef,
} from '../../mcp/types.js';
import { TEST_COMPANY_ID } from '../helpers/fixtures.js';

// ── Mock MCP Client Factory ──────────────────────────────────────

function createMockConnection(
  config: McpServerConfig,
  tools: McpToolDef[],
  callToolImpl?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): McpConnection {
  let closed = false;
  return {
    config,
    tools,
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      if (closed) throw new Error('Connection closed');
      if (callToolImpl) return callToolImpl(name, args);
      return { mockResult: true, tool: name, args };
    },
    async close(): Promise<void> {
      closed = true;
    },
  };
}

class MockClientFactory implements McpClientFactory {
  private readonly configs = new Map<
    string,
    {
      tools: McpToolDef[];
      callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    }
  >();
  readonly connections: McpConnection[] = [];

  registerServer(
    name: string,
    tools: McpToolDef[],
    callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.configs.set(name, { tools, callTool });
  }

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    const entry = this.configs.get(config.name);
    if (!entry) throw new Error(`No mock config for server '${config.name}'`);
    const conn = createMockConnection(config, entry.tools, entry.callTool);
    this.connections.push(conn);
    return conn;
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('McpToolExecutor', () => {
  let executor: McpToolExecutor;
  let eventBus: InMemoryEventBus;
  let factory: MockClientFactory;
  // biome-ignore lint/suspicious/noExplicitAny: event collector captures all payload types
  let events: RuntimeEvent<any>[];

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    events = [];
    eventBus.on('', (e) => events.push(e));

    factory = new MockClientFactory();
    executor = new McpToolExecutor({
      eventBus,
      companyId: TEST_COMPANY_ID,
      clientFactory: factory,
    });
  });

  afterEach(async () => {
    await executor.dispose();
  });

  it('addServer registers a connection and lists tools', async () => {
    factory.registerServer('fs-server', [
      { name: 'readFile', description: 'Read a file', inputSchema: { type: 'object' } },
      { name: 'writeFile', description: 'Write a file', inputSchema: { type: 'object' } },
    ]);

    await executor.addServer({
      name: 'fs-server',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    expect(executor.serverCount).toBe(1);

    const tools = await executor.listAvailable(TEST_COMPANY_ID);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['readFile', 'writeFile']);
  });

  it('listAvailable returns tools from all connected servers', async () => {
    factory.registerServer('fs-server', [
      { name: 'readFile', description: 'Read a file', inputSchema: {} },
    ]);
    factory.registerServer('git-server', [
      { name: 'gitStatus', description: 'Git status', inputSchema: {} },
      { name: 'gitDiff', description: 'Git diff', inputSchema: {} },
    ]);

    await executor.addServer({ name: 'fs-server', transport: 'stdio', command: 'node' });
    await executor.addServer({ name: 'git-server', transport: 'stdio', command: 'node' });

    const tools = await executor.listAvailable(TEST_COMPANY_ID);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual(['gitDiff', 'gitStatus', 'readFile']);
  });

  it('execute dispatches to the correct server and returns result', async () => {
    factory.registerServer(
      'fs-server',
      [{ name: 'readFile', description: 'Read a file', inputSchema: {} }],
      async (_name, args) => ({ content: `contents of ${args.path}` }),
    );

    factory.registerServer(
      'git-server',
      [{ name: 'gitStatus', description: 'Git status', inputSchema: {} }],
      async () => ({ status: 'clean' }),
    );

    await executor.addServer({ name: 'fs-server', transport: 'stdio', command: 'node' });
    await executor.addServer({ name: 'git-server', transport: 'stdio', command: 'node' });

    const result = await executor.execute({
      toolCallId: 'tc-1',
      name: 'readFile',
      arguments: { path: '/src/index.ts' },
    });

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ content: 'contents of /src/index.ts' });

    const gitResult = await executor.execute({
      toolCallId: 'tc-2',
      name: 'gitStatus',
      arguments: {},
    });

    expect(gitResult.success).toBe(true);
    expect(gitResult.result).toEqual({ status: 'clean' });
  });

  it('execute returns error response for unknown tool', async () => {
    factory.registerServer('fs-server', [
      { name: 'readFile', description: 'Read a file', inputSchema: {} },
    ]);

    await executor.addServer({ name: 'fs-server', transport: 'stdio', command: 'node' });

    const result = await executor.execute({
      toolCallId: 'tc-1',
      name: 'unknownTool',
      arguments: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool: unknownTool');
  });

  it('dispose closes all connections', async () => {
    factory.registerServer('server-a', [{ name: 'toolA', description: 'Tool A', inputSchema: {} }]);
    factory.registerServer('server-b', [{ name: 'toolB', description: 'Tool B', inputSchema: {} }]);

    await executor.addServer({ name: 'server-a', transport: 'stdio', command: 'node' });
    await executor.addServer({ name: 'server-b', transport: 'stdio', command: 'node' });

    expect(executor.serverCount).toBe(2);

    await executor.dispose();

    expect(executor.serverCount).toBe(0);

    // Tools should be empty after dispose
    const tools = await executor.listAvailable(TEST_COMPANY_ID);
    expect(tools).toHaveLength(0);
  });

  it('emits mcpServerConnected event on addServer', async () => {
    factory.registerServer('my-server', [
      { name: 'toolX', description: 'Tool X', inputSchema: {} },
      { name: 'toolY', description: 'Tool Y', inputSchema: {} },
    ]);

    await executor.addServer({ name: 'my-server', transport: 'stdio', command: 'node' });

    const connectedEvents = events.filter((e) => e.type === 'mcp.server.connected');
    expect(connectedEvents).toHaveLength(1);
    expect(connectedEvents[0]?.payload).toEqual({
      serverName: 'my-server',
      toolCount: 2,
    });
  });

  it('emits mcpToolCalled event on successful execute', async () => {
    factory.registerServer(
      'fs-server',
      [{ name: 'readFile', description: 'Read a file', inputSchema: {} }],
      async () => ({ content: 'file data' }),
    );

    await executor.addServer({ name: 'fs-server', transport: 'stdio', command: 'node' });

    // Clear events from addServer
    events.length = 0;

    await executor.execute({
      toolCallId: 'tc-1',
      name: 'readFile',
      arguments: { path: '/test.ts' },
    });

    const toolCalledEvents = events.filter((e) => e.type === 'mcp.tool.called');
    expect(toolCalledEvents).toHaveLength(1);
    expect(toolCalledEvents[0]?.payload).toEqual({
      serverName: 'fs-server',
      toolName: 'readFile',
      employeeId: '',
    });
  });

  it('removeServer disconnects and removes tools', async () => {
    factory.registerServer('temp-server', [
      { name: 'tempTool', description: 'Temporary', inputSchema: {} },
    ]);

    await executor.addServer({ name: 'temp-server', transport: 'stdio', command: 'node' });
    expect(executor.serverCount).toBe(1);

    await executor.removeServer('temp-server');
    expect(executor.serverCount).toBe(0);

    const tools = await executor.listAvailable(TEST_COMPANY_ID);
    expect(tools).toHaveLength(0);

    // Tool should no longer be callable
    const result = await executor.execute({
      toolCallId: 'tc-1',
      name: 'tempTool',
      arguments: {},
    });
    expect(result.success).toBe(false);
  });

  it('getServerForTool returns server name for registered tool', async () => {
    factory.registerServer('test-server', [
      { name: 'read_file', description: 'Read a file', inputSchema: {} },
    ]);

    const mockConfig: McpServerConfig = {
      name: 'test-server',
      transport: 'stdio',
      command: 'node',
    };
    await executor.addServer(mockConfig);
    expect(executor.getServerForTool('read_file')).toBe('test-server');
  });

  it('getServerForTool returns undefined for unknown tool', () => {
    expect(executor.getServerForTool('nonexistent')).toBeUndefined();
  });

  it('handles callTool errors gracefully', async () => {
    factory.registerServer(
      'error-server',
      [{ name: 'failingTool', description: 'Always fails', inputSchema: {} }],
      async () => {
        throw new Error('Connection reset');
      },
    );

    await executor.addServer({ name: 'error-server', transport: 'stdio', command: 'node' });

    const result = await executor.execute({
      toolCallId: 'tc-1',
      name: 'failingTool',
      arguments: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection reset');
  });
});

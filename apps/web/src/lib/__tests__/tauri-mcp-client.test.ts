import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../browser-mcp-client', () => ({
  BrowserMcpClientFactory: vi.fn().mockImplementation(() => ({
    createClient: vi.fn().mockResolvedValue({
      config: { name: 'sse-server', transport: 'sse', url: 'http://localhost' },
      tools: [],
      callTool: vi.fn(),
      close: vi.fn(),
    }),
  })),
}));

import { invoke } from '@tauri-apps/api/core';
import { TauriMcpClientFactory } from '../tauri-mcp-client';

type DesktopMcpServerConfig = {
  name: string;
  transport: 'stdio' | 'sse';
  registeredServerId?: string;
  url?: string;
};

describe('TauriMcpClientFactory', () => {
  let factory: TauriMcpClientFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new TauriMcpClientFactory();
  });

  it('delegates SSE transport to BrowserMcpClientFactory', async () => {
    const conn = await factory.createClient({
      name: 'sse-server',
      transport: 'sse',
      url: 'http://localhost:8080',
    });
    expect(conn.config.transport).toBe('sse');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invokes Rust bridge for stdio transport', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      server_name: 'my-mcp',
      tools: [{ name: 'read', description: 'Read files', input_schema: {} }],
      state: 'ready',
    });

    const conn = await factory.createClient({
      name: 'my-mcp',
      transport: 'stdio',
      registeredServerId: 'mcp-123',
    } as DesktopMcpServerConfig);

    expect(invoke).toHaveBeenCalledWith('plugin:mcp_bridge|mcp_connect_registered', {
      request: { serverId: 'mcp-123' },
    });
    expect(conn.tools).toHaveLength(1);
    expect(conn.tools[0]?.name).toBe('read');
  });

  it('throws if stdio has no registered server id', async () => {
    await expect(
      factory.createClient({ name: 'bad', transport: 'stdio' } as DesktopMcpServerConfig),
    ).rejects.toThrow('registered server id');
  });

  it('callTool invokes Rust bridge mcp_call_tool', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      server_name: 'my-mcp',
      tools: [{ name: 'read', description: 'Read files', input_schema: {} }],
      state: 'ready',
    });

    const conn = await factory.createClient({
      name: 'my-mcp',
      transport: 'stdio',
      registeredServerId: 'mcp-123',
    } as DesktopMcpServerConfig);

    vi.mocked(invoke).mockResolvedValueOnce({ content: 'file data' });
    await conn.callTool('read', { path: '/tmp/test.txt' });

    expect(invoke).toHaveBeenCalledWith('plugin:mcp_bridge|mcp_call_tool', {
      server: 'my-mcp',
      tool: 'read',
      args: { path: '/tmp/test.txt' },
    });
  });

  it('close invokes Rust bridge mcp_kill', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      server_name: 'my-mcp',
      tools: [],
      state: 'ready',
    });

    const conn = await factory.createClient({
      name: 'my-mcp',
      transport: 'stdio',
      registeredServerId: 'mcp-123',
    } as DesktopMcpServerConfig);

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await conn.close();

    expect(invoke).toHaveBeenCalledWith('plugin:mcp_bridge|mcp_kill', {
      server: 'my-mcp',
    });
  });
});

import type {
  McpClientFactory,
  McpConnection,
  McpServerConfig,
  McpToolDef,
} from '@aics/core/browser';
/**
 * MCP client factory for Tauri desktop environment.
 *
 * stdio transport — delegates to Rust mcp_bridge via Tauri IPC.
 * SSE transport  — delegates to BrowserMcpClientFactory (composition).
 */
import { invoke } from '@tauri-apps/api/core';
import { BrowserMcpClientFactory } from './browser-mcp-client';

interface McpSpawnResult {
  server_name: string;
  tools: Array<{ name: string; description: string; input_schema: unknown }>;
  state: string;
}

type DesktopMcpServerConfig = McpServerConfig & {
  readonly registeredServerId?: string;
};

export class TauriMcpClientFactory implements McpClientFactory {
  private readonly sseFallback = new BrowserMcpClientFactory();

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    const desktopConfig = config as DesktopMcpServerConfig;
    if (config.transport === 'sse') {
      return this.sseFallback.createClient(config);
    }

    if (!desktopConfig.registeredServerId) {
      throw new Error(`MCP server '${config.name}' uses stdio but has no registered server id.`);
    }

    const result = await invoke<McpSpawnResult>('plugin:mcp_bridge|mcp_connect_registered', {
      request: {
        serverId: desktopConfig.registeredServerId,
      },
    });

    const tools: McpToolDef[] = result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    }));

    return {
      config,
      tools,
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        return invoke('plugin:mcp_bridge|mcp_call_tool', {
          server: config.name,
          tool: name,
          args,
        });
      },
      async close(): Promise<void> {
        await invoke('plugin:mcp_bridge|mcp_kill', { server: config.name });
      },
    };
  }
}

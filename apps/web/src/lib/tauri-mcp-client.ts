/**
 * MCP client factory for Tauri desktop environment.
 *
 * stdio transport — delegates to Rust mcp_bridge via Tauri IPC.
 * SSE transport  — delegates to BrowserMcpClientFactory (composition).
 */
import { invoke } from '@tauri-apps/api/core';
import type { McpClientFactory, McpConnection, McpServerConfig, McpToolDef } from '@aics/core';
import { BrowserMcpClientFactory } from './browser-mcp-client';

interface McpSpawnResult {
  server_name: string;
  tools: Array<{ name: string; description: string; input_schema: unknown }>;
  state: string;
}

export class TauriMcpClientFactory implements McpClientFactory {
  private readonly sseFallback = new BrowserMcpClientFactory();

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    if (config.transport === 'sse') {
      return this.sseFallback.createClient(config);
    }

    if (!config.command) {
      throw new Error(
        `MCP server '${config.name}' uses stdio but has no command specified.`,
      );
    }

    const result = await invoke<McpSpawnResult>('plugin:mcp_bridge|mcp_spawn', {
      config: {
        name: config.name,
        command: config.command,
        args: config.args ?? [],
        env: config.env ?? {},
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

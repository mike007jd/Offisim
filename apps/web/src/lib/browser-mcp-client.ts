/**
 * Browser-safe MCP client factory.
 *
 * Only supports SSE transport (no stdio — that needs child_process / Node.js).
 * Uses @modelcontextprotocol/sdk's SSEClientTransport which depends on the
 * `eventsource` npm package (v3 is pure JS, browser-safe).
 *
 * For desktop/Tauri, stdio support can be added later via a Tauri shell command bridge.
 */

import type { McpClientFactory, McpConnection, McpServerConfig, McpToolDef } from '@aics/core/browser';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/**
 * McpClientFactory implementation for browser environments.
 *
 * Only supports 'sse' transport. Attempting to connect a 'stdio' server
 * will throw — stdio requires a Node.js process spawner.
 */
export class BrowserMcpClientFactory implements McpClientFactory {
  async createClient(config: McpServerConfig): Promise<McpConnection> {
    if (config.transport === 'stdio') {
      throw new Error(
        `MCP server '${config.name}' uses stdio transport, which is not supported in the browser. ` +
          'Use SSE transport instead, or run in the desktop app for stdio support.',
      );
    }

    if (!config.url) {
      throw new Error(`MCP server '${config.name}' requires a url for SSE transport.`);
    }

    const client = new Client(
      { name: `aics-browser-${config.name}`, version: '0.1.0' },
      { capabilities: {} },
    );

    const transport = new SSEClientTransport(new URL(config.url));
    await client.connect(transport);

    // List tools from the server
    const toolsResult = await client.listTools();
    const tools: McpToolDef[] = (toolsResult.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
    }));

    return {
      config,
      tools,
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        const result = await client.callTool({ name, arguments: args });
        return result;
      },
      async close(): Promise<void> {
        await client.close();
      },
    };
  }
}

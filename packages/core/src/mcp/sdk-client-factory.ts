import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpClientFactory, McpConnection, McpServerConfig, McpToolDef } from './types.js';

/**
 * Default McpClientFactory that uses @modelcontextprotocol/sdk to create
 * real MCP connections. Used in production; tests use a mock factory instead.
 */
export class SdkClientFactory implements McpClientFactory {
  async createClient(config: McpServerConfig): Promise<McpConnection> {
    const client = new Client(
      { name: `offisim-${config.name}`, version: '0.1.0' },
      { capabilities: {} },
    );

    let transport: StdioClientTransport | SSEClientTransport;

    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error(`MCP server '${config.name}' requires a command for stdio transport.`);
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env as Record<string, string> | undefined,
      });
    } else {
      if (!config.url) {
        throw new Error(`MCP server '${config.name}' requires a url for SSE transport.`);
      }
      transport = new SSEClientTransport(new URL(config.url));
    }

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

/**
 * SSE MCP client factory.
 *
 * Only supports SSE transport (no stdio — that needs child_process / Node.js).
 * Uses @modelcontextprotocol/sdk's SSEClientTransport.
 *
 * Tauri desktop uses this only as the SSE transport fallback; stdio goes through IPC.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type {
  McpClientFactory,
  McpConnection,
  McpOperationOptions,
  McpPromptDef,
  McpResourceDef,
  McpServerConfig,
  McpToolDef,
} from '@offisim/core/browser';

/**
 * McpClientFactory implementation for SSE transports.
 *
 * Only supports 'sse' transport. Attempting to connect a 'stdio' server
 * will throw — stdio requires a Node.js process spawner.
 */
export class SseMcpClientFactory implements McpClientFactory {
  async createClient(config: McpServerConfig): Promise<McpConnection> {
    if (config.transport === 'stdio') {
      throw new Error(
        `MCP server '${config.name}' uses stdio transport, which is handled by the Tauri MCP bridge. Use TauriMcpClientFactory for stdio servers.`,
      );
    }

    if (!config.url) {
      throw new Error(`MCP server '${config.name}' requires a url for SSE transport.`);
    }

    const client = new Client(
      { name: `offisim-sse-${config.name}`, version: '0.1.0' },
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
      ...(t.annotations ? { annotations: { readOnlyHint: t.annotations.readOnlyHint } } : {}),
    }));
    const capabilities = client.getServerCapabilities();

    return {
      config,
      tools,
      capabilities: {
        tools: Boolean(capabilities?.tools),
        resources: Boolean(capabilities?.resources),
        prompts: Boolean(capabilities?.prompts),
        listChanged: Boolean(
          capabilities?.tools?.listChanged ||
            capabilities?.resources?.listChanged ||
            capabilities?.prompts?.listChanged,
        ),
      },
      async listTools(): Promise<ReadonlyArray<McpToolDef>> {
        const next = await client.listTools();
        return (next.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema,
          ...(t.annotations ? { annotations: { readOnlyHint: t.annotations.readOnlyHint } } : {}),
        }));
      },
      async listResources(): Promise<ReadonlyArray<McpResourceDef>> {
        if (!capabilities?.resources) return [];
        const next = await client.listResources();
        return (next.resources ?? []).map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
        }));
      },
      async listPrompts(): Promise<ReadonlyArray<McpPromptDef>> {
        if (!capabilities?.prompts) return [];
        const next = await client.listPrompts();
        return (next.prompts ?? []).map((prompt) => ({
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
        }));
      },
      async callTool(
        name: string,
        args: Record<string, unknown>,
        options?: McpOperationOptions,
      ): Promise<unknown> {
        const result = await client.callTool({ name, arguments: args }, undefined, {
          signal: options?.signal,
        });
        return result;
      },
      async close(): Promise<void> {
        await client.close();
      },
    };
  }
}

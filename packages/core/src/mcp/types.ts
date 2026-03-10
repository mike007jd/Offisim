/**
 * MCP (Model Context Protocol) server configuration and connection types.
 *
 * McpServerConfig describes how to connect to an MCP server.
 * McpConnection represents a live connection with its available tools.
 * McpClientFactory allows dependency injection for testing.
 */

export interface McpServerConfig {
  readonly name: string;
  readonly transport: 'stdio' | 'sse';
  /** Command to execute for stdio transport */
  readonly command?: string;
  /** Arguments for the stdio command */
  readonly args?: string[];
  /** URL for SSE transport */
  readonly url?: string;
  /** Environment variables for stdio process */
  readonly env?: Record<string, string>;
}

export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface McpConnection {
  readonly config: McpServerConfig;
  readonly tools: ReadonlyArray<McpToolDef>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Factory interface for creating MCP client connections.
 * The default implementation uses @modelcontextprotocol/sdk.
 * Tests inject a mock factory.
 */
export interface McpClientFactory {
  createClient(config: McpServerConfig): Promise<McpConnection>;
}

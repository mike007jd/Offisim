import type { EventBus } from '../events/event-bus.js';
import { mcpServerConnected, mcpToolCalled } from '../events/event-factories.js';
import type { ToolDef } from '../llm/gateway.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import type { McpClientFactory, McpConnection, McpServerConfig } from './types.js';

interface McpToolExecutorDeps {
  readonly eventBus: EventBus;
  readonly companyId: string;
  readonly clientFactory: McpClientFactory;
}

/**
 * ToolExecutor implementation backed by MCP server connections.
 *
 * Each connected MCP server exposes a set of tools. When execute() is called,
 * the executor finds which server owns the requested tool and dispatches
 * the call through the MCP protocol.
 */
export class McpToolExecutor implements ToolExecutor {
  private readonly servers = new Map<string, McpConnection>();
  private readonly eventBus: EventBus;
  private readonly companyId: string;
  private readonly clientFactory: McpClientFactory;

  /** Reverse lookup: tool name → server name */
  private readonly toolServerMap = new Map<string, string>();

  constructor(deps: McpToolExecutorDeps) {
    this.eventBus = deps.eventBus;
    this.companyId = deps.companyId;
    this.clientFactory = deps.clientFactory;
  }

  /**
   * Connect to an MCP server, list its tools, and register them.
   * Emits mcpServerConnected event on success.
   */
  async addServer(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      await this.removeServer(config.name);
    }

    const connection = await this.clientFactory.createClient(config);

    // Register the connection
    this.servers.set(config.name, connection);

    // Build tool → server reverse index
    for (const tool of connection.tools) {
      this.toolServerMap.set(tool.name, config.name);
    }

    this.eventBus.emit(mcpServerConnected(this.companyId, config.name, connection.tools.length));
  }

  /**
   * Disconnect and remove an MCP server by name.
   */
  async removeServer(name: string): Promise<void> {
    const connection = this.servers.get(name);
    if (!connection) return;

    // Remove tool → server mappings for this server
    for (const tool of connection.tools) {
      if (this.toolServerMap.get(tool.name) === name) {
        this.toolServerMap.delete(tool.name);
      }
    }

    await connection.close();
    this.servers.delete(name);
  }

  /**
   * Execute a tool call by dispatching to the correct MCP server.
   * Emits mcpToolCalled event on success.
   */
  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const serverName = this.toolServerMap.get(call.name);

    if (!serverName) {
      return {
        success: false,
        result: null,
        error: `Unknown tool: ${call.name}. No connected MCP server provides this tool.`,
      };
    }

    const connection = this.servers.get(serverName);
    if (!connection) {
      return {
        success: false,
        result: null,
        error: `MCP server '${serverName}' is no longer connected.`,
      };
    }

    try {
      const result = await connection.callTool(call.name, call.arguments);

      this.eventBus.emit(
        mcpToolCalled(this.companyId, serverName, call.name, call.employeeId ?? '', undefined),
      );

      return { success: true, result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        result: null,
        error: `MCP tool '${call.name}' failed: ${errorMsg}`,
      };
    }
  }

  /**
   * Collect tools from all connected MCP servers as ToolDef[].
   */
  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    const tools: ToolDef[] = [];

    for (const connection of this.servers.values()) {
      for (const tool of connection.tools) {
        tools.push({
          name: tool.name,
          description: tool.description,
          parameters: (tool.inputSchema as Record<string, unknown>) ?? {},
        });
      }
    }

    return tools;
  }

  /**
   * Close all MCP server connections and clean up.
   */
  async dispose(): Promise<void> {
    const closePromises: Promise<void>[] = [];
    for (const connection of this.servers.values()) {
      closePromises.push(connection.close());
    }
    await Promise.all(closePromises);
    this.servers.clear();
    this.toolServerMap.clear();
  }

  /** Look up which server owns a given tool. Used by AuditingToolExecutor. */
  getServerForTool(toolName: string): string | undefined {
    return this.toolServerMap.get(toolName);
  }

  /** Get the number of connected servers (useful for testing). */
  get serverCount(): number {
    return this.servers.size;
  }

  /** Get the names of all currently connected servers. */
  getConnectedServerNames(): string[] {
    return [...this.servers.keys()];
  }
}

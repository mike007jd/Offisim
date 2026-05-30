import type { EventBus } from '../events/event-bus.js';
import { mcpServerConnected, mcpToolCalled } from '../events/event-factories.js';
import type { ToolDef } from '../llm/gateway.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import type {
  McpClientFactory,
  McpConnection,
  McpPromptDef,
  McpResourceDef,
  McpServerCapabilities,
  McpServerConfig,
  McpToolDef,
} from './types.js';

interface McpToolExecutorDeps {
  readonly eventBus: EventBus;
  readonly companyId: string;
  readonly clientFactory: McpClientFactory;
}

/**
 * MCP `CallToolResult` carries a `isError: true` flag for tool-level failures
 * (the tool ran but reported a domain error) — distinct from a thrown
 * protocol/transport error. Reporting these as success hides failures from the
 * model and from audit/telemetry, so they must surface as `success: false`.
 */
function isMcpToolError(result: unknown): boolean {
  return (
    !!result && typeof result === 'object' && (result as { isError?: unknown }).isError === true
  );
}

/** Flatten the text blocks of a CallToolResult `content` array for an error message. */
function flattenMcpTextContent(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join('\n');
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
  private readonly toolsByServer = new Map<string, ReadonlyArray<McpToolDef>>();
  private readonly resourcesByServer = new Map<string, ReadonlyArray<McpResourceDef>>();
  private readonly promptsByServer = new Map<string, ReadonlyArray<McpPromptDef>>();
  private readonly capabilitiesByServer = new Map<string, McpServerCapabilities>();
  /**
   * Per-server `trustedAnnotations` flag. Default false. Used by the auditing
   * executor to decide whether MCP-server-supplied `readOnlyHint` can short
   * the permission ask, per MCP 2025-03-26 spec.
   */
  private readonly trustedAnnotationsByServer = new Map<string, boolean>();
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
    this.trustedAnnotationsByServer.set(config.name, config.trustedAnnotations === true);
    await this.refreshConnectionCatalog(config.name, connection);

    this.eventBus.emit(
      mcpServerConnected(
        this.companyId,
        config.name,
        this.toolsByServer.get(config.name)?.length ?? 0,
      ),
    );
  }

  /**
   * Disconnect and remove an MCP server by name.
   */
  async removeServer(name: string): Promise<void> {
    const connection = this.servers.get(name);
    if (!connection) return;

    // Remove tool → server mappings for this server
    for (const tool of this.toolsByServer.get(name) ?? []) {
      if (this.toolServerMap.get(tool.name) === name) {
        this.toolServerMap.delete(tool.name);
      }
    }

    await connection.close();
    this.servers.delete(name);
    this.toolsByServer.delete(name);
    this.resourcesByServer.delete(name);
    this.promptsByServer.delete(name);
    this.capabilitiesByServer.delete(name);
    this.trustedAnnotationsByServer.delete(name);
  }

  /**
   * Execute a tool call by dispatching to the correct MCP server.
   * Emits mcpToolCalled event on success.
   */
  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    if (call.signal?.aborted) {
      return {
        success: false,
        result: null,
        error: `MCP tool '${call.name}' cancelled before request was sent.`,
      };
    }

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
      const result = await connection.callTool(call.name, call.arguments, {
        signal: call.signal,
      });

      // Tool-level error (isError: true) is a failure, not a success — do not
      // emit the success event; surface it so the model / audit see the truth.
      if (isMcpToolError(result)) {
        const errorText =
          flattenMcpTextContent(result) || `MCP tool '${call.name}' reported a tool-level error.`;
        return { success: false, result, error: errorText };
      }

      this.eventBus.emit(
        mcpToolCalled(this.companyId, serverName, call.name, call.employeeId ?? '', undefined),
      );

      return { success: true, result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (isAbortLikeError(err, call.signal)) {
        return {
          success: false,
          result: null,
          error: `MCP tool '${call.name}' cancelled: ${errorMsg}`,
        };
      }
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

    for (const serverTools of this.toolsByServer.values()) {
      for (const tool of serverTools) {
        tools.push({
          name: tool.name,
          description: tool.description,
          parameters: (tool.inputSchema as Record<string, unknown>) ?? {},
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
        });
      }
    }

    return tools;
  }

  async listResources(serverName?: string): Promise<McpResourceDef[]> {
    const entries = serverName
      ? [this.resourcesByServer.get(serverName) ?? []]
      : [...this.resourcesByServer.values()];
    return entries.flatMap((resources) => [...resources]);
  }

  async listPrompts(serverName?: string): Promise<McpPromptDef[]> {
    const entries = serverName
      ? [this.promptsByServer.get(serverName) ?? []]
      : [...this.promptsByServer.values()];
    return entries.flatMap((prompts) => [...prompts]);
  }

  getServerCapabilities(serverName: string): McpServerCapabilities | null {
    return this.capabilitiesByServer.get(serverName) ?? null;
  }

  async refreshServer(name: string): Promise<void> {
    const connection = this.servers.get(name);
    if (!connection) {
      throw new Error(`MCP server '${name}' is not connected.`);
    }
    await this.refreshConnectionCatalog(name, connection);
  }

  async handleListChanged(name: string): Promise<void> {
    await this.refreshServer(name);
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
    this.toolsByServer.clear();
    this.resourcesByServer.clear();
    this.promptsByServer.clear();
    this.capabilitiesByServer.clear();
    this.toolServerMap.clear();
    this.trustedAnnotationsByServer.clear();
  }

  /** Look up which server owns a given tool. Used by AuditingToolExecutor. */
  getServerForTool(toolName: string): string | undefined {
    return this.toolServerMap.get(toolName);
  }

  /**
   * Whether the named server's tool annotations may be trusted to auto-approve
   * read-only calls. Defaults to `false` for unknown servers — that's the
   * MCP-spec-correct posture: untrusted unless explicitly trusted.
   */
  isServerTrustedForAnnotations(serverName: string): boolean {
    return this.trustedAnnotationsByServer.get(serverName) === true;
  }

  /** Get the number of connected servers (useful for testing). */
  get serverCount(): number {
    return this.servers.size;
  }

  /** Get the names of all currently connected servers. */
  getConnectedServerNames(): string[] {
    return [...this.servers.keys()];
  }

  private async refreshConnectionCatalog(
    serverName: string,
    connection: McpConnection,
  ): Promise<void> {
    for (const tool of this.toolsByServer.get(serverName) ?? []) {
      if (this.toolServerMap.get(tool.name) === serverName) {
        this.toolServerMap.delete(tool.name);
      }
    }

    const allTools = connection.listTools ? await connection.listTools() : connection.tools;
    // Enforce the configured tool allowlist (if any) so the documented
    // `toolAllowPatterns` field actually filters which tools are registered /
    // exposed to the model — previously it was parsed but ignored.
    const allowPatterns = connection.config.toolAllowPatterns;
    const tools =
      allowPatterns && allowPatterns.length > 0
        ? allTools.filter((tool) => matchesAnyGlob(tool.name, allowPatterns))
        : allTools;
    const resources = connection.listResources
      ? await connection.listResources()
      : (connection.resources ?? []);
    const prompts = connection.listPrompts
      ? await connection.listPrompts()
      : (connection.prompts ?? []);

    this.toolsByServer.set(serverName, [...tools]);
    this.resourcesByServer.set(serverName, [...resources]);
    this.promptsByServer.set(serverName, [...prompts]);
    this.capabilitiesByServer.set(serverName, {
      tools: connection.capabilities?.tools ?? tools.length > 0,
      resources: connection.capabilities?.resources ?? resources.length > 0,
      prompts: connection.capabilities?.prompts ?? prompts.length > 0,
      listChanged: connection.capabilities?.listChanged ?? false,
    });

    for (const tool of tools) {
      this.toolServerMap.set(tool.name, serverName);
    }
  }
}

function isAbortLikeError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\babort(?:ed)?|cancelled\b/i.test(message);
}

/** Translate a simple shell-style glob (`*` any run, `?` single char) to a RegExp. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
  const body = escaped.replace(/\*/gu, '.*').replace(/\?/gu, '.');
  return new RegExp(`^${body}$`, 'u');
}

/** Whether `name` matches at least one of the provided globs. */
function matchesAnyGlob(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(name));
}

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
  /**
   * When `true`, this server's tool annotations (e.g. `readOnlyHint`) may be
   * trusted to auto-approve calls without user prompting. Defaults to `false`
   * per MCP 2025-03-26 spec, which requires treating annotations as untrusted
   * unless the server itself is trusted. Settings UI surfaces this as a
   * per-server checkbox; only flip it on for official / known-good servers.
   */
  readonly trustedAnnotations?: boolean;
  /** Rust-side registered server identifier for desktop stdio servers */
  readonly registeredServerId?: string;
  /** Rust-side approval id required before desktop stdio startup */
  readonly approvalId?: string;
  /** Fingerprint of canonical command + args + trusted source */
  readonly commandFingerprint?: string;
  /** Optional project scope for desktop stdio startup */
  readonly projectId?: string;
  /** Trusted stdio source class for desktop command policy */
  readonly source?: 'user-config' | 'installed-asset' | 'developer-runtime';
  readonly sourcePackageId?: string;
  readonly sourcePackageVersion?: string;
  readonly sourceManifestHash?: string;
  readonly requestSurface?: 'settings' | 'installed-asset-runtime' | 'developer-runtime';
  /** Command to execute for stdio transport */
  readonly command?: string;
  /** Arguments for the stdio command */
  readonly args?: string[];
  /** URL for SSE transport */
  readonly url?: string;
  /** Environment variables for stdio process */
  readonly env?: Record<string, string>;
  /**
   * Optional glob allowlist for this server's tools (e.g. `["read_*", "list_*"]`).
   * When present and non-empty, only tools whose name matches at least one
   * pattern are registered/exposed — useful for large MCP servers. Absent or
   * empty means "expose all tools". Enforced in McpToolExecutor at catalog
   * refresh time. Supports `*` (any run) and `?` (single char).
   */
  readonly toolAllowPatterns?: string[];
}

export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
  };
}

export interface McpResourceDef {
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptDef {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

export interface McpServerCapabilities {
  readonly tools?: boolean;
  readonly resources?: boolean;
  readonly prompts?: boolean;
  readonly listChanged?: boolean;
}

export interface McpOperationOptions {
  readonly signal?: AbortSignal;
}

export interface McpConnection {
  readonly config: McpServerConfig;
  readonly tools: ReadonlyArray<McpToolDef>;
  readonly resources?: ReadonlyArray<McpResourceDef>;
  readonly prompts?: ReadonlyArray<McpPromptDef>;
  readonly capabilities?: McpServerCapabilities;
  listTools?(): Promise<ReadonlyArray<McpToolDef>>;
  listResources?(): Promise<ReadonlyArray<McpResourceDef>>;
  listPrompts?(): Promise<ReadonlyArray<McpPromptDef>>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: McpOperationOptions,
  ): Promise<unknown>;
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

/** Employee-level MCP approval policy. Runtime policy remains the absolute guardrail. */
export type ToolApprovalMode = 'auto' | 'ask_first_time' | 'always_ask' | 'deny';

export interface ToolPermissionPolicy {
  readonly defaultMode: ToolApprovalMode;
  readonly overrides: ReadonlyArray<{
    readonly pattern: string;
    readonly mode: ToolApprovalMode;
  }>;
}

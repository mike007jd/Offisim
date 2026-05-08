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
}

export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
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

/** P1: auto-approve all. P2 adds ask_first_time and always_ask enforcement. */
export type ToolApprovalMode = 'auto' | 'ask_first_time' | 'always_ask';

export interface ToolPermissionPolicy {
  readonly defaultMode: ToolApprovalMode;
  readonly overrides: ReadonlyArray<{
    readonly pattern: string;
    readonly mode: ToolApprovalMode;
  }>;
}

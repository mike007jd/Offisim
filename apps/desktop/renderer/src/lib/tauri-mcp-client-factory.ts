import type {
  McpClientFactory,
  McpConnection,
  McpServerConfig,
  McpToolDef,
} from '@offisim/core/mcp';

/** Rust `McpToolInfo` (serialized as-is — snake_case `input_schema`). */
interface McpToolInfoRaw {
  name: string;
  description: string;
  input_schema: unknown;
}

/** Rust `McpSpawnResult` (serialized as-is — snake_case `server_name`). */
interface McpSpawnResultRaw {
  server_name: string;
  tools: McpToolInfoRaw[];
  state: string;
}

/**
 * `McpClientFactory` backed by the desktop Tauri MCP bridge
 * (`apps/desktop/src-tauri/src/mcp_bridge`). stdio-only: the Rust side spawns
 * the registered child process, lists its tools, and proxies tool calls; SSE
 * servers are rejected (they connect directly from the web runtime).
 *
 * The connect / call / kill commands re-verify the approval id + command
 * fingerprint against the registration on every hop, so this factory threads
 * the identity carried on the `McpServerConfig` (built by `tauri-mcp-config`).
 */
export function createTauriMcpClientFactory(): McpClientFactory {
  return {
    async createClient(config: McpServerConfig): Promise<McpConnection> {
      if (config.transport !== 'stdio') {
        throw new Error(
          `Desktop MCP bridge supports stdio servers only; "${config.name}" is ${config.transport}.`,
        );
      }
      const { registeredServerId, approvalId, commandFingerprint } = config;
      if (!registeredServerId || !approvalId || !commandFingerprint) {
        throw new Error(
          `MCP server "${config.name}" is missing its registration identity (serverId/approval/fingerprint).`,
        );
      }
      const projectId = config.projectId ?? null;
      const sourcePackageId = config.sourcePackageId ?? null;
      const sourcePackageVersion = config.sourcePackageVersion ?? null;
      const sourceManifestHash = config.sourceManifestHash ?? null;

      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<McpSpawnResultRaw>('mcp_connect_registered', {
        request: {
          serverId: registeredServerId,
          approvalId,
          commandFingerprint,
          projectId,
          requestSurface: config.requestSurface ?? 'settings',
          sourcePackageId,
          sourcePackageVersion,
          sourceManifestHash,
        },
      });

      const tools: McpToolDef[] = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      }));
      // The Rust process registry keys by the registered server NAME, so tool
      // calls and kill target `config.name` (not the serverId).
      const serverName = config.name;

      return {
        config,
        tools,
        async callTool(name, args) {
          return invoke('mcp_call_tool', {
            request: {
              server: serverName,
              tool: name,
              args,
              approvalId,
              commandFingerprint,
              projectId,
              sourcePackageId,
              sourcePackageVersion,
              sourceManifestHash,
            },
          });
        },
        async close() {
          await invoke('mcp_kill', { server: serverName });
        },
      };
    },
  };
}

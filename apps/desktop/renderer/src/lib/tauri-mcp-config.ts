import type { McpServerConfig } from '@offisim/core/mcp';

/**
 * Shape of `mcp_list_registered_servers` rows (Rust `RegisteredMcpServerSummary`,
 * serialized camelCase). MCP servers are registered app-globally through
 * Settings; there is no per-company binding, so "available to a chat" == "a
 * registered stdio server with a startup approval + command fingerprint".
 */
interface RegisteredMcpServerSummary {
  serverId: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string | null;
  args?: string[];
  url?: string | null;
  source?: string | null;
  sourcePackageId?: string | null;
  sourcePackageVersion?: string | null;
  sourceManifestHash?: string | null;
  requestSurface?: string | null;
  approvalId?: string | null;
  commandFingerprint?: string | null;
}

type McpSource = NonNullable<McpServerConfig['source']>;
type McpRequestSurface = NonNullable<McpServerConfig['requestSurface']>;

/**
 * The Rust bridge enforces that a server's `source` class matches the
 * `requestSurface` the startup originates from. Map them so
 * `mcp_connect_registered` does not reject the connect.
 */
function requestSurfaceForSource(source: McpSource): McpRequestSurface {
  switch (source) {
    case 'installed-asset':
      return 'installed-asset-runtime';
    case 'developer-runtime':
      return 'developer-runtime';
    default:
      return 'settings';
  }
}

function normalizeSource(source: string | null | undefined): McpSource {
  if (source === 'installed-asset' || source === 'developer-runtime') return source;
  return 'user-config';
}

/**
 * Read every registered **stdio** MCP server and project it onto the core
 * `McpServerConfig` the McpToolExecutor consumes. SSE servers are skipped —
 * the desktop bridge spawns stdio child processes only (SSE connects from the
 * web runtime). Servers missing a command / approval / fingerprint are skipped
 * because the Rust bridge would reject the connect anyway.
 */
export async function loadRegisteredStdioMcpConfigs(): Promise<McpServerConfig[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const registered = await invoke<RegisteredMcpServerSummary[]>('mcp_list_registered_servers');
  const configs: McpServerConfig[] = [];
  for (const server of registered) {
    if (server.transport !== 'stdio') continue;
    if (!server.command || !server.approvalId || !server.commandFingerprint) continue;
    const source = normalizeSource(server.source);
    configs.push({
      name: server.name,
      transport: 'stdio',
      command: server.command,
      args: server.args ?? [],
      registeredServerId: server.serverId,
      approvalId: server.approvalId,
      commandFingerprint: server.commandFingerprint,
      source,
      requestSurface: requestSurfaceForSource(source),
      ...(server.sourcePackageId ? { sourcePackageId: server.sourcePackageId } : {}),
      ...(server.sourcePackageVersion ? { sourcePackageVersion: server.sourcePackageVersion } : {}),
      ...(server.sourceManifestHash ? { sourceManifestHash: server.sourceManifestHash } : {}),
      trustedAnnotations: false,
    });
  }
  return configs;
}

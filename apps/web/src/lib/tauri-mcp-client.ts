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
 * MCP client factory for Tauri desktop environment.
 *
 * stdio transport — delegates to Rust mcp_bridge via Tauri IPC.
 * SSE transport  — delegates to BrowserMcpClientFactory (composition).
 */
import { invoke } from '@tauri-apps/api/core';
import { BrowserMcpClientFactory } from './browser-mcp-client';

interface McpSpawnResult {
  server_name: string;
  tools: Array<{ name: string; description: string; input_schema: unknown }>;
  state: string;
}

type DesktopMcpServerConfig = McpServerConfig & {
  readonly registeredServerId?: string;
  readonly approvalId?: string;
  readonly commandFingerprint?: string;
  readonly projectId?: string;
  readonly source?: string;
  readonly sourcePackageId?: string;
  readonly sourcePackageVersion?: string;
  readonly sourceManifestHash?: string;
  readonly requestSurface?: string;
};

export class TauriMcpClientFactory implements McpClientFactory {
  private readonly sseFallback = new BrowserMcpClientFactory();

  async createClient(config: McpServerConfig): Promise<McpConnection> {
    const desktopConfig = config as DesktopMcpServerConfig;
    if (config.transport === 'sse') {
      return this.sseFallback.createClient(config);
    }

    if (!desktopConfig.registeredServerId) {
      throw new Error(`MCP server '${config.name}' uses stdio but has no registered server id.`);
    }
    if (!desktopConfig.approvalId || !desktopConfig.commandFingerprint) {
      throw new Error(`MCP server '${config.name}' is missing approval metadata.`);
    }

    const result = await invoke<McpSpawnResult>('mcp_connect_registered', {
      request: {
        serverId: desktopConfig.registeredServerId,
        approvalId: desktopConfig.approvalId,
        commandFingerprint: desktopConfig.commandFingerprint,
        requestSurface: desktopConfig.requestSurface ?? 'settings',
        ...(desktopConfig.projectId ? { projectId: desktopConfig.projectId } : {}),
        ...(desktopConfig.sourcePackageId
          ? { sourcePackageId: desktopConfig.sourcePackageId }
          : {}),
        ...(desktopConfig.sourcePackageVersion
          ? { sourcePackageVersion: desktopConfig.sourcePackageVersion }
          : {}),
        ...(desktopConfig.sourceManifestHash
          ? { sourceManifestHash: desktopConfig.sourceManifestHash }
          : {}),
      },
    });

    const tools: McpToolDef[] = result.tools.map((t) => {
      const annotations = (t as { annotations?: { readOnlyHint?: boolean } }).annotations;
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
        ...(annotations ? { annotations: { readOnlyHint: annotations.readOnlyHint } } : {}),
      };
    });

    return {
      config,
      tools,
      capabilities: { tools: true, resources: false, prompts: false, listChanged: false },
      async listTools(): Promise<ReadonlyArray<McpToolDef>> {
        return tools;
      },
      async listResources(): Promise<ReadonlyArray<McpResourceDef>> {
        return [];
      },
      async listPrompts(): Promise<ReadonlyArray<McpPromptDef>> {
        return [];
      },
      async callTool(
        name: string,
        args: Record<string, unknown>,
        options?: McpOperationOptions,
      ): Promise<unknown> {
        if (options?.signal?.aborted) {
          throw new DOMException('MCP tool call aborted before desktop IPC.', 'AbortError');
        }
        return invoke('mcp_call_tool', {
          request: {
            server: config.name,
            tool: name,
            args,
            approvalId: desktopConfig.approvalId,
            commandFingerprint: desktopConfig.commandFingerprint,
            ...(desktopConfig.projectId ? { projectId: desktopConfig.projectId } : {}),
            ...(desktopConfig.sourcePackageId
              ? { sourcePackageId: desktopConfig.sourcePackageId }
              : {}),
            ...(desktopConfig.sourcePackageVersion
              ? { sourcePackageVersion: desktopConfig.sourcePackageVersion }
              : {}),
            ...(desktopConfig.sourceManifestHash
              ? { sourceManifestHash: desktopConfig.sourceManifestHash }
              : {}),
          },
        });
      },
      async close(): Promise<void> {
        await invoke('mcp_kill', { server: config.name });
      },
    };
  }
}

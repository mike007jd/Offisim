import { isTauri } from '@offisim/ui-office/web';

export interface DesktopMcpServerRecord {
  serverId: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args: string[];
  url?: string;
  source?: string;
  sourcePackageId?: string;
  sourcePackageVersion?: string;
  sourceManifestHash?: string;
  requestSurface?: string;
  approvalId?: string;
  riskClass?: string;
  commandFingerprint?: string;
  requestedTools?: string[];
}

type DesktopInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriCore = (await import('@tauri-apps/api/core')) as {
    invoke: DesktopInvoke;
  };
  const { invoke } = tauriCore;
  return invoke<T>(command, args);
}

export async function listDesktopMcpServers(): Promise<DesktopMcpServerRecord[]> {
  if (!isTauri()) return [];
  try {
    return await invokeDesktop<DesktopMcpServerRecord[]>('mcp_list_registered_servers');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not allowed by ACL')) {
      console.warn(
        '[Offisim] Desktop MCP registry unavailable in this build; skipping auto-connect.',
      );
      return [];
    }
    throw err;
  }
}

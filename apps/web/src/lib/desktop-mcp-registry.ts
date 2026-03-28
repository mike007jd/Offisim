import { isTauri } from '@offisim/ui-office';

export interface DesktopMcpServerRecord {
  serverId: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args: string[];
  url?: string;
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriCoreModule = '@tauri-apps' + '/api/core';
  const { invoke } =
    (await import(/* @vite-ignore */ tauriCoreModule)) as typeof import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function listDesktopMcpServers(): Promise<DesktopMcpServerRecord[]> {
  if (!isTauri()) return [];
  return invokeDesktop<DesktopMcpServerRecord[]>('plugin:mcp_bridge|mcp_list_registered_servers');
}

import { isTauri } from '@offisim/ui-office/web';

export interface DesktopMcpServerRecord {
  serverId: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args: string[];
  url?: string;
}

type DesktopInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriCoreModule = '@tauri-apps' + '/api/core';
  const tauriCore = (await import(/* @vite-ignore */ tauriCoreModule)) as {
    invoke: DesktopInvoke;
  };
  const { invoke } = tauriCore;
  return invoke<T>(command, args);
}

export async function listDesktopMcpServers(): Promise<DesktopMcpServerRecord[]> {
  if (!isTauri()) return [];
  return invokeDesktop<DesktopMcpServerRecord[]>('plugin:mcp_bridge|mcp_list_registered_servers');
}

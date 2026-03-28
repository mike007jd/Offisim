import { isTauri } from './env';

export interface DesktopMcpServerRecord {
  serverId: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args: string[];
  url?: string;
}

export interface RegisterDesktopMcpServerInput {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
}

export interface BrowserMcpServerRecord {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
}

interface StoredBrowserMcpServerRecord {
  name?: unknown;
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  url?: unknown;
  commandOrUrl?: unknown;
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

export async function registerDesktopMcpServer(
  input: RegisterDesktopMcpServerInput,
): Promise<DesktopMcpServerRecord> {
  return invokeDesktop<DesktopMcpServerRecord>('plugin:mcp_bridge|mcp_register_server', { input });
}

export async function unregisterDesktopMcpServer(serverId: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDesktop('plugin:mcp_bridge|mcp_unregister_server', { serverId });
}

export function loadStoredBrowserMcpServers(
  storage: Pick<Storage, 'getItem'> = localStorage,
): BrowserMcpServerRecord[] {
  try {
    const raw = storage.getItem('offisim:mcp-servers');
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry) => {
      const record = entry as StoredBrowserMcpServerRecord;
      if (typeof record.name !== 'string') return [];
      if (record.transport !== 'stdio' && record.transport !== 'sse') return [];

      const legacyValue =
        typeof record.commandOrUrl === 'string' ? record.commandOrUrl.trim() : undefined;
      const command = typeof record.command === 'string' ? record.command.trim() : undefined;
      const url = typeof record.url === 'string' ? record.url.trim() : undefined;
      const args = Array.isArray(record.args)
        ? record.args.filter((arg): arg is string => typeof arg === 'string')
        : undefined;

      return [
        {
          name: record.name,
          transport: record.transport,
          command: record.transport === 'stdio' ? (command ?? legacyValue) : undefined,
          args: record.transport === 'stdio' ? args : undefined,
          url: record.transport === 'sse' ? (url ?? legacyValue) : undefined,
        } satisfies BrowserMcpServerRecord,
      ];
    });
  } catch {
    return [];
  }
}

import type { McpServerConfig as CoreMcpServerConfig } from '@offisim/core/browser';
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listDesktopMcpServers,
  loadStoredBrowserMcpServers,
  registerDesktopMcpServer,
  unregisterDesktopMcpServer,
} from '../../lib/desktop-mcp-registry';
import { isTauri } from '../../lib/env';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { SettingsSection } from './settings-primitives';

type DesktopCoreMcpServerConfig = CoreMcpServerConfig & {
  registeredServerId?: string;
};

export type McpTransport = 'stdio' | 'sse';

export interface McpServerConfig {
  serverId?: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
}

const STORAGE_KEY = 'offisim:mcp-servers';

function loadMcpServers(): McpServerConfig[] {
  return loadStoredBrowserMcpServers().map((server) => ({
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
  }));
}

function saveMcpServers(servers: McpServerConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

function parseArgs(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function toCoreConfig(cfg: McpServerConfig): CoreMcpServerConfig {
  return {
    name: cfg.name,
    transport: cfg.transport,
    registeredServerId: cfg.serverId,
    url: cfg.transport === 'sse' ? cfg.url : undefined,
    command: cfg.transport === 'stdio' ? cfg.command : undefined,
    args: cfg.transport === 'stdio' ? cfg.args : undefined,
  } as DesktopCoreMcpServerConfig;
}

function serverKey(server: McpServerConfig): string {
  return server.serverId ?? `local:${server.name}`;
}

export function McpConfigPanel() {
  const { connectMcpServer, disconnectMcpServer, connectedMcpServers, isReady } =
    useOffisimRuntime();
  const [servers, setServers] = useState<McpServerConfig[]>(loadMcpServers);
  const [connecting, setConnecting] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransport>('sse');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!isTauri()) saveMcpServers(servers);
  }, [servers]);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    void listDesktopMcpServers()
      .then((records) => {
        if (cancelled) return;
        setServers(
          records.map((record) => ({
            serverId: record.serverId,
            name: record.name,
            transport: record.transport,
            command: record.command,
            args: record.args,
            url: record.url,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setFormError('Failed to load desktop MCP registry.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleAdd = useCallback(async () => {
    setFormError('');
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    const trimmedUrl = url.trim();
    const args = parseArgs(argsText);

    if (!trimmedName) {
      setFormError('Server name is required.');
      return;
    }
    if (transport === 'stdio' && !trimmedCommand) {
      setFormError('Command is required.');
      return;
    }
    if (transport === 'sse' && !trimmedUrl) {
      setFormError('URL is required.');
      return;
    }
    if (servers.some((s) => s.name === trimmedName)) {
      setFormError(`A server named "${trimmedName}" already exists.`);
      return;
    }

    let newConfig: McpServerConfig;
    if (isTauri()) {
      const record = await registerDesktopMcpServer({
        name: trimmedName,
        transport,
        ...(transport === 'stdio' ? { command: trimmedCommand, args } : { url: trimmedUrl }),
      });
      newConfig = {
        serverId: record.serverId,
        name: record.name,
        transport: record.transport,
        command: record.command,
        args: record.args,
        url: record.url,
      };
    } else {
      newConfig = {
        name: trimmedName,
        transport,
        ...(transport === 'stdio' ? { command: trimmedCommand, args } : { url: trimmedUrl }),
      };
    }

    setServers((prev) => [...prev, newConfig]);

    if (isReady) {
      setConnecting(trimmedName);
      try {
        await connectMcpServer(toCoreConfig(newConfig));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFormError(`Saved, but connection failed: ${msg}`);
      } finally {
        setConnecting(null);
      }
    }

    setName('');
    setCommand('');
    setArgsText('');
    setUrl('');
  }, [name, transport, command, url, argsText, servers, isReady, connectMcpServer]);

  const handleRemove = useCallback(
    async (server: McpServerConfig) => {
      setServers((prev) => prev.filter((s) => s.name !== server.name));
      try {
        await disconnectMcpServer(server.name);
      } catch {
        // Ignore — server might not be connected
      }
      if (isTauri() && server.serverId) {
        await unregisterDesktopMcpServer(server.serverId);
      }
    },
    [disconnectMcpServer],
  );

  const handleReconnect = useCallback(
    async (server: McpServerConfig) => {
      if (!isReady) return;
      setConnecting(server.name);
      setFormError('');
      try {
        await connectMcpServer(toCoreConfig(server));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setFormError(`Failed to connect '${server.name}': ${msg}`);
      } finally {
        setConnecting(null);
      }
    },
    [isReady, connectMcpServer],
  );

  const isConnected = (serverName: string): boolean => connectedMcpServers.has(serverName);

  const grouped = useMemo(() => {
    const map = new Map<McpTransport, McpServerConfig[]>();
    for (const server of servers) {
      const arr = map.get(server.transport);
      if (arr) arr.push(server);
      else map.set(server.transport, [server]);
    }
    return Array.from(map.entries());
  }, [servers]);

  return (
    <div className="space-y-6">
      <SettingsSection title="Add MCP server">
        <div className="grid gap-3 md:grid-cols-[140px,1fr,1fr,auto] md:items-start">
          <div>
            <Select value={transport} onValueChange={(v) => setTransport(v as McpTransport)}>
              <SelectTrigger className="h-10 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sse">SSE</SelectItem>
                <SelectItem value="stdio" disabled={!isTauri()}>
                  Stdio{!isTauri() ? ' — Desktop only' : ''}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Server name"
            className="h-10 text-sm"
          />
          <Input
            value={transport === 'stdio' ? command : url}
            onChange={(e) => {
              if (transport === 'stdio') setCommand(e.target.value);
              else setUrl(e.target.value);
            }}
            placeholder={
              transport === 'stdio' ? '/usr/local/bin/mcp-server' : 'http://localhost:3001/sse'
            }
            className="h-10 text-sm"
          />
          <Button
            onClick={handleAdd}
            size="sm"
            variant="secondary"
            disabled={
              !name.trim() ||
              (transport === 'stdio' ? !command.trim() : !url.trim()) ||
              connecting !== null
            }
            className="h-10 border-emerald-500/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25 hover:border-emerald-400"
          >
            <Plus className="h-3.5 w-3.5" />
            {connecting ? 'Connecting…' : 'Add'}
          </Button>
        </div>
        {transport === 'stdio' && (
          <Input
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder="Arguments (one per line, optional)"
            className="h-10 text-sm"
          />
        )}
        {formError && <p className="text-xs text-error">{formError}</p>}
      </SettingsSection>

      <SettingsSection title="Configured servers">
        {servers.length === 0 ? (
          <p className="text-xs text-slate-500">
            No MCP servers configured. Add one above to enable tool use.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([groupTransport, groupServers]) => (
              <div key={groupTransport} className="space-y-1.5">
                <header className="text-[11px] uppercase tracking-wide text-white/55">
                  {groupTransport.toUpperCase()} · {groupServers.length}
                </header>
                <ul className="space-y-1">
                  {groupServers.map((server) => (
                    <li
                      key={serverKey(server)}
                      className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-white/[0.04]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-slate-100">
                            {server.name}
                          </span>
                          <Badge
                            variant={isConnected(server.name) ? 'success' : 'secondary'}
                            className="shrink-0 px-1.5 py-0 text-[10px]"
                          >
                            {connecting === server.name
                              ? 'Connecting…'
                              : isConnected(server.name)
                                ? 'Connected'
                                : 'Disconnected'}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                          {server.transport === 'stdio'
                            ? [server.command ?? '', ...(server.args ?? [])]
                                .filter(Boolean)
                                .join(' ')
                            : (server.url ?? '')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!isConnected(server.name) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReconnect(server)}
                            disabled={!isReady || connecting !== null}
                            title="Reconnect"
                            className="h-7 w-7 p-0 text-slate-300 hover:text-emerald-200"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(server)}
                          title="Delete server"
                          className="h-7 w-7 p-0 text-slate-300 hover:text-error"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}

import type { McpServerConfig as CoreMcpServerConfig } from '@offisim/core/browser';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { useCallback, useEffect, useState } from 'react';
import {
  listDesktopMcpServers,
  loadStoredBrowserMcpServers,
  registerDesktopMcpServer,
  unregisterDesktopMcpServer,
} from '../../lib/desktop-mcp-registry';
import { isTauri } from '../../lib/env';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';

type DesktopCoreMcpServerConfig = CoreMcpServerConfig & {
  registeredServerId?: string;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpTransport = 'stdio' | 'sse';

export interface McpServerConfig {
  serverId?: string;
  /** Unique display name for this server */
  name: string;
  /** Transport type */
  transport: McpTransport;
  /** For stdio transport. */
  command?: string;
  /** Extra stdio args. */
  args?: string[];
  /** For SSE transport. */
  url?: string;
}

const STORAGE_KEY = 'offisim:mcp-servers';

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

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

function resetFormState(setters: {
  setName: (value: string) => void;
  setCommand: (value: string) => void;
  setArgsText: (value: string) => void;
  setUrl: (value: string) => void;
}) {
  setters.setName('');
  setters.setCommand('');
  setters.setArgsText('');
  setters.setUrl('');
}

/** Convert UI config to core McpServerConfig for the executor. */
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpConfigPanel() {
  const { connectMcpServer, disconnectMcpServer, connectedMcpServers, isReady } =
    useOffisimRuntime();
  const [servers, setServers] = useState<McpServerConfig[]>(loadMcpServers);
  const [connecting, setConnecting] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransport>('sse');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState('');

  // Persist whenever servers change
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

    // Save to list first
    setServers((prev) => [...prev, newConfig]);

    // Try to connect immediately
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

    // Reset form
    resetFormState({ setName, setCommand, setArgsText, setUrl });
  }, [name, transport, command, url, argsText, servers, isReady, connectMcpServer]);

  const handleRemove = useCallback(
    async (server: McpServerConfig) => {
      setServers((prev) => prev.filter((s) => s.name !== server.name));
      // Disconnect from runtime
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

  return (
    <div className="flex flex-col gap-4">
      {/* Add server form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Add MCP Server</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <label htmlFor="mcp-server-name" className="text-xs text-shell mb-1 block">
              Server Name
            </label>
            <Input
              id="mcp-server-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. filesystem"
              className="h-8 text-sm"
            />
          </div>

          <div>
            <label htmlFor="mcp-transport" className="text-xs text-shell mb-1 block">
              Transport
            </label>
            <Select value={transport} onValueChange={(v) => setTransport(v as McpTransport)}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sse">SSE (browser-compatible)</SelectItem>
                <SelectItem value="stdio" disabled={!isTauri()}>
                  Stdio (Local){!isTauri() ? ' \u2014 Desktop only' : ''}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="mcp-command" className="text-xs text-shell mb-1 block">
              {transport === 'stdio' ? 'Command' : 'URL'}
            </label>
            <Input
              id="mcp-command"
              value={transport === 'stdio' ? command : url}
              onChange={(e) => {
                if (transport === 'stdio') setCommand(e.target.value);
                else setUrl(e.target.value);
              }}
              placeholder={
                transport === 'stdio' ? '/usr/local/bin/mcp-server' : 'http://localhost:3001/sse'
              }
              className="h-8 text-sm"
            />
          </div>

          {transport === 'stdio' && (
            <div>
              <label htmlFor="mcp-args" className="text-xs text-shell mb-1 block">
                Arguments (optional, one per line)
              </label>
              <Input
                id="mcp-args"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder="--project&#10;/path/to/workspace"
                className="h-8 text-sm"
              />
            </div>
          )}

          {formError && <p className="text-xs text-error">{formError}</p>}

          <Button
            onClick={handleAdd}
            size="sm"
            disabled={
              !name.trim() ||
              (transport === 'stdio' ? !command.trim() : !url.trim()) ||
              connecting !== null
            }
            className="self-end"
          >
            {connecting ? 'Connecting…' : 'Add & Connect'}
          </Button>
        </CardContent>
      </Card>

      {/* Server list */}
      {servers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Configured Servers ({servers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {servers.map((server) => (
                <li
                  key={server.name}
                  className="flex items-center gap-2 border-2 border-ocean-light bg-ocean-deep px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-sand truncate">{server.name}</span>
                      <Badge
                        variant={isConnected(server.name) ? 'success' : 'secondary'}
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {connecting === server.name
                          ? 'Connecting…'
                          : isConnected(server.name)
                            ? 'Connected'
                            : 'Disconnected'}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-ocean-light truncate mt-0.5">
                      <span className="font-mono">{server.transport}</span>
                      {' \u2014 '}
                      {server.transport === 'stdio'
                        ? [server.command ?? '', ...(server.args ?? [])].filter(Boolean).join(' ')
                        : (server.url ?? '')}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {!isConnected(server.name) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReconnect(server)}
                        disabled={!isReady || connecting !== null}
                        className="text-ocean-light hover:text-sand h-7 px-2 text-[11px]"
                      >
                        Connect
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(server)}
                      className="text-ocean-light hover:text-error h-7 px-2"
                    >
                      <svg
                        aria-hidden="true"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="h-3.5 w-3.5"
                      >
                        <path
                          fillRule="evenodd"
                          d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11V3.25A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25zm2.25-.75a.75.75 0 0 0-.75.75V4h3V3.25a.75.75 0 0 0-.75-.75h-1.5zM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {servers.length === 0 && (
        <p className="text-xs text-ocean-light text-center py-4">
          No MCP servers configured. Add one above to enable tool use.
        </p>
      )}
    </div>
  );
}

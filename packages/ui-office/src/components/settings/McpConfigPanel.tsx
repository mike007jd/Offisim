import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@aics/ui-core';
import type { McpServerConfig as CoreMcpServerConfig } from '@aics/core/browser';
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../../lib/env';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpTransport = 'stdio' | 'sse';

export interface McpServerConfig {
  /** Unique display name for this server */
  name: string;
  /** Transport type */
  transport: McpTransport;
  /**
   * For stdio: the shell command to launch the server (e.g. "npx mcp-server-foo").
   * For sse: the URL endpoint (e.g. "http://localhost:3001/sse").
   */
  commandOrUrl: string;
}

const STORAGE_KEY = 'aics:mcp-servers';

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as McpServerConfig[];
  } catch {
    return [];
  }
}

function saveMcpServers(servers: McpServerConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

/** Convert UI config to core McpServerConfig for the executor. */
function toCoreConfig(cfg: McpServerConfig): CoreMcpServerConfig {
  return {
    name: cfg.name,
    transport: cfg.transport,
    url: cfg.transport === 'sse' ? cfg.commandOrUrl : undefined,
    command: cfg.transport === 'stdio' ? cfg.commandOrUrl : undefined,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function McpConfigPanel() {
  const { connectMcpServer, disconnectMcpServer, connectedMcpServers, isReady } = useAicsRuntime();
  const [servers, setServers] = useState<McpServerConfig[]>(loadMcpServers);
  const [connecting, setConnecting] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransport>('sse');
  const [commandOrUrl, setCommandOrUrl] = useState('');
  const [formError, setFormError] = useState('');

  // Persist whenever servers change
  useEffect(() => {
    saveMcpServers(servers);
  }, [servers]);

  const handleAdd = useCallback(async () => {
    setFormError('');
    const trimmedName = name.trim();
    const trimmedCmd = commandOrUrl.trim();

    if (!trimmedName) {
      setFormError('Server name is required.');
      return;
    }
    if (!trimmedCmd) {
      setFormError(transport === 'stdio' ? 'Command is required.' : 'URL is required.');
      return;
    }
    if (servers.some((s) => s.name === trimmedName)) {
      setFormError(`A server named "${trimmedName}" already exists.`);
      return;
    }

    const newConfig: McpServerConfig = { name: trimmedName, transport, commandOrUrl: trimmedCmd };

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
    setName('');
    setCommandOrUrl('');
  }, [name, transport, commandOrUrl, servers, isReady, connectMcpServer]);

  const handleRemove = useCallback(
    async (serverName: string) => {
      setServers((prev) => prev.filter((s) => s.name !== serverName));
      // Disconnect from runtime
      try {
        await disconnectMcpServer(serverName);
      } catch {
        // Ignore — server might not be connected
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
            <label htmlFor="mcp-command-or-url" className="text-xs text-shell mb-1 block">
              {transport === 'stdio' ? 'Command' : 'URL'}
            </label>
            <Input
              id="mcp-command-or-url"
              value={commandOrUrl}
              onChange={(e) => setCommandOrUrl(e.target.value)}
              placeholder={
                transport === 'stdio'
                  ? 'npx @modelcontextprotocol/server-fs /path'
                  : 'http://localhost:3001/sse'
              }
              className="h-8 text-sm"
            />
          </div>

          {formError && <p className="text-xs text-error">{formError}</p>}

          <Button
            onClick={handleAdd}
            size="sm"
            disabled={!name.trim() || !commandOrUrl.trim() || connecting !== null}
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
                      {server.commandOrUrl}
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
                      onClick={() => handleRemove(server.name)}
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

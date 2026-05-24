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
  type DesktopMcpServerRecord,
  listDesktopMcpServers,
  loadStoredLocalMcpServers,
  registerDesktopMcpServer,
  unregisterDesktopMcpServer,
} from '../../lib/desktop-mcp-registry';
import { isTauri } from '../../lib/env';
import {
  useOffisimRuntimeExecution,
  useOffisimRuntimeServices,
} from '../../runtime/offisim-runtime-context';
import { SettingsSection, surfaceInputProps } from './settings-primitives';

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
  approvalId?: string;
  commandFingerprint?: string;
  source?: 'user-config' | 'installed-asset' | 'developer-runtime';
  sourcePackageId?: string;
  sourcePackageVersion?: string;
  sourceManifestHash?: string;
  requestSurface?: 'settings' | 'installed-asset-runtime' | 'developer-runtime';
}

interface PendingStdioConfirmation {
  name: string;
  command: string;
  args: string[];
  source: 'user-config';
  requestedTools: string[];
  riskClass: 'high';
}

const STORAGE_KEY = 'offisim:mcp-servers';

function loadMcpServers(): McpServerConfig[] {
  return loadStoredLocalMcpServers().map((server) => ({
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
    approvalId: cfg.approvalId,
    commandFingerprint: cfg.commandFingerprint,
    source: cfg.source,
    sourcePackageId: cfg.sourcePackageId,
    sourcePackageVersion: cfg.sourcePackageVersion,
    sourceManifestHash: cfg.sourceManifestHash,
    requestSurface: cfg.requestSurface,
    url: cfg.transport === 'sse' ? cfg.url : undefined,
    command: cfg.transport === 'stdio' ? cfg.command : undefined,
    args: cfg.transport === 'stdio' ? cfg.args : undefined,
  } as DesktopCoreMcpServerConfig;
}

function serverKey(server: McpServerConfig): string {
  return server.serverId ?? `local:${server.name}`;
}

function recordToConfig(record: DesktopMcpServerRecord): McpServerConfig {
  return {
    serverId: record.serverId,
    name: record.name,
    transport: record.transport,
    command: record.command,
    args: record.args,
    url: record.url,
    approvalId: record.approvalId,
    commandFingerprint: record.commandFingerprint,
    source: record.source as McpServerConfig['source'],
    sourcePackageId: record.sourcePackageId,
    sourcePackageVersion: record.sourcePackageVersion,
    sourceManifestHash: record.sourceManifestHash,
    requestSurface: record.requestSurface as McpServerConfig['requestSurface'],
  };
}

export function McpConfigPanel() {
  const { connectMcpServer, disconnectMcpServer, connectedMcpServers } =
    useOffisimRuntimeServices();
  const { isReady } = useOffisimRuntimeExecution();
  const [servers, setServers] = useState<McpServerConfig[]>(loadMcpServers);
  const [connecting, setConnecting] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [transport, setTransport] = useState<McpTransport>('sse');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');
  const [formError, setFormError] = useState('');
  const [pendingStdio, setPendingStdio] = useState<PendingStdioConfirmation | null>(null);

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
            source: record.source as McpServerConfig['source'],
            sourcePackageId: record.sourcePackageId,
            sourcePackageVersion: record.sourcePackageVersion,
            sourceManifestHash: record.sourceManifestHash,
            requestSurface: record.requestSurface as McpServerConfig['requestSurface'],
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

  const addServerConfig = useCallback(
    async (newConfig: McpServerConfig) => {
      setServers((prev) => [...prev, newConfig]);

      if (isReady) {
        setConnecting(newConfig.name);
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
      setPendingStdio(null);
    },
    [connectMcpServer, isReady],
  );

  const handleAdd = useCallback(async () => {
    setFormError('');
    setPendingStdio(null);
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

    if (isTauri() && transport === 'stdio') {
      setPendingStdio({
        name: trimmedName,
        command: trimmedCommand,
        args,
        source: 'user-config',
        requestedTools: [],
        riskClass: 'high',
      });
      return;
    }

    let newConfig: McpServerConfig;
    if (isTauri()) {
      const record = await registerDesktopMcpServer({
        name: trimmedName,
        transport,
        ...(transport === 'stdio'
          ? {
              command: trimmedCommand,
              args,
              source: 'user-config',
              approvalId: `settings-${Date.now().toString(36)}`,
              riskClass: 'high',
              requestSurface: 'settings',
            }
          : { url: trimmedUrl }),
      });
      newConfig = recordToConfig(record);
    } else {
      newConfig = {
        name: trimmedName,
        transport,
        ...(transport === 'stdio' ? { command: trimmedCommand, args } : { url: trimmedUrl }),
      };
    }

    await addServerConfig(newConfig);
  }, [name, transport, command, url, argsText, servers, addServerConfig]);

  const handleConfirmStdio = useCallback(async () => {
    if (!pendingStdio) return;
    setFormError('');
    const record = await registerDesktopMcpServer({
      name: pendingStdio.name,
      transport: 'stdio',
      command: pendingStdio.command,
      args: pendingStdio.args,
      source: pendingStdio.source,
      approvalId: `settings-${Date.now().toString(36)}`,
      riskClass: pendingStdio.riskClass,
      requestedTools: pendingStdio.requestedTools,
      requestSurface: 'settings',
    });
    await addServerConfig(recordToConfig(record));
  }, [addServerConfig, pendingStdio]);

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

  const connectionLabel = (serverName: string): string => {
    if (connecting === serverName) return 'Connecting…';
    return isConnected(serverName) ? 'Connected' : 'Disconnected';
  };

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
    <div className="settings-panel-stack">
      <SettingsSection title="Add MCP server">
        <div className="settings-mcp-add-grid">
          <div>
            <Select value={transport} onValueChange={(v) => setTransport(v as McpTransport)}>
              <SelectTrigger className={surfaceInputProps('text-fs-sm')}>
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
            className={surfaceInputProps('text-fs-sm')}
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
            className={surfaceInputProps('text-fs-sm')}
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
            className="settings-mcp-add-button"
          >
            <Plus data-icon="mcp-add" />
            {connecting ? 'Connecting…' : 'Add'}
          </Button>
        </div>
        {transport === 'stdio' && (
          <Input
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder="Arguments (one per line, optional)"
            className={surfaceInputProps('text-fs-sm')}
          />
        )}
        {pendingStdio && (
          <div className="settings-mcp-confirm">
            <div className="settings-mcp-confirm-head">
              <span>Confirm stdio MCP server</span>
              <Badge variant="warning" className="settings-mcp-risk-badge">
                High risk
              </Badge>
            </div>
            <dl className="settings-mcp-detail-list">
              <div>
                <dt>Command</dt>
                <dd className="break-all font-mono">{pendingStdio.command}</dd>
              </div>
              <div>
                <dt>Args</dt>
                <dd className="break-all font-mono">
                  {pendingStdio.args.length > 0 ? pendingStdio.args.join(' ') : '(none)'}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{pendingStdio.source}</dd>
              </div>
              <div>
                <dt>Tools</dt>
                <dd>
                  {pendingStdio.requestedTools.length > 0
                    ? pendingStdio.requestedTools.join(', ')
                    : 'Unknown until startup'}
                </dd>
              </div>
            </dl>
            <div className="settings-mcp-confirm-actions">
              <Button
                onClick={handleConfirmStdio}
                size="sm"
                variant="secondary"
                disabled={connecting !== null}
              >
                Confirm
              </Button>
              <Button
                onClick={() => setPendingStdio(null)}
                size="sm"
                variant="ghost"
                disabled={connecting !== null}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {formError && <p className="settings-inline-danger">{formError}</p>}
      </SettingsSection>

      <SettingsSection title="Configured servers">
        {servers.length === 0 ? (
          <p className="settings-muted-copy">
            No MCP servers configured. Add one above to enable tool use.
          </p>
        ) : (
          <div className="settings-mcp-groups">
            {grouped.map(([groupTransport, groupServers]) => (
              <div key={groupTransport} className="settings-mcp-group">
                <header>
                  {groupTransport.toUpperCase()} · {groupServers.length}
                </header>
                <ul>
                  {groupServers.map((server) => (
                    <li key={serverKey(server)} className="settings-mcp-server-row">
                      <div className="settings-mcp-server-main">
                        <div className="settings-mcp-server-head">
                          <span>{server.name}</span>
                          <Badge
                            variant={isConnected(server.name) ? 'success' : 'secondary'}
                            className="settings-mcp-server-badge"
                          >
                            {connectionLabel(server.name)}
                          </Badge>
                        </div>
                        <p>
                          {server.transport === 'stdio'
                            ? [server.command ?? '', ...(server.args ?? [])]
                                .filter(Boolean)
                                .join(' ')
                            : (server.url ?? '')}
                        </p>
                      </div>
                      <div className="settings-mcp-server-actions">
                        {!isConnected(server.name) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReconnect(server)}
                            disabled={!isReady || connecting !== null}
                            title="Reconnect"
                            className="settings-icon-action"
                          >
                            <RefreshCw data-icon="settings-action" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(server)}
                          title="Delete server"
                          className="settings-icon-action settings-icon-action-danger"
                        >
                          <Trash2 data-icon="settings-action" />
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

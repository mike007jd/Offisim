import {
  CapsLabel,
  CardBlock,
  FieldRow,
  IconButton,
  SegmentedControl,
  StatusPill,
} from '@/design-system/grammar/index.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { McpStdioConfirmDialog } from './McpStdioConfirmDialog.js';
import {
  MCP_SERVER_DEFAULTS,
  MCP_STATUS_LABELS,
  connectMcpServer,
  type McpServer,
  type McpServerFormValues,
  type McpStatus,
  type McpTransport,
  mcpServerSchema,
  registerMcpServer,
  unregisterMcpServer,
  useMcpServers,
} from './settings-data.js';

function statusTone(status: McpStatus) {
  if (status === 'connected') return 'ok' as const;
  if (status === 'connecting') return 'accent' as const;
  if (status === 'registered') return 'violet' as const;
  return 'muted' as const;
}

interface PendingStdio extends McpServerFormValues {
  requestedTools: readonly string[];
  riskyTools: readonly string[];
}

export function McpServersPane() {
  const queryClient = useQueryClient();
  const desktopAvailable = isTauriRuntime();
  const serversQuery = useMcpServers();
  const servers = serversQuery.data ?? [];
  const [pending, setPending] = useState<PendingStdio | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);

  const form = useForm<McpServerFormValues>({
    resolver: zodResolver(mcpServerSchema),
    defaultValues: MCP_SERVER_DEFAULTS,
    mode: 'onSubmit',
  });
  const transport = form.watch('transport');

  const groups = useMemo(() => {
    const stdio = servers.filter((s) => s.transport === 'stdio');
    const sse = servers.filter((s) => s.transport === 'sse');
    return { stdio, sse };
  }, [servers]);

  async function refreshServers() {
    await queryClient.invalidateQueries({ queryKey: ['settings', 'mcp-servers'] });
  }

  async function commitServer(values: McpServerFormValues) {
    if (!desktopAvailable) {
      toast.error('MCP registry changes require the release desktop app.');
      return;
    }
    setSubmitting(true);
    let registeredServer: McpServer | null = null;
    try {
      const server = await registerMcpServer(values);
      registeredServer = server;
      if (values.transport === 'stdio') {
        setBusyServerId(server.id);
        const result = await connectMcpServer(server);
        toast.success(`Connected MCP server "${server.name}"`, {
          description: `${result.tools.length} tools discovered`,
        });
      } else {
        toast.success(`Registered MCP server "${server.name}"`, {
          description: 'SSE servers connect from the web runtime when used.',
        });
      }
      form.reset(MCP_SERVER_DEFAULTS);
      await refreshServers();
    } catch (error) {
      toast.error(
        registeredServer
          ? `MCP server "${registeredServer.name}" was registered but did not connect`
          : 'MCP server was not registered',
        { description: safeErrorMessage(error) },
      );
      await refreshServers();
    } finally {
      setSubmitting(false);
      setBusyServerId(null);
    }
  }

  const onSubmit = form.handleSubmit((values) => {
    if (values.transport === 'stdio') {
      // High-risk stdio requires a confirm before connecting.
      setPending({
        ...values,
        requestedTools: ['tools/list probe', 'local process startup'],
        riskyTools: ['local process startup'],
      });
      return;
    }
    commitServer(values);
  });

  function confirmPending() {
    if (!pending) return;
    void commitServer(pending);
    setPending(null);
  }

  function setTransport(value: McpTransport) {
    form.setValue('transport', value);
  }

  async function removeServer(server: McpServer) {
    if (!desktopAvailable) {
      toast.error('MCP registry changes require the release desktop app.');
      return;
    }
    setBusyServerId(server.id);
    try {
      await unregisterMcpServer(server);
      await refreshServers();
      toast.success(`Removed MCP server "${server.name}"`);
    } catch (error) {
      toast.error('MCP server was not removed', { description: safeErrorMessage(error) });
    } finally {
      setBusyServerId(null);
    }
  }

  async function reconnectServer(server: McpServer) {
    if (!desktopAvailable) {
      toast.error('MCP connection actions require the release desktop app.');
      return;
    }
    setBusyServerId(server.id);
    try {
      const result = await connectMcpServer(server);
      await refreshServers();
      toast.success(`Connected MCP server "${server.name}"`, {
        description: `${result.tools.length} tools discovered`,
      });
    } catch (error) {
      await refreshServers();
      toast.error('MCP server connection failed', { description: safeErrorMessage(error) });
    } finally {
      setBusyServerId(null);
    }
  }

  const renderGroup = (label: string, icon: typeof Terminal, list: readonly McpServer[]) =>
    list.length === 0 ? null : (
      <div className="off-set-mcp-group">
        <div className="off-set-mcp-group-head">
          <Icon icon={icon} size="sm" />
          {label} · {list.length}
        </div>
        {list.map((server) => {
          const busy = busyServerId === server.id;
          const userOwned = server.source === 'user-config';
          const canConnect = desktopAvailable && userOwned && server.transport === 'stdio';
          const connectLabel =
            server.transport === 'sse'
              ? 'SSE servers connect from the web runtime'
              : server.status === 'connected'
                ? 'Refresh tool list'
                : 'Connect';
          return (
            <div key={server.id} className="off-set-mcp-row">
              <div className="min-w-0">
                <div className="off-set-mcp-name-row">
                  <span className="off-set-mcp-name">{server.name}</span>
                  <StatusPill tone={statusTone(busy ? 'connecting' : server.status)} running={busy}>
                    {busy ? MCP_STATUS_LABELS.connecting : MCP_STATUS_LABELS[server.status]}
                  </StatusPill>
                  <span className="off-set-chip-mini">{server.source}</span>
                  {typeof server.toolCount === 'number' ? (
                    <span className="off-set-chip-mini">{server.toolCount} tools</span>
                  ) : null}
                </div>
                <div className="off-set-mcp-cmd">{server.command}</div>
              </div>
              <span />
              <div className="off-set-row-actions">
                <IconButton
                  icon={RefreshCw}
                  label={connectLabel}
                  size="iconSm"
                  variant="outline"
                  disabled={busy || !canConnect}
                  onClick={() => {
                    void reconnectServer(server);
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={userOwned ? 'Delete server' : 'Managed by runtime source'}
                  size="iconSm"
                  variant="outline"
                  className="off-set-micro-danger"
                  disabled={busy || !desktopAvailable || !userOwned}
                  onClick={() => {
                    void removeServer(server);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">MCP Servers</div>
        <div className="off-set-panedesc">
          Model Context Protocol tool servers available to employees. Stdio servers start only after
          desktop approval; SSE entries are stored for the web runtime.
        </div>
        {!desktopAvailable ? (
          <div className="off-set-callout">
            <Icon icon={Terminal} size="sm" />
            Browser preview cannot read or mutate the desktop MCP registry. Release builds use the
            real registry and stdio process bridge.
          </div>
        ) : null}
      </div>

      {/* Add MCP server */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Add MCP server</CapsLabel>
        </div>
        <CardBlock>
          <form onSubmit={onSubmit} className="flex flex-col gap-[var(--off-sp-4)]">
            <div className="off-field">
              <span className="off-field-label">Transport</span>
              <SegmentedControl<McpTransport>
                value={transport}
                onChange={setTransport}
                ariaLabel="Transport"
                options={[
                  { value: 'stdio', label: 'stdio', icon: <Icon icon={Terminal} size="sm" /> },
                  { value: 'sse', label: 'sse', icon: <Icon icon={Globe} size="sm" /> },
                ]}
              />
            </div>
            <div className="off-set-grid-2">
              <FieldRow
                label={
                  <>
                    Server name <span className="off-set-req">*</span>
                  </>
                }
                hint={form.formState.errors.name?.message}
                warn={!!form.formState.errors.name}
              >
                {({ id }) => (
                  <Input id={id} placeholder="workspace-tools" {...form.register('name')} />
                )}
              </FieldRow>
              <FieldRow
                label={
                  <>
                    Approval ID <span className="off-set-opt">· optional</span>
                  </>
                }
              >
                {({ id }) => (
                  <Input
                    id={id}
                    className="off-mono"
                    placeholder="mcp.workspace.tools"
                    {...form.register('approvalId')}
                  />
                )}
              </FieldRow>

              {transport === 'stdio' ? (
                <>
                  <FieldRow
                    className="off-set-span-2"
                    label="Command"
                    hint={form.formState.errors.command?.message}
                    warn={!!form.formState.errors.command}
                  >
                    {({ id }) => (
                      <Input
                        id={id}
                        className="off-mono"
                        placeholder="mcp-server-command"
                        {...form.register('command')}
                      />
                    )}
                  </FieldRow>
                  <FieldRow
                    className="off-set-span-2"
                    label={
                      <>
                        Arguments <span className="off-set-opt">· one per line</span>
                      </>
                    }
                  >
                    {({ id }) => (
                      <Textarea
                        id={id}
                        className="off-mono"
                        placeholder={'--workspace\ncurrent-project'}
                        {...form.register('args')}
                      />
                    )}
                  </FieldRow>
                </>
              ) : (
                <FieldRow
                  className="off-set-span-2"
                  label="Endpoint URL"
                  hint={form.formState.errors.url?.message}
                  warn={!!form.formState.errors.url}
                >
                  {({ id }) => (
                    <Input
                      id={id}
                      className="off-mono"
                      placeholder="http://localhost:3001/sse"
                      {...form.register('url')}
                    />
                  )}
                </FieldRow>
              )}
            </div>
            <div className="off-set-dialog-actions">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => form.reset(MCP_SERVER_DEFAULTS)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="md"
                className="off-set-btn-ok"
                disabled={!desktopAvailable || submitting}
                title={
                  desktopAvailable
                    ? undefined
                    : 'MCP registry changes require the release desktop app'
                }
              >
                <Icon icon={Plus} size="sm" />
                {submitting ? 'Adding…' : 'Add server'}
              </Button>
            </div>
          </form>
        </CardBlock>
      </section>

      {/* Configured servers */}
      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Configured servers</CapsLabel>
        </div>
        <CardBlock>
          {serversQuery.isLoading ? (
            <div className="off-set-empty-line">Loading MCP registry…</div>
          ) : servers.length === 0 ? (
            <div className="off-set-empty-line">
              No MCP servers registered. Add one above to enable tool use.
            </div>
          ) : (
            <>
              {renderGroup('Stdio', Terminal, groups.stdio)}
              {renderGroup('SSE', Globe, groups.sse)}
            </>
          )}
        </CardBlock>
      </section>

      <McpStdioConfirmDialog
        pending={pending}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

import {
  CapsLabel,
  CardBlock,
  FieldRow,
  IconButton,
  SegmentedControl,
  StatusPill,
} from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { Globe, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { McpStdioConfirmDialog } from './McpStdioConfirmDialog.js';
import {
  MCP_SERVER_DEFAULTS,
  MCP_STATUS_LABELS,
  type McpServer,
  type McpServerFormValues,
  type McpStatus,
  type McpTransport,
  mcpServerSchema,
  useMcpServers,
} from './settings-data.js';

function statusTone(status: McpStatus) {
  if (status === 'connected') return 'ok' as const;
  if (status === 'connecting') return 'accent' as const;
  return 'muted' as const;
}

interface PendingStdio extends McpServerFormValues {
  requestedTools: readonly string[];
  riskyTools: readonly string[];
}

export function McpServersPane() {
  const { data: servers } = useMcpServers();
  const [localServers, setLocalServers] = useState<readonly McpServer[]>(servers);
  const [pending, setPending] = useState<PendingStdio | null>(null);

  const form = useForm<McpServerFormValues>({
    resolver: zodResolver(mcpServerSchema),
    defaultValues: MCP_SERVER_DEFAULTS,
    mode: 'onSubmit',
  });
  const transport = form.watch('transport');

  const groups = useMemo(() => {
    const stdio = localServers.filter((s) => s.transport === 'stdio');
    const sse = localServers.filter((s) => s.transport === 'sse');
    return { stdio, sse };
  }, [localServers]);

  function commitServer(values: McpServerFormValues) {
    const command =
      values.transport === 'stdio'
        ? `${values.command}${values.args ? ` ${values.args.split('\n').join(' ')}` : ''}`
        : values.url;
    const server: McpServer = {
      id: `${values.name}-${Date.now()}`,
      name: values.name,
      transport: values.transport,
      status: 'connecting',
      source: 'user-config',
      command,
      approvalId: values.approvalId || `mcp.${values.name}.default`,
      requestedTools: [],
      riskyTools: [],
    };
    setLocalServers((prev) => [...prev, server]);
    form.reset(MCP_SERVER_DEFAULTS);
    toast.success(`Added MCP server "${values.name}"`);
  }

  const onSubmit = form.handleSubmit((values) => {
    if (values.transport === 'stdio') {
      // High-risk stdio requires a confirm before connecting.
      setPending({ ...values, requestedTools: ['(probed on startup)'], riskyTools: [] });
      return;
    }
    commitServer(values);
  });

  function confirmPending() {
    if (!pending) return;
    commitServer(pending);
    setPending(null);
  }

  function setTransport(value: McpTransport) {
    form.setValue('transport', value);
  }

  function removeServer(id: string) {
    setLocalServers((prev) => prev.filter((s) => s.id !== id));
    toast.success('Server removed');
  }

  function reconnectServer(id: string) {
    setLocalServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'connecting' as const } : s)),
    );
    toast.info('Reconnecting…');
  }

  const renderGroup = (label: string, icon: typeof Terminal, list: readonly McpServer[]) =>
    list.length === 0 ? null : (
      <div className="off-set-mcp-group">
        <div className="off-set-mcp-group-head">
          <Icon icon={icon} size="sm" />
          {label} · {list.length}
        </div>
        {list.map((server) => (
          <div key={server.id} className="off-set-mcp-row">
            <div className="min-w-0">
              <div className="off-set-mcp-name-row">
                <span className="off-set-mcp-name">{server.name}</span>
                <StatusPill
                  tone={statusTone(server.status)}
                  running={server.status === 'connecting'}
                >
                  {MCP_STATUS_LABELS[server.status]}
                </StatusPill>
                <span className="off-set-chip-mini">{server.source}</span>
              </div>
              <div className="off-set-mcp-cmd">{server.command}</div>
            </div>
            <span />
            <div className="off-set-row-actions">
              {server.status === 'disconnected' ? (
                <IconButton
                  icon={RefreshCw}
                  label="Reconnect"
                  size="iconSm"
                  variant="outline"
                  onClick={() => reconnectServer(server.id)}
                />
              ) : (
                <IconButton
                  icon={RefreshCw}
                  label="Refresh tool list"
                  size="iconSm"
                  variant="outline"
                  onClick={() => reconnectServer(server.id)}
                />
              )}
              <IconButton
                icon={Trash2}
                label="Delete server"
                size="iconSm"
                variant="outline"
                className="off-set-micro-danger"
                onClick={() => removeServer(server.id)}
              />
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">MCP Servers</div>
        <div className="off-set-panedesc">
          Model Context Protocol tool servers available to employees. SSE works everywhere; stdio is
          desktop-only and gated by a high-risk confirm.
        </div>
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
                {({ id }) => <Input id={id} placeholder="serena" {...form.register('name')} />}
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
                    placeholder="mcp.serena.ide-assistant"
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
                        placeholder="uvx --from serena serena-mcp-server"
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
                        placeholder={'--context\nide-assistant'}
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
              <Button variant="outline" size="md" onClick={() => form.reset(MCP_SERVER_DEFAULTS)}>
                Cancel
              </Button>
              <Button type="submit" size="md" className="off-set-btn-ok">
                <Icon icon={Plus} size="sm" />
                Add server
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
          {localServers.length === 0 ? (
            <div className="off-set-empty-line">
              No MCP servers configured. Add one above to enable tool use.
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

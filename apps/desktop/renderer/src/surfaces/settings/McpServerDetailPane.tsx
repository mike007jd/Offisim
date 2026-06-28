import { useUiState } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import { CapsLabel, CardBlock, StatusPill } from '@/design-system/grammar/index.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, RefreshCw, ShieldCheck, Wrench, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  MCP_STATUS_LABELS,
  type McpServer,
  type McpStatus,
  type McpToolInfo,
  grantMcpTool,
  isWriteMcpTool,
  revokeMcpTool,
  testMcpTool,
  useMcpToolGrants,
} from './settings-data.js';

interface McpServerDetailPaneProps {
  server: McpServer;
  busy: boolean;
  desktopAvailable: boolean;
  onBack: () => void;
  onReconnect: (server: McpServer) => void;
}

function statusTone(status: McpStatus) {
  if (status === 'connected') return 'ok' as const;
  if (status === 'connecting') return 'accent' as const;
  if (status === 'registered') return 'violet' as const;
  return 'muted' as const;
}

function describeSchema(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '{}';
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return '{}';
  }
}

function describeResult(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolBadge(tool: McpToolInfo) {
  return isWriteMcpTool(tool) ? (
    <span className="off-set-mcp-tool-badge is-write">
      <Icon icon={Zap} size="sm" />
      Write
    </span>
  ) : (
    <span className="off-set-mcp-tool-badge is-read">
      <Icon icon={ShieldCheck} size="sm" />
      Read
    </span>
  );
}

export function McpServerDetailPane({
  server,
  busy,
  desktopAvailable,
  onBack,
  onReconnect,
}: McpServerDetailPaneProps) {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  const employees = useEmployees();
  const employeeOptions = useMemo(
    () =>
      (employees.data ?? [])
        .filter((employee) => !employee.disabled)
        .map((employee) => ({ value: employee.id, label: employee.name })),
    [employees.data],
  );
  const [employeeId, setEmployeeId] = useState(employeeOptions[0]?.value ?? '');
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [argsByTool, setArgsByTool] = useState<Record<string, string>>({});
  const [resultByTool, setResultByTool] = useState<Record<string, string>>({});
  const grants = useMcpToolGrants(companyId, employeeId || null);

  useEffect(() => {
    if (!employeeId && employeeOptions[0]?.value) setEmployeeId(employeeOptions[0].value);
  }, [employeeId, employeeOptions]);

  const grantedTools = useMemo(() => {
    return new Set(
      (grants.data ?? [])
        .filter((grant) => grant.serverName === server.name)
        .map((grant) => grant.toolName),
    );
  }, [grants.data, server.name]);

  async function refreshGrantViews() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings', 'mcp-tool-grants'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-mcp-tools'] }),
    ]);
  }

  async function toggleGrant(tool: McpToolInfo) {
    if (!companyId || !employeeId) {
      toast.error('Select a company employee before editing MCP grants.');
      return;
    }
    setBusyTool(tool.name);
    try {
      if (grantedTools.has(tool.name)) {
        await revokeMcpTool({
          companyId,
          employeeId,
          serverName: server.name,
          toolName: tool.name,
        });
        toast.success(`Revoked "${tool.name}" from selected employee`);
      } else {
        await grantMcpTool({
          companyId,
          employeeId,
          serverName: server.name,
          toolName: tool.name,
        });
        toast.success(`Granted "${tool.name}" to selected employee`);
      }
      await refreshGrantViews();
    } catch (error) {
      toast.error('MCP grant was not updated', { description: safeErrorMessage(error) });
    } finally {
      setBusyTool(null);
    }
  }

  async function runToolTest(tool: McpToolInfo) {
    if (!desktopAvailable) {
      toast.error('MCP tool tests require the release desktop app.');
      return;
    }
    setBusyTool(tool.name);
    try {
      const result = await testMcpTool({
        serverName: server.name,
        toolName: tool.name,
        argsText: argsByTool[tool.name] ?? '{}',
        employeeId,
      });
      setResultByTool((current) => ({ ...current, [tool.name]: describeResult(result.content) }));
      toast.success(`Tested "${tool.name}"`, {
        description: result.isError ? 'Tool returned isError' : 'Tool returned content',
      });
    } catch (error) {
      setResultByTool((current) => ({
        ...current,
        [tool.name]: safeErrorMessage(error),
      }));
      toast.error('MCP tool test failed', { description: safeErrorMessage(error) });
    } finally {
      setBusyTool(null);
    }
  }

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-mcp-detail-head">
          <Button variant="outline" size="sm" onClick={onBack}>
            <Icon icon={ArrowLeft} size="sm" />
            Servers
          </Button>
          <div className="min-w-0">
            <div className="off-set-panetitle">{server.name}</div>
            <div className="off-set-panedesc">{server.command}</div>
          </div>
        </div>
      </div>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Connection</CapsLabel>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !desktopAvailable || server.transport !== 'stdio'}
            onClick={() => onReconnect(server)}
          >
            <Icon icon={RefreshCw} size="sm" />
            {server.status === 'connected' ? 'Refresh tools' : 'Connect'}
          </Button>
        </div>
        <CardBlock>
          <div className="off-set-mcp-detail-grid">
            <div>
              <span>Status</span>
              <StatusPill tone={statusTone(busy ? 'connecting' : server.status)} running={busy}>
                {busy ? MCP_STATUS_LABELS.connecting : MCP_STATUS_LABELS[server.status]}
              </StatusPill>
            </div>
            <div>
              <span>Transport</span>
              <b>{server.transport}</b>
            </div>
            <div>
              <span>OAuth</span>
              <b>N/A</b>
            </div>
            <div>
              <span>Approval policy</span>
              <b>{server.approvalId || 'runtime default'}</b>
            </div>
          </div>
        </CardBlock>
      </section>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <CapsLabel>Tool grants</CapsLabel>
          <Select
            aria-label="Employee grant target"
            className="off-set-mcp-employee-select"
            value={employeeId}
            disabled={!employeeOptions.length}
            onChange={(event) => setEmployeeId(event.target.value)}
            options={
              employeeOptions.length
                ? employeeOptions
                : [{ value: '', label: employees.isLoading ? 'Loading employees' : 'No employees' }]
            }
          />
        </div>
        <CardBlock>
          {server.tools.length === 0 ? (
            <div className="off-set-empty-line">
              No tools discovered yet. Connect or refresh this server to read its live tool catalog.
            </div>
          ) : (
            <div className="off-set-mcp-tool-list">
              {server.tools.map((tool) => {
                const enabled = grantedTools.has(tool.name);
                const toolBusy = busyTool === tool.name;
                return (
                  <div key={tool.name} className="off-set-mcp-tool-row">
                    <div className="off-set-mcp-tool-main">
                      <div className="off-set-mcp-tool-title">
                        <Icon icon={Wrench} size="sm" />
                        <span>{tool.annotations?.title || tool.name}</span>
                        <code>{tool.name}</code>
                        {toolBadge(tool)}
                      </div>
                      <p>{tool.description || 'No description provided by this MCP server.'}</p>
                      <details className="off-set-mcp-schema">
                        <summary>Input schema</summary>
                        <pre>{describeSchema(tool.inputSchema)}</pre>
                      </details>
                    </div>
                    <div className="off-set-mcp-tool-actions">
                      <label
                        className={cn(
                          'off-set-mcp-grant-toggle',
                          enabled && 'is-on',
                          (!companyId || !employeeId) && 'is-disabled',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={toolBusy || !companyId || !employeeId}
                          onChange={() => void toggleGrant(tool)}
                        />
                        <span>{enabled ? 'Granted' : 'Grant'}</span>
                      </label>
                      <Textarea
                        className="off-set-mcp-args off-mono"
                        value={argsByTool[tool.name] ?? '{}'}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(event) =>
                          setArgsByTool((current) => ({
                            ...current,
                            [tool.name]: event.target.value,
                          }))
                        }
                        aria-label={`${tool.name} test arguments`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={toolBusy || server.status !== 'connected' || !desktopAvailable}
                        onClick={() => void runToolTest(tool)}
                      >
                        <Icon icon={Play} size="sm" />
                        Test
                      </Button>
                      {resultByTool[tool.name] ? (
                        <pre className="off-set-mcp-result">{resultByTool[tool.name]}</pre>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBlock>
      </section>
    </div>
  );
}

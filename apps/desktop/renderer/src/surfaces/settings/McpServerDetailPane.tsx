import { useUiState } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import { Select } from '@/design-system/grammar/Select.js';
import { CapsLabel, CardBlock, StatusPill } from '@/design-system/grammar/index.js';
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
  inferMcpGrantRiskClass,
  inferMcpGrantRiskSource,
  isWriteMcpTool,
  revokeMcpTool,
  testMcpTool,
  updateMcpToolGrantRisk,
  useMcpToolGrants,
} from './settings-data.js';

interface McpServerDetailPaneProps {
  server: McpServer;
  busy: boolean;
  desktopAvailable: boolean;
  onBack: () => void;
  onReconnect: (server: McpServer) => void;
}

interface McpGrantScope {
  companyId: string;
  employeeId: string;
  serverId: string;
  serverName: string;
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

function safeToolText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function safeTools(server: McpServer): readonly McpToolInfo[] {
  return Array.isArray(server.tools) ? server.tools : [];
}

function safeRiskClass(value: unknown, fallback: McpGrantRiskClass): McpGrantRiskClass {
  return MCP_RISK_OPTIONS.some((option) => option.value === value)
    ? (value as McpGrantRiskClass)
    : fallback;
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

const MCP_RISK_OPTIONS = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'destructive', label: 'Destructive' },
  { value: 'open_world', label: 'Open world' },
] as const;

type McpGrantRiskClass = (typeof MCP_RISK_OPTIONS)[number]['value'];

function riskLabel(value: McpGrantRiskClass): string {
  return MCP_RISK_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function grantRiskStateKey(serverName: string, employeeId: string, toolName: string): string {
  return `${employeeId}\u0000${serverName}\u0000${toolName}`;
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
  const selectedEmployeeId = employeeOptions.some((option) => option.value === employeeId)
    ? employeeId
    : (employeeOptions[0]?.value ?? '');
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [argsByTool, setArgsByTool] = useState<Record<string, string>>({});
  const [resultByTool, setResultByTool] = useState<Record<string, string>>({});
  const [riskByTool, setRiskByTool] = useState<Record<string, McpGrantRiskClass>>({});
  const grants = useMcpToolGrants(companyId, selectedEmployeeId || null);
  const tools = safeTools(server);

  useEffect(() => {
    if (employeeId !== selectedEmployeeId) setEmployeeId(selectedEmployeeId);
  }, [employeeId, selectedEmployeeId]);

  const grantedTools = useMemo(() => {
    return new Set(
      (grants.data ?? [])
        .filter((grant) => grant.serverName === server.name)
        .map((grant) => grant.toolName),
    );
  }, [grants.data, server.name]);

  const grantsByTool = useMemo(() => {
    return new Map(
      (grants.data ?? [])
        .filter((grant) => grant.serverName === server.name)
        .map((grant) => [grant.toolName, grant] as const),
    );
  }, [grants.data, server.name]);

  async function refreshGrantViews() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['settings', 'mcp-tool-grants'] }),
      queryClient.invalidateQueries({ queryKey: ['employee-mcp-tools'] }),
    ]);
  }

  function captureGrantScope(): McpGrantScope | null {
    if (!companyId || !selectedEmployeeId) return null;
    return {
      companyId,
      employeeId: selectedEmployeeId,
      serverId: server.id,
      serverName: server.name,
    };
  }

  async function saveGrant(scope: McpGrantScope, tool: McpToolInfo, riskClass: McpGrantRiskClass) {
    const suggestedRisk = inferMcpGrantRiskClass(tool);
    await grantMcpTool({
      companyId: scope.companyId,
      employeeId: scope.employeeId,
      serverName: scope.serverName,
      toolName: tool.name,
      riskClass,
      riskSource: riskClass === suggestedRisk ? inferMcpGrantRiskSource(tool) : 'human_override',
      trustedServerId: scope.serverId,
    });
  }

  async function toggleGrant(tool: McpToolInfo) {
    const scope = captureGrantScope();
    if (!scope) {
      toast.error('Select a company employee before editing MCP grants.');
      return;
    }
    setBusyTool(tool.name);
    try {
      if (grantedTools.has(tool.name)) {
        await revokeMcpTool({
          companyId: scope.companyId,
          employeeId: scope.employeeId,
          serverName: scope.serverName,
          toolName: tool.name,
        });
        toast.success(`Revoked "${tool.name}" from selected employee`);
      } else {
        const key = grantRiskStateKey(scope.serverName, scope.employeeId, tool.name);
        await saveGrant(scope, tool, riskByTool[key] ?? inferMcpGrantRiskClass(tool));
        toast.success(`Granted "${tool.name}" to selected employee`);
      }
      await refreshGrantViews();
    } catch (error) {
      toast.error('MCP grant was not updated', { description: safeErrorMessage(error) });
    } finally {
      setBusyTool(null);
    }
  }

  async function changeRisk(tool: McpToolInfo, riskClass: McpGrantRiskClass) {
    const scope = captureGrantScope();
    if (!scope) {
      toast.error('Select a company employee before editing MCP grant risk.');
      return;
    }
    const key = grantRiskStateKey(scope.serverName, scope.employeeId, tool.name);
    if (!grantedTools.has(tool.name)) {
      setRiskByTool((current) => ({ ...current, [key]: riskClass }));
      return;
    }
    setBusyTool(tool.name);
    try {
      const suggestedRisk = inferMcpGrantRiskClass(tool);
      const updated = await updateMcpToolGrantRisk({
        companyId: scope.companyId,
        employeeId: scope.employeeId,
        serverName: scope.serverName,
        toolName: tool.name,
        riskClass,
        riskSource: riskClass === suggestedRisk ? inferMcpGrantRiskSource(tool) : 'human_override',
        trustedServerId: scope.serverId,
      });
      if (!updated) {
        await saveGrant(scope, tool, riskClass);
      }
      setRiskByTool((current) => ({ ...current, [key]: riskClass }));
      await refreshGrantViews();
      toast.success(`Updated "${tool.name}" risk to ${riskLabel(riskClass)}`);
    } catch (error) {
      toast.error('MCP risk class was not updated', { description: safeErrorMessage(error) });
    } finally {
      setBusyTool(null);
    }
  }

  async function runToolTest(tool: McpToolInfo) {
    if (!desktopAvailable) {
      toast.error('MCP tool tests require the release desktop app.');
      return;
    }
    const scope = captureGrantScope();
    const toolName = safeToolText(tool.name, 'tool');
    setBusyTool(toolName);
    try {
      const result = await testMcpTool({
        serverName: server.name,
        toolName,
        argsText: argsByTool[toolName] ?? '{}',
        employeeId: scope?.employeeId ?? '',
      });
      setResultByTool((current) => ({ ...current, [toolName]: describeResult(result.content) }));
      toast.success(`Tested "${toolName}"`, {
        description: result.isError ? 'Tool returned isError' : 'Tool returned content',
      });
    } catch (error) {
      setResultByTool((current) => ({
        ...current,
        [toolName]: safeErrorMessage(error),
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
            value={selectedEmployeeId}
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
          {tools.length === 0 ? (
            <div className="off-set-empty-line">
              No tools discovered yet. Connect or refresh this server to read its live tool catalog.
            </div>
          ) : (
            <div className="off-set-mcp-tool-list">
              {tools.map((tool, index) => {
                const toolName = safeToolText(tool.name, `tool-${index + 1}`);
                const toolTitle = safeToolText(tool.annotations?.title, toolName);
                const toolDescription = safeToolText(
                  tool.description,
                  'No description provided by this MCP server.',
                );
                const enabled = grantedTools.has(toolName);
                const toolBusy = busyTool === toolName;
                const grant = grantsByTool.get(toolName);
                const suggestedRisk = inferMcpGrantRiskClass(tool);
                const riskStateKey = grantRiskStateKey(server.name, selectedEmployeeId, toolName);
                const selectedRisk = safeRiskClass(
                  riskByTool[riskStateKey] ?? grant?.riskClass,
                  suggestedRisk,
                );
                const riskDrift = Boolean(grant && grant.riskClass !== suggestedRisk);
                return (
                  <div key={toolName} className="off-set-mcp-tool-row">
                    <div className="off-set-mcp-tool-main">
                      <div className="off-set-mcp-tool-title">
                        <Icon icon={Wrench} size="sm" />
                        <span>{toolTitle}</span>
                        <code>{toolName}</code>
                        {toolBadge(tool)}
                      </div>
                      <div className="off-set-mcp-risk-line">
                        <span>Suggested {riskLabel(suggestedRisk)}</span>
                        {riskDrift ? (
                          <span>Saved {riskLabel(grant?.riskClass ?? suggestedRisk)}</span>
                        ) : null}
                      </div>
                      <p>{toolDescription}</p>
                      <details className="off-set-mcp-schema">
                        <summary>Input schema</summary>
                        <pre>{describeSchema(tool.inputSchema)}</pre>
                      </details>
                    </div>
                    <div className="off-set-mcp-tool-actions">
                      <Select
                        aria-label={`${toolName} grant risk class`}
                        value={selectedRisk}
                        disabled={toolBusy || !companyId || !selectedEmployeeId}
                        onChange={(event) =>
                          void changeRisk(tool, event.target.value as McpGrantRiskClass)
                        }
                        options={MCP_RISK_OPTIONS}
                      />
                      <label
                        className={cn(
                          'off-set-mcp-grant-toggle',
                          enabled && 'is-on',
                          (!companyId || !selectedEmployeeId) && 'is-disabled',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={toolBusy || !companyId || !selectedEmployeeId}
                          onChange={() => void toggleGrant(tool)}
                        />
                        <span>{enabled ? 'Granted' : 'Grant'}</span>
                      </label>
                      <Textarea
                        className="off-set-mcp-args off-mono"
                        value={argsByTool[toolName] ?? '{}'}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(event) =>
                          setArgsByTool((current) => ({
                            ...current,
                            [toolName]: event.target.value,
                          }))
                        }
                        aria-label={`${toolName} test arguments`}
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
                      {resultByTool[toolName] ? (
                        <pre className="off-set-mcp-result">{resultByTool[toolName]}</pre>
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

import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { queryKeys } from '@/data/query-keys.js';
import { useEmployees } from '@/data/queries.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import {
  CUA_DRIVER_MCP_PRESET,
  type McpServer,
  connectMcpServer,
  grantMcpTool,
  inferMcpGrantRiskClass,
  inferMcpGrantRiskSource,
  registerMcpServer,
  revokeMcpTool,
  useMcpServers,
  useMcpToolGrants,
} from '@/surfaces/settings/settings-data.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  MonitorSmartphone,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CUA_DRIVER_DAEMON_COMMAND,
  CUA_DRIVER_DOCS_URL,
  CUA_DRIVER_INSTALL_COMMAND,
  CUA_DRIVER_PERMISSIONS_COMMAND,
  type ComputerDriverStatus,
  loadComputerDriverStatus,
} from './computer-status.js';

function findComputerServer(servers: readonly McpServer[]) {
  return (
    servers.find((server) => server.category === 'computer-use') ??
    servers.find((server) => server.name === CUA_DRIVER_MCP_PRESET.name) ??
    null
  );
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch (error) {
    toast.error(`${label} copy failed`, { description: safeErrorMessage(error) });
  }
}

interface ComputerSetupPanelProps {
  compact?: boolean;
  onManageToolAccess?: () => void;
}

export function ComputerSetupPanel({
  compact = false,
  onManageToolAccess,
}: ComputerSetupPanelProps) {
  const desktopAvailable = isTauriRuntime();
  const queryClient = useQueryClient();
  const serversQuery = useMcpServers();
  const servers = serversQuery.data ?? [];
  const computerServer = useMemo(() => findComputerServer(servers), [servers]);
  const [status, setStatus] = useState<ComputerDriverStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = Boolean(status?.daemonRunning && computerServer?.status === 'connected');

  const refresh = useCallback(async () => {
    if (!desktopAvailable) return;
    setLoadingStatus(true);
    try {
      const next = await loadComputerDriverStatus();
      setStatus(next);
      await queryClient.invalidateQueries({ queryKey: queryKeys.settingsMcpServers() });
    } catch (error) {
      toast.error('Computer driver status failed', { description: safeErrorMessage(error) });
    } finally {
      setLoadingStatus(false);
    }
  }, [desktopAvailable, queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function registerOrConnect() {
    if (!desktopAvailable) {
      toast.error('Computer Use setup requires the release desktop app.');
      return;
    }
    setBusy(true);
    try {
      const server = computerServer ?? (await registerMcpServer(CUA_DRIVER_MCP_PRESET));
      const result = await connectMcpServer(server);
      toast.success('Cua Driver MCP connected', {
        description: `${result.tools.length} tools discovered`,
      });
      await refresh();
    } catch (error) {
      toast.error('Cua Driver MCP setup failed', { description: safeErrorMessage(error) });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const stateLabel = !desktopAvailable
    ? 'Desktop unavailable'
    : ready
      ? 'Ready'
      : !status
        ? 'Checking'
        : !status.installed
          ? 'Desktop driver not installed'
          : !status.daemonRunning
            ? 'Desktop driver not running'
            : !computerServer
              ? 'Driver not linked to Offisim'
              : computerServer.status !== 'connected'
                ? 'Driver link disconnected'
                : 'Ready';

  // In compact placements (waiting viewport) the panel is a setup nudge only;
  // once the driver is fully ready there is nothing left to set up.
  if (compact && ready) return null;

  return (
    <section className={cn('off-computer-setup', compact && 'is-compact')}>
      <div className="off-computer-setup-head">
        <Icon icon={ready ? CheckCircle2 : MonitorSmartphone} size="sm" />
        <div>
          <strong>{stateLabel}</strong>
          <span>
            {status?.version ?? status?.binaryPath ?? 'Cua Driver powers native desktop actions.'}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!desktopAvailable || loadingStatus}
          onClick={() => void refresh()}
        >
          <Icon icon={RefreshCw} size="sm" />
          Refresh
        </Button>
      </div>

      {!compact && !ready ? (
        <p className="off-computer-setup-copy">
          Computer Use lets teammates drive this Mac&apos;s screen. It needs the Cua desktop driver
          installed once.
        </p>
      ) : null}

      {!desktopAvailable ? (
        <p className="off-computer-setup-copy">Driver status is only visible in the desktop app.</p>
      ) : null}

      {status && !status.installed ? (
        <CommandRow
          label="Install"
          value={CUA_DRIVER_INSTALL_COMMAND}
          actionLabel="Copy install command"
        />
      ) : null}

      {status?.installed && !status.daemonRunning ? (
        <>
          <CommandRow
            label="Start driver"
            value={CUA_DRIVER_DAEMON_COMMAND}
            actionLabel="Copy start command"
          />
          <CommandRow
            label="Grant access"
            value={CUA_DRIVER_PERMISSIONS_COMMAND}
            actionLabel="Copy permission command"
          />
        </>
      ) : null}

      {status?.daemonRunning ? (
        <div className="off-computer-setup-actions">
          <Button
            type="button"
            size="sm"
            disabled={busy || ready}
            onClick={() => void registerOrConnect()}
          >
            <Icon icon={PlugZap} size="sm" />
            {computerServer ? 'Connect MCP' : 'Register MCP'}
          </Button>
          <a
            href={CUA_DRIVER_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="off-computer-doc-link"
          >
            <Icon icon={ExternalLink} size="sm" />
            Cua docs
          </a>
        </div>
      ) : null}

      {ready ? (
        <p className="off-computer-setup-copy">
          Computer Use is connected. Only employees with granted tools can use it.
        </p>
      ) : null}

      {ready && computerServer ? (
        <ComputerAccessSettings server={computerServer} onManageToolAccess={onManageToolAccess} />
      ) : null}
    </section>
  );
}

function ComputerAccessSettings({
  server,
  onManageToolAccess,
}: {
  server: McpServer;
  onManageToolAccess?: () => void;
}) {
  const companyId = useUiState((state) => state.companyId);
  const queryClient = useQueryClient();
  const employees = useEmployees();
  const employeeOptions = useMemo(
    () =>
      (employees.data ?? [])
        .filter((employee) => !employee.disabled)
        .map((employee) => ({ value: employee.id, label: employee.name })),
    [employees.data],
  );
  const [employeeId, setEmployeeId] = useState(employeeOptions[0]?.value ?? '');
  const [updatingAccess, setUpdatingAccess] = useState(false);
  const grants = useMcpToolGrants(companyId, employeeId || null);
  const tools = server.tools;
  const grantedTools = useMemo(
    () =>
      new Set(
        (grants.data ?? [])
          .filter((grant) => grant.serverName === server.name)
          .map((grant) => grant.toolName),
      ),
    [grants.data, server.name],
  );
  const grantedCount = tools.filter((tool) => grantedTools.has(tool.name)).length;
  const allGranted = tools.length > 0 && grantedCount === tools.length;

  useEffect(() => {
    if (!employeeOptions.some((option) => option.value === employeeId)) {
      setEmployeeId(employeeOptions[0]?.value ?? '');
    }
  }, [employeeId, employeeOptions]);

  async function toggleComputerAccess() {
    if (!companyId || !employeeId || tools.length === 0) return;
    setUpdatingAccess(true);
    try {
      if (allGranted) {
        for (const tool of tools) {
          await revokeMcpTool({
            companyId,
            employeeId,
            serverName: server.name,
            toolName: tool.name,
          });
        }
        toast.success('Computer Use access revoked');
      } else {
        for (const tool of tools) {
          if (grantedTools.has(tool.name)) continue;
          await grantMcpTool({
            companyId,
            employeeId,
            serverName: server.name,
            toolName: tool.name,
            riskClass: inferMcpGrantRiskClass(tool),
            riskSource: inferMcpGrantRiskSource(tool),
            trustedServerId: server.id,
          });
        }
        toast.success('Computer Use access granted', {
          description: `${tools.length} discovered tools are available to the selected employee.`,
        });
      }
    } catch (error) {
      toast.error('Computer Use access was not updated', {
        description: safeErrorMessage(error),
      });
    } finally {
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: queryKeys.settingsMcpToolGrantsAll() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.employeeMcpToolsAll() }),
      ]);
      setUpdatingAccess(false);
    }
  }

  return (
    <div className="off-computer-settings">
      <div className="off-computer-settings-head">
        <div>
          <Icon icon={Users} size="sm" />
          <span>
            <strong>Employee access</strong>
            <small>Enforced by the runtime MCP tool-grant gate.</small>
          </span>
        </div>
        <Select
          aria-label="Computer Use employee"
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

      <div className="off-computer-access-row">
        <span className={cn('off-computer-access-icon', allGranted && 'is-on')}>
          <Icon icon={allGranted ? ShieldCheck : Wrench} size="sm" />
        </span>
        <div>
          <strong>{allGranted ? 'Computer Use allowed' : 'Computer Use restricted'}</strong>
          <small>
            {tools.length
              ? `${grantedCount} of ${tools.length} discovered tools granted`
              : 'No tools discovered; reconnect the driver to refresh its tool list.'}
          </small>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            !companyId || !employeeId || !tools.length || updatingAccess || grants.isLoading
          }
          onClick={() => void toggleComputerAccess()}
        >
          {updatingAccess ? 'Updating…' : allGranted ? 'Revoke access' : 'Allow Computer Use'}
        </Button>
      </div>

      {onManageToolAccess ? (
        <button
          type="button"
          className="off-computer-manage-tools off-focusable"
          onClick={onManageToolAccess}
        >
          Manage individual tools and risk levels in MCP settings
          <Icon icon={ExternalLink} size="sm" />
        </button>
      ) : null}
    </div>
  );
}

function CommandRow({
  label,
  value,
  actionLabel,
}: {
  label: string;
  value: string;
  actionLabel: string;
}) {
  return (
    <div className="off-computer-command-row">
      <span>{label}</span>
      <code>{value}</code>
      <button type="button" className="off-focusable" onClick={() => void copyText(value, label)}>
        <Icon icon={Copy} size="sm" />
        <span>{actionLabel}</span>
      </button>
    </div>
  );
}

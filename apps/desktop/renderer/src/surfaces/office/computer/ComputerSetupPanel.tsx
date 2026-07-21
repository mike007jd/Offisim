import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { useEmployees } from '@/data/queries.js';
import { queryKeys } from '@/data/query-keys.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import { getDesktopAgentRuntime } from '@/runtime/desktop-agent-runtime.js';
import {
  CUA_DRIVER_MCP_PRESET,
  type McpServer,
  connectMcpServer,
  grantMcpTool,
  inferMcpGrantRiskClass,
  inferMcpGrantRiskSource,
  loadMcpToolGrants,
  registerMcpServer,
  useMcpServers,
} from '@/surfaces/settings/settings-data.js';
import type {
  RuntimeEngineCapabilityManifest,
  RuntimeInteractionRouteSource,
} from '@offisim/shared-types';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  MonitorSmartphone,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { resolveComputerRoute } from './computer-route.js';
import {
  CUA_DRIVER_DAEMON_COMMAND,
  CUA_DRIVER_DOCS_URL,
  CUA_DRIVER_INSTALL_COMMAND,
  CUA_DRIVER_PERMISSIONS_COMMAND,
  type ComputerDriverStatus,
  loadComputerDriverStatus,
} from './computer-status.js';

const ROUTE_SOURCE_LABELS: Readonly<Record<RuntimeInteractionRouteSource, string>> = {
  'engine-native': 'Engine native',
  'offisim-local': 'Offisim local',
  mcp: 'MCP',
};

function engineDisplayLabel(engineId: string): string {
  if (engineId === 'api') return 'API engines';
  return `${engineId.charAt(0).toUpperCase()}${engineId.slice(1)} engine`;
}

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
  const companyId = useUiState((state) => state.companyId);
  const serversQuery = useMcpServers();
  const servers = serversQuery.data ?? [];
  const computerServer = useMemo(() => findComputerServer(servers), [servers]);
  const [status, setStatus] = useState<ComputerDriverStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const [engineCapabilities, setEngineCapabilities] = useState<
    Readonly<Record<string, RuntimeEngineCapabilityManifest>>
  >({});
  const ready = Boolean(status?.daemonRunning && computerServer?.status === 'connected');

  useEffect(() => {
    if (!companyId) {
      setEngineCapabilities({});
      return;
    }
    let cancelled = false;
    void getDesktopAgentRuntime(companyId)
      .then((runtime) => {
        if (cancelled) return;
        const next = Object.fromEntries(
          ['codex', 'claude', 'api'].flatMap((engineId) => {
            const manifest = runtime.getEngineCapabilities(engineId);
            return manifest ? [[engineId, manifest] as const] : [];
          }),
        );
        setEngineCapabilities(next);
      })
      .catch(() => {
        if (!cancelled) setEngineCapabilities({});
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

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
          Offisim local Computer Use is connected for this Mac. Engine-native routes are used only
          when the selected runtime explicitly declares them.
        </p>
      ) : null}

      <ComputerRouteSettings capabilities={engineCapabilities} localDriverReady={ready} />

      {ready && computerServer ? (
        <ComputerAccessPolicy server={computerServer} onManageToolAccess={onManageToolAccess} />
      ) : null}
    </section>
  );
}

function ComputerRouteSettings({
  capabilities,
  localDriverReady,
}: {
  capabilities: Readonly<Record<string, RuntimeEngineCapabilityManifest>>;
  localDriverReady: boolean;
}) {
  const rows = ['codex', 'claude', 'api'].flatMap((engineId) => {
    const manifest = capabilities[engineId];
    if (!manifest) return [];
    const resolution = resolveComputerRoute(manifest, localDriverReady);
    return [{ engineId, resolution }] as const;
  });
  if (!rows.length) return null;
  return (
    <section className="off-computer-settings" aria-labelledby="off-computer-routes-title">
      <div className="off-computer-settings-head">
        <div>
          <Icon icon={MonitorSmartphone} size="sm" />
          <span>
            <strong id="off-computer-routes-title">Computer routes</strong>
            <small>Resolved per engine lane; never inferred from the brand.</small>
          </span>
        </div>
      </div>
      <div className="off-computer-route-list">
        {rows.map(({ engineId, resolution }) => {
          const effective = resolution.effective;
          const native = resolution.routes.find((route) => route.source === 'engine-native');
          return (
            <div className="off-computer-route-row" key={engineId}>
              <span
                className={cn(
                  'off-computer-access-icon',
                  effective.availability === 'available' && 'is-on',
                )}
              >
                <Icon
                  icon={effective.availability === 'available' ? ShieldCheck : Wrench}
                  size="sm"
                />
              </span>
              <div>
                <strong>{engineDisplayLabel(engineId)}</strong>
                <small>
                  {effective.label} ·{' '}
                  {effective.availability === 'available'
                    ? 'Available'
                    : effective.availability === 'setup-required'
                      ? 'Setup required'
                      : 'Unsupported'}
                </small>
                {effective.reason ? <small>{effective.reason}</small> : null}
                {native && native.id !== effective.id ? (
                  <small>
                    Engine native:{' '}
                    {native.availability === 'available' ? 'Available' : 'Unavailable'}
                    {native.reason ? ` — ${native.reason}` : ''}
                  </small>
                ) : null}
              </div>
              <span className="off-computer-route-source">
                {ROUTE_SOURCE_LABELS[effective.source]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComputerAccessPolicy({
  server,
  onManageToolAccess,
}: {
  server: McpServer;
  onManageToolAccess?: () => void;
}) {
  const companyId = useUiState((state) => state.companyId);
  const queryClient = useQueryClient();
  const employees = useEmployees();
  const activeEmployees = useMemo(
    () => (employees.data ?? []).filter((employee) => !employee.disabled),
    [employees.data],
  );
  const [updatingAccess, setUpdatingAccess] = useState(false);
  const tools = server.tools;
  const grants = useQueries({
    queries: activeEmployees.map((employee) => ({
      queryKey: queryKeys.settingsMcpToolGrants(companyId, employee.id),
      queryFn: () => loadMcpToolGrants(companyId, employee.id),
      enabled: Boolean(companyId),
    })),
  });
  const enabledEmployees = activeEmployees.filter((_employee, index) => {
    const grantedTools = new Set(
      (grants[index]?.data ?? [])
        .filter(
          (grant) =>
            grant.serverName === server.name &&
            grant.scope === 'employee' &&
            grant.projectId === null,
        )
        .map((grant) => grant.toolName),
    );
    return tools.length > 0 && tools.every((tool) => grantedTools.has(tool.name));
  });
  const allActiveEnabled =
    activeEmployees.length > 0 && enabledEmployees.length === activeEmployees.length;

  async function allowAllActiveEmployees() {
    if (!companyId || !activeEmployees.length || tools.length === 0) return;
    setUpdatingAccess(true);
    try {
      for (const [index, employee] of activeEmployees.entries()) {
        const grantedTools = new Set(
          (grants[index]?.data ?? [])
            .filter(
              (grant) =>
                grant.serverName === server.name &&
                grant.scope === 'employee' &&
                grant.projectId === null,
            )
            .map((grant) => grant.toolName),
        );
        for (const tool of tools) {
          if (grantedTools.has(tool.name)) continue;
          await grantMcpTool({
            companyId,
            employeeId: employee.id,
            serverName: server.name,
            toolName: tool.name,
            riskClass: inferMcpGrantRiskClass(tool),
            riskSource: inferMcpGrantRiskSource(tool),
            trustedServerId: server.id,
          });
        }
      }
      toast.success('Computer Use enabled for active employees', {
        description: `${activeEmployees.length} employees can request this Mac's local driver.`,
      });
    } catch (error) {
      toast.error('Computer Use access policy was not updated', {
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
          <Icon icon={UsersRound} size="sm" />
          <span>
            <strong>Access policy</strong>
            <small>
              Machine availability is global; runtime grants remain the enforcement layer.
            </small>
          </span>
        </div>
      </div>

      <div className="off-computer-access-row">
        <span className={cn('off-computer-access-icon', allActiveEnabled && 'is-on')}>
          <Icon icon={allActiveEnabled ? ShieldCheck : Wrench} size="sm" />
        </span>
        <div>
          <strong>
            {allActiveEnabled ? 'All active employees enabled' : 'Some employees need access'}
          </strong>
          <small>
            {activeEmployees.length
              ? `${enabledEmployees.length} of ${activeEmployees.length} active employees · ${tools.length} driver tools`
              : 'No tools discovered; reconnect the driver to refresh its tool list.'}
          </small>
        </div>
        {!allActiveEnabled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              !companyId ||
              !activeEmployees.length ||
              !tools.length ||
              updatingAccess ||
              grants.some((query) => query.isLoading)
            }
            onClick={() => void allowAllActiveEmployees()}
          >
            {updatingAccess ? 'Updating…' : 'Allow active employees'}
          </Button>
        ) : null}
      </div>

      {onManageToolAccess ? (
        <button
          type="button"
          className="off-computer-manage-tools off-focusable"
          onClick={onManageToolAccess}
        >
          Manage employee exceptions, individual tools, and risk levels
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

import { isTauriRuntime } from '@/data/adapters.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { cn } from '@/lib/utils.js';
import {
  CUA_DRIVER_MCP_PRESET,
  connectMcpServer,
  registerMcpServer,
  useMcpServers,
  type McpServer,
} from '@/surfaces/settings/settings-data.js';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  MonitorSmartphone,
  PlugZap,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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

export function ComputerSetupPanel({ compact = false }: { compact?: boolean }) {
  const desktopAvailable = isTauriRuntime();
  const queryClient = useQueryClient();
  const serversQuery = useMcpServers();
  const servers = serversQuery.data ?? [];
  const computerServer = useMemo(() => findComputerServer(servers), [servers]);
  const [status, setStatus] = useState<ComputerDriverStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = Boolean(status?.daemonRunning && computerServer?.status === 'connected');

  async function refresh() {
    if (!desktopAvailable) return;
    setLoadingStatus(true);
    try {
      const next = await loadComputerDriverStatus();
      setStatus(next);
      await queryClient.invalidateQueries({ queryKey: ['settings', 'mcp-servers'] });
    } catch (error) {
      toast.error('Computer driver status failed', { description: safeErrorMessage(error) });
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    void refresh();
    // Query client is stable enough for this one-shot status refresh; routing it
    // through refresh keeps the command and MCP registry invalidation together.
    // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount/runtime availability.
  }, [desktopAvailable]);

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
          ? 'Driver missing'
          : !status.daemonRunning
            ? 'Daemon stopped'
            : !computerServer
              ? 'MCP not registered'
              : computerServer.status !== 'connected'
                ? 'MCP disconnected'
                : 'Ready';

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

      {!desktopAvailable ? (
        <p className="off-computer-setup-copy">Release desktop builds read driver and MCP state.</p>
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
            label="Daemon"
            value={CUA_DRIVER_DAEMON_COMMAND}
            actionLabel="Copy daemon command"
          />
          <CommandRow
            label="Permissions"
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
          Computer Use tools are connected as write-class MCP tools.
        </p>
      ) : null}
    </section>
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

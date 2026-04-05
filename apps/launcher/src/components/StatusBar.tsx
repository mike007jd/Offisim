import { Database, RotateCw, Square } from 'lucide-react';
import type { LauncherStatus, ProcessStatus } from '../lib/ipc';

interface StatusBarProps {
  status: LauncherStatus;
  onStop: () => void;
  onRestartPlatform: () => void;
  onStartPostgresDocker: () => void;
  startingPostgres: boolean;
}

const STATUS_COLORS: Record<ProcessStatus, string> = {
  starting: 'var(--warning-val)',
  running: 'var(--success-val)',
  stopping: 'var(--warning-val)',
  stopped: 'var(--text-muted-val)',
  failed: 'var(--error-val)',
};

const STATUS_LABELS: Record<ProcessStatus, string> = {
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  stopped: 'Stopped',
  failed: 'Failed',
};

export function StatusBar({
  status,
  onStop,
  onRestartPlatform,
  onStartPostgresDocker,
  startingPostgres,
}: StatusBarProps) {
  const platform = status.processes.find((p) => p.name === 'platform');
  const frontend = status.processes.find((p) => p.name === 'frontend');
  const hasActiveMode = status.active_mode !== null;

  return (
    <div className="flex items-center gap-4 text-xs font-mono">
      {/* Process indicators */}
      <div className="flex items-center gap-4 flex-1">
        <DatabaseIndicator database={status.database} />
        <ProcessIndicator label="Platform" info={platform} />
        <ProcessIndicator label="Frontend" info={frontend} />

        {/* Port */}
        {frontend?.port && frontend.status === 'running' && (
          <span className="text-[var(--text-muted-val)]">
            Port: <span className="text-[var(--text-secondary-val)]">{frontend.port}</span>
          </span>
        )}

        {/* LAN address */}
        {status.lan_address && (
          <span className="text-[var(--text-muted-val)]">
            LAN:{' '}
            <span className="text-[var(--accent-val)]">
              {status.lan_address}:{frontend?.port ?? 5176}
            </span>
          </span>
        )}

        {/* Exit code for failed processes */}
        {frontend?.status === 'failed' && frontend.exit_code !== null && (
          <span className="text-[var(--error-val)]">Exit: {frontend.exit_code}</span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {hasActiveMode && (
          <button
            type="button"
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--error-val)]/30 bg-[var(--error-val)]/10 text-[var(--error-val)] hover:bg-[var(--error-val)]/20 transition-colors cursor-pointer"
          >
            <Square size={12} />
            Stop
          </button>
        )}
        {platform && !platform.external && (
          <button
            type="button"
            onClick={onRestartPlatform}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-val)] bg-[var(--surface-light)] text-[var(--text-secondary-val)] hover:bg-[var(--surface-lighter)] transition-colors cursor-pointer"
          >
            <RotateCw size={12} />
            Restart Platform
          </button>
        )}
        {status.database.can_start_with_docker && (
          <button
            type="button"
            onClick={onStartPostgresDocker}
            disabled={startingPostgres}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--warning-val)]/30 bg-[var(--warning-val)]/10 text-[var(--warning-val)] hover:bg-[var(--warning-val)]/20 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Database size={12} />
            {startingPostgres ? 'Starting Postgres...' : 'Start Postgres (Docker)'}
          </button>
        )}
      </div>
    </div>
  );
}

function DatabaseIndicator({ database }: { database: LauncherStatus['database'] }) {
  const color = database.status === 'healthy' ? 'var(--success-val)' : 'var(--warning-val)';
  const label = database.status === 'healthy' ? 'Ready' : 'Unavailable';

  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span style={{ color }}>Database: {label}</span>
      <span className="text-[var(--text-muted-val)]">{database.address}</span>
    </span>
  );
}

function ProcessIndicator({
  label,
  info,
}: {
  label: string;
  info: { status: ProcessStatus; pid: number | null; external: boolean } | undefined;
}) {
  if (!info) {
    return (
      <span className="flex items-center gap-1.5 text-[var(--text-muted-val)]">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: 'var(--text-muted-val)', opacity: 0.4 }}
        />
        {label}: Idle
      </span>
    );
  }

  const color = STATUS_COLORS[info.status];
  const statusLabel = STATUS_LABELS[info.status];
  const pidStr = info.pid ? ` (PID ${info.pid})` : '';
  const externalStr = info.external ? ' [ext]' : '';

  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${info.status === 'starting' || info.status === 'stopping' ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: color }}
      />
      <span style={{ color }}>
        {label}: {statusLabel}
      </span>
      <span className="text-[var(--text-muted-val)]">
        {pidStr}
        {externalStr}
      </span>
    </span>
  );
}

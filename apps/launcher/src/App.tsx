import { useCallback, useEffect, useState } from 'react';
import { LaunchPanel } from './components/LaunchPanel';
import { LogViewer } from './components/LogViewer';
import { StatusBar } from './components/StatusBar';
import {
  type LaunchMode,
  type LauncherErrorPayload,
  type LauncherStatus,
  type LogLine,
  getLogs,
  getStatus,
  launchMode,
  onLog,
  onProcessExit,
  restartPlatform,
  startPostgresDocker,
  stopMode,
} from './lib/ipc';

const MAX_LOG_LINES = 5000;
const PROCESS_NAMES = ['platform', 'frontend'] as const;

function statusEqual(a: LauncherStatus, b: LauncherStatus): boolean {
  if (
    a.active_mode !== b.active_mode ||
    a.lan_address !== b.lan_address ||
    a.database.status !== b.database.status ||
    a.database.message !== b.database.message ||
    a.database.can_start_with_docker !== b.database.can_start_with_docker
  )
    return false;
  if (a.processes.length !== b.processes.length) return false;
  for (let i = 0; i < a.processes.length; i++) {
    const ap = a.processes[i];
    const bp = b.processes[i];
    if (!ap || !bp) return false;
    if (
      ap.name !== bp.name ||
      ap.status !== bp.status ||
      ap.pid !== bp.pid ||
      ap.exit_code !== bp.exit_code
    )
      return false;
  }
  return true;
}

export function App() {
  const [status, setStatus] = useState<LauncherStatus>({
    active_mode: null,
    processes: [],
    lan_address: null,
    database: {
      status: 'unreachable',
      address: '127.0.0.1:5432',
      message: 'Checking database status...',
      can_start_with_docker: true,
    },
  });
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({
    platform: [],
    frontend: [],
  });
  const [launching, setLaunching] = useState(false);
  const [startingPostgres, setStartingPostgres] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll status every 2s — skip update if nothing changed
  useEffect(() => {
    const poll = async () => {
      try {
        const s = await getStatus();
        setStatus((prev) => (statusEqual(prev, s) ? prev : s));
      } catch {
        // Tauri not ready yet
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to log events
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      // Load existing log buffers in parallel
      const results = await Promise.all(
        PROCESS_NAMES.map((proc) => getLogs(proc).catch(() => [] as LogLine[])),
      );
      if (cancelled) return;
      setLogs((prev) => {
        const next = { ...prev };
        PROCESS_NAMES.forEach((proc, i) => {
          const lines = results[i] ?? [];
          if (lines.length > 0) next[proc] = lines;
        });
        return next;
      });

      // Listen for new log lines
      for (const proc of PROCESS_NAMES) {
        const unlisten = await onLog(proc, (line) => {
          setLogs((prev) => {
            const current = prev[proc] ?? [];
            const next = [...current, line];
            return {
              ...prev,
              [proc]: next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next,
            };
          });
        });
        if (cancelled) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      }

      // Listen for process exits
      const unlistenExit = await onProcessExit(() => {
        // Refresh status immediately on process exit
        getStatus()
          .then(setStatus)
          .catch(() => {});
      });
      if (cancelled) {
        unlistenExit();
        return;
      }
      unlisteners.push(unlistenExit);
    };

    setup();
    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, []);

  const handleLaunch = useCallback(async (mode: LaunchMode) => {
    setError(null);
    setLaunching(true);
    // Clear frontend logs on new launch
    setLogs((prev) => ({ ...prev, frontend: [] }));
    try {
      await launchMode(mode);
      const s = await getStatus();
      setStatus(s);
    } catch (e: unknown) {
      const payload = e as LauncherErrorPayload;
      setError(payload?.message ?? String(e));
    } finally {
      setLaunching(false);
    }
  }, []);

  const handleStop = useCallback(async () => {
    setError(null);
    try {
      await stopMode();
      const s = await getStatus();
      setStatus(s);
    } catch (e: unknown) {
      const payload = e as LauncherErrorPayload;
      setError(payload?.message ?? String(e));
    }
  }, []);

  const handleRestartPlatform = useCallback(async () => {
    setError(null);
    setLogs((prev) => ({ ...prev, platform: [] }));
    try {
      await restartPlatform();
      const s = await getStatus();
      setStatus(s);
    } catch (e: unknown) {
      const payload = e as LauncherErrorPayload;
      setError(payload?.message ?? String(e));
    }
  }, []);

  const handleStartPostgresDocker = useCallback(async () => {
    setError(null);
    setStartingPostgres(true);
    try {
      await startPostgresDocker();
      const s = await getStatus();
      setStatus(s);
    } catch (e: unknown) {
      const payload = e as LauncherErrorPayload;
      setError(payload?.message ?? String(e));
    } finally {
      setStartingPostgres(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[var(--surface)] text-[var(--text-primary-val)]">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[var(--border-val)]">
        <h1 className="text-sm font-semibold tracking-wide uppercase text-[var(--text-secondary-val)]">
          Offisim Launcher
        </h1>
      </div>

      {/* Launch Panel */}
      <div className="px-4 py-4">
        <LaunchPanel
          activeMode={status.active_mode}
          launching={launching}
          onLaunch={handleLaunch}
        />
      </div>

      {/* Status Bar */}
      <div className="px-4 pb-3">
        <StatusBar
          status={status}
          onStop={handleStop}
          onRestartPlatform={handleRestartPlatform}
          onStartPostgresDocker={handleStartPostgresDocker}
          startingPostgres={startingPostgres}
        />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded bg-[var(--error-val)]/15 border border-[var(--error-val)]/30 text-[var(--error-val)] text-xs font-mono">
          {error}
        </div>
      )}

      {status.database.status === 'unreachable' && (
        <div className="mx-4 mb-3 px-3 py-2 rounded bg-[var(--warning-val)]/10 border border-[var(--warning-val)]/30 text-[var(--warning-val)] text-xs">
          {status.database.message}. Platform-backed features stay unavailable until Postgres is
          running.
        </div>
      )}

      {/* Log Viewer — fills remaining space */}
      <div className="flex-1 min-h-0 px-4 pb-4">
        <LogViewer logs={logs} />
      </div>
    </div>
  );
}

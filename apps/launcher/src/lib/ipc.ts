import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ---------------------------------------------------------------------------
// Types (mirror Rust types)
// ---------------------------------------------------------------------------

export type LaunchMode = 'desktop' | 'web' | 'web_lan';

export type ProcessStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface ProcessInfo {
  name: string;
  status: ProcessStatus;
  pid: number | null;
  port: number | null;
  started_at_ms: number;
  exit_code: number | null;
  external: boolean;
}

export interface LauncherStatus {
  active_mode: LaunchMode | null;
  processes: ProcessInfo[];
  lan_address: string | null;
}

export interface LogLine {
  id: number;
  process: string;
  stream: 'stdout' | 'stderr';
  text: string;
  timestamp_ms: number;
}

export interface LauncherErrorPayload {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function launchMode(mode: LaunchMode): Promise<void> {
  return invoke('launch_mode', { mode });
}

export async function stopMode(): Promise<void> {
  return invoke('stop_mode');
}

export async function stopAll(): Promise<void> {
  return invoke('stop_all');
}

export async function restartPlatform(): Promise<void> {
  return invoke('restart_platform');
}

export async function getStatus(): Promise<LauncherStatus> {
  return invoke('get_status');
}

export async function getLogs(process: string): Promise<LogLine[]> {
  return invoke('get_logs', { process });
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

export function onLog(
  processName: string,
  callback: (line: LogLine) => void,
): Promise<UnlistenFn> {
  return listen<LogLine>(`log:${processName}`, (event) => {
    callback(event.payload);
  });
}

export function onProcessExit(
  callback: (payload: { name: string; exit_code: number | null; status: ProcessStatus }) => void,
): Promise<UnlistenFn> {
  return listen('process:exit', (event) => {
    callback(event.payload as { name: string; exit_code: number | null; status: ProcessStatus });
  });
}

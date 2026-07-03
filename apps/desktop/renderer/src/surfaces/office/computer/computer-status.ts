import { isTauriRuntime } from '@/data/adapters.js';

export const CUA_DRIVER_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"';
export const CUA_DRIVER_DAEMON_COMMAND = 'open -n -g -a CuaDriver --args serve';
export const CUA_DRIVER_PERMISSIONS_COMMAND = 'cua-driver permissions grant';
export const CUA_DRIVER_DOCS_URL = 'https://cua.ai/docs/how-to-guides/driver/install';

export interface ComputerDriverStatus {
  installed: boolean;
  binaryPath?: string | null;
  version?: string | null;
  daemonRunning: boolean;
}

export async function loadComputerDriverStatus(): Promise<ComputerDriverStatus> {
  if (!isTauriRuntime()) {
    return { installed: false, binaryPath: null, version: null, daemonRunning: false };
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<ComputerDriverStatus>('computer_driver_status');
}

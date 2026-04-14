import { isTauri } from './env';

type DesktopInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriCore = (await import('@tauri-apps/api/core')) as {
    invoke: DesktopInvoke;
  };
  return tauriCore.invoke<T>(command, args);
}

export async function openDesktopLocalPath(path: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDesktop('open_local_path', { path });
}

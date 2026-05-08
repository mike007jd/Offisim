import { isTauri } from './env';

type DesktopInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauriCore = (await import('@tauri-apps/api/core')) as {
    invoke: DesktopInvoke;
  };
  return tauriCore.invoke<T>(command, args);
}

export async function openDesktopLocalPath(projectId: string, path: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDesktop('open_local_path', { projectId, path });
}

export async function saveDesktopDeliverable(
  projectId: string,
  fileName: string,
  content: string,
): Promise<string> {
  if (!isTauri()) throw new Error('Desktop save is only available in Tauri');
  return invokeDesktop<string>('save_deliverable_to_local', {
    projectId,
    fileName,
    content,
  });
}

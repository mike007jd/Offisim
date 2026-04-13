export async function listen(): Promise<() => void> {
  throw new Error('Tauri event API is unavailable in the browser frontend.');
}

function unavailable(): never {
  throw new Error('Tauri opener plugin is unavailable in the browser frontend.');
}

export async function revealItemInDir(): Promise<void> {
  unavailable();
}

export async function openPath(): Promise<void> {
  unavailable();
}

export async function openUrl(): Promise<void> {
  unavailable();
}

function unavailable(): never {
  throw new Error('Tauri fs plugin is unavailable in the browser frontend.');
}

export async function exists(): Promise<boolean> {
  unavailable();
}

export async function mkdir(): Promise<void> {
  unavailable();
}

export async function readDir(): Promise<Array<{ name: string }>> {
  unavailable();
}

export async function readTextFile(): Promise<string> {
  unavailable();
}

export async function remove(): Promise<void> {
  unavailable();
}

export async function stat(): Promise<{ mtime: string | null; size: number }> {
  unavailable();
}

export async function writeTextFile(): Promise<void> {
  unavailable();
}

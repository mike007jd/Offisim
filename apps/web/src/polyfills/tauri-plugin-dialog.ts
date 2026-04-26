function unavailable(): never {
  throw new Error('Tauri dialog plugin is unavailable in the browser frontend.');
}

export async function open(): Promise<string | string[] | null> {
  unavailable();
}

export async function save(): Promise<string | null> {
  unavailable();
}

export async function ask(): Promise<boolean> {
  unavailable();
}

export async function confirm(): Promise<boolean> {
  unavailable();
}

export async function message(): Promise<void> {
  unavailable();
}

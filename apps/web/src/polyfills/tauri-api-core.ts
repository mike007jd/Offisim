function unavailable(): never {
  throw new Error('Tauri core API is unavailable in the browser frontend.');
}

export async function invoke<T>(): Promise<T> {
  unavailable();
}

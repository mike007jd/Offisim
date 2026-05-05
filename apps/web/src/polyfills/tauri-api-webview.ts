function unavailable(): never {
  throw new Error('Tauri webview API is unavailable in the browser frontend.');
}

export function getCurrentWebview(): never {
  unavailable();
}

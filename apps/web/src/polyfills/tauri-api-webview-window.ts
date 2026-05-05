function unavailable(): never {
  throw new Error('Tauri webview window API is unavailable in the browser frontend.');
}

export function getCurrentWebviewWindow(): never {
  unavailable();
}

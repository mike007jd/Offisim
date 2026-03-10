/**
 * Detect whether the app is running inside a Tauri 2 webview.
 * Uses the injected window.__TAURI__ object that Tauri provides.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

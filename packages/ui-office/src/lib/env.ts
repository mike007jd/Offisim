/**
 * Detect whether the app is running inside a Tauri 2 webview.
 * Tauri 2 always injects `window.__TAURI_INTERNALS__`; `window.__TAURI__`
 * only exists when `withGlobalTauri` is enabled.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

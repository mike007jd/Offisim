function unavailable(): never {
  throw new Error('Tauri core API is unavailable in the browser frontend.');
}

// NOTE: signatures mirror `@tauri-apps/api/core` exactly. If the polyfill
// parameters disappear, Rollup / Terser treat call sites as having no args
// and DCE them (observed 2026-04-20: `invoke('llm_fetch', { req, onEvent })`
// getting minified to `invoke()` with all arguments stripped). Keep args
// named and referenced so their values are considered live.

export async function invoke<T>(cmd?: string, args?: Record<string, unknown>): Promise<T> {
  void cmd;
  void args;
  return unavailable();
}

// The real Tauri Channel is an IPC transport; this stub only exists so the
// tauri-runtime code path compiles and code-splits cleanly in browser builds.
// Attempting to use a Channel from the browser chunk would indicate a routing
// bug — every consumer should also be gated on isTauri().
export class Channel<T = unknown> {
  onmessage: ((message: T) => void) | null = null;
  toJSON(): string {
    return unavailable();
  }
  send(_message: T): void {
    void _message;
    unavailable();
  }
}

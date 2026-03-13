/** Minimal type stubs for Tauri APIs used via dynamic import. */
declare module '@tauri-apps/api/event' {
  interface Event<T> {
    payload: T;
  }
  export function listen<T>(
    event: string,
    handler: (event: Event<T>) => void,
  ): Promise<() => void>;
}

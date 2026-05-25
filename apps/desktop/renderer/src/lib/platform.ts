/**
 * Renderer data-source helpers. The renderer ships inside Tauri but also renders
 * in a plain browser during framework development. Surface code stays identical;
 * only the data source differs. Tauri command wiring is added per-capability as
 * runtime integration lands — see apps/desktop/CLAUDE.md for sandbox rules.
 */

/** Resolve fixture data on a microtask so query hooks exercise async paths. */
export function resolveAsync<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

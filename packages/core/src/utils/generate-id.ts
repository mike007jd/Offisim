/**
 * Generate a collision-resistant prefixed ID.
 * Uses crypto.randomUUID() (Node 19+, all modern browsers, Tauri webview).
 *
 * Replaces the old Date.now() + Math.random() approach which had only ~31 bits
 * entropy and leaked wall-clock timestamps in every ID.
 */
export function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * Derive the canonical threadId for a project's primary execution thread.
 * Every project owns exactly one deterministic thread that survives restarts.
 */
export function projectThreadId(projectId: string): string {
  return `project-${projectId}`;
}

/**
 * Generate a unique ID with a given prefix.
 * Format: `{prefix}-{timestamp}-{random6chars}`
 *
 * Used across nodes for task runs, handoffs, meetings, memories, etc.
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

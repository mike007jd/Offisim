import type { RuntimeEvent } from '@aics/shared-types';

/**
 * Derives severity from event type.
 * Used when persisting to runtime_events table.
 */
export function deriveSeverity(event: RuntimeEvent): 'info' | 'warn' | 'error' {
  const payload = event.payload as Record<string, unknown>;
  const nextState = typeof payload?.['next'] === 'string' ? payload['next'] : '';

  if (nextState === 'failed') return 'error';
  if (nextState === 'blocked' || nextState === 'cancelled') return 'warn';
  return 'info';
}

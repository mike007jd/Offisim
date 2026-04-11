import type { RuntimeEvent } from '@offisim/shared-types';

export type DatePreset = 'today' | '7d' | '30d' | 'custom';

export function getEventId(event: RuntimeEvent): string {
  // `event.type` is load-bearing: paired emits like `llm.call.completed` +
  // `llm.usage.recorded` (see packages/core/src/llm/recorded-call.ts) share
  // the same entityId (llmCallId) and land on the same Date.now() ms, so
  // (timestamp, entityId) alone is not a unique identity.
  return `${event.timestamp}-${event.type}-${event.entityId ?? 'none'}`;
}

export function getDateCutoff(preset: DatePreset): number {
  const now = Date.now();
  switch (preset) {
    case 'today':
      return now - 24 * 60 * 60 * 1000;
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000;
    case 'custom':
      return 0; // no cutoff
  }
}

export function getActivityActorLabel(event: RuntimeEvent): string | null {
  const payload = event.payload as Record<string, unknown>;

  if (typeof payload.employeeName === 'string' && payload.employeeName.trim()) {
    return payload.employeeName.trim();
  }

  if (typeof payload.name === 'string' && payload.name.trim()) {
    return payload.name.trim();
  }

  if (event.entityType && event.entityId) {
    return `${event.entityType}:${event.entityId}`;
  }

  if (event.entityId) {
    return event.entityId;
  }

  return null;
}

export function getAvailableActorFilters(events: RuntimeEvent[]): string[] {
  return [
    ...new Set(events.map(getActivityActorLabel).filter((label): label is string => !!label)),
  ].sort((left, right) => left.localeCompare(right));
}

export function matchesActorFilters(event: RuntimeEvent, actorFilters: string[]): boolean {
  if (actorFilters.length === 0) return true;
  const actorLabel = getActivityActorLabel(event);
  if (!actorLabel) return false;
  return actorFilters.includes(actorLabel);
}

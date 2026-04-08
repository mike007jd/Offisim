import type { RuntimeEvent } from '@offisim/shared-types';

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
  return [...new Set(events.map(getActivityActorLabel).filter((label): label is string => !!label))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function matchesActorFilters(event: RuntimeEvent, actorFilters: string[]): boolean {
  if (actorFilters.length === 0) return true;
  const actorLabel = getActivityActorLabel(event);
  if (!actorLabel) return false;
  return actorFilters.includes(actorLabel);
}

import type { RuntimeEvent } from '@offisim/shared-types';
import { Badge, Button } from '@offisim/ui-core';
import { X } from 'lucide-react';
import { formatFullTimestamp } from '../../lib/format-time';
import { ActivityPayloadView } from './ActivityPayloadView';
import { getDisplayLabel } from './EventItem';
import { getEventLevel } from './EventLog';
import type { EventDisplayLevel } from './EventLog';

export interface ActivityEventDetailProps {
  event: RuntimeEvent;
  onClose: () => void;
}

const LEVEL_BADGE: Record<EventDisplayLevel, string> = {
  Info: 'bg-info-muted text-info border-info',
  Warning: 'bg-warning-muted text-warning border-warning',
  Error: 'bg-error-muted text-error border-error',
};

export function ActivityEventDetail({ event, onClose }: ActivityEventDetailProps) {
  const level = getEventLevel(event);
  const payload = event.payload as Record<string, unknown>;
  const entityLabel = getDisplayLabel(event);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface-elevated text-text-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <h2 className="text-sm font-medium text-text-primary">Event Detail</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close detail panel"
          className="size-7 text-text-secondary hover:text-text-primary"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Event Type */}
        <Section label="Event Type">
          <p className="font-mono text-sm text-text-primary">{event.type.replaceAll('.', ' / ')}</p>
        </Section>

        {/* Level */}
        <Section label="Level">
          <Badge variant="outline" size="xs" className={LEVEL_BADGE[level]}>
            {level}
          </Badge>
        </Section>

        {/* Timestamp */}
        <Section label="Timestamp">
          <p className="text-xs text-text-secondary">{formatFullTimestamp(event.timestamp)}</p>
        </Section>

        {/* Entity */}
        <Section label="Entity">
          <p className="text-xs text-text-secondary">{entityLabel}</p>
          {event.entityType && (
            <p className="mt-0.5 text-caption text-text-muted">Type: {event.entityType}</p>
          )}
          {event.entityId && (
            <p className="mt-0.5 font-mono text-caption text-text-muted">ID: {event.entityId}</p>
          )}
        </Section>

        {/* Payload */}
        <Section label="Payload">
          <ActivityPayloadView payload={payload} />
        </Section>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-caption uppercase tracking-wider text-text-muted">{label}</p>
      {children}
    </div>
  );
}

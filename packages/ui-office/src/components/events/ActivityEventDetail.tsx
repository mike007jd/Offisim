import type { RuntimeEvent } from '@offisim/shared-types';
import { Badge, Button } from '@offisim/ui-core';
import { X } from 'lucide-react';
import { formatFullTimestamp } from '../../lib/format-time';
import { ActivityPayloadView } from './ActivityPayloadView';
import { getDisplayLabel } from './EventItem';
import { getEventLevel } from './EventLog';

export interface ActivityEventDetailProps {
  event: RuntimeEvent;
  onClose: () => void;
}

export function ActivityEventDetail({ event, onClose }: ActivityEventDetailProps) {
  const level = getEventLevel(event);
  const payload = event.payload as Record<string, unknown>;
  const entityLabel = getDisplayLabel(event);

  return (
    <div className="activity-detail">
      {/* Header */}
      <div className="activity-detail-header">
        <h2>Event Detail</h2>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          onClick={onClose}
          aria-label="Close detail panel"
          className="activity-detail-close"
        >
          <X data-icon="close" />
        </Button>
      </div>

      <div className="activity-detail-body">
        <div className="activity-detail-stack">
          {/* Event Type */}
          <Section label="Event Type">
            <p className="activity-detail-mono">{event.type.replaceAll('.', ' / ')}</p>
          </Section>

          {/* Level */}
          <Section label="Level">
            <Badge
              variant="outline"
              size="xs"
              className="activity-detail-level-badge"
              data-level={level.toLowerCase()}
            >
              {level}
            </Badge>
          </Section>

          {/* Timestamp */}
          <Section label="Timestamp">
            <p className="activity-detail-text">{formatFullTimestamp(event.timestamp)}</p>
          </Section>

          {/* Entity */}
          <Section label="Entity">
            <p className="activity-detail-text">{entityLabel}</p>
            {event.entityType && <p className="activity-detail-meta">Type: {event.entityType}</p>}
            {event.entityId && <p className="activity-detail-meta-code">ID: {event.entityId}</p>}
          </Section>

          {/* Payload */}
          <Section label="Payload">
            <ActivityPayloadView payload={payload} />
          </Section>
        </div>
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
    <div className="activity-detail-section">
      <p>{label}</p>
      {children}
    </div>
  );
}

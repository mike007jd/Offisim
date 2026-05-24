import type { RuntimeEvent } from '@offisim/shared-types';
import { Badge, Button, cn } from '@offisim/ui-core';
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
  Info: 'bg-accent-surface text-accent border-accent',
  Warning: 'bg-warn-surface text-warn border-warn',
  Error: 'bg-danger-surface text-danger border-danger',
};

const ACTIVITY_DETAIL_HEADER_CLASS =
  'flex shrink-0 items-center justify-between border-b border-line-soft px-sp-4 py-sp-3';
const ACTIVITY_DETAIL_TITLE_CLASS = 'text-fs-sm font-medium text-ink-1';
const ACTIVITY_DETAIL_BODY_CLASS = 'min-h-0 flex-1 overflow-y-auto p-sp-4';
const ACTIVITY_DETAIL_BODY_STACK_CLASS = 'flex flex-col gap-sp-4';
const ACTIVITY_DETAIL_CLOSE_ICON_CLASS = 'activity-detail-icon';
const ACTIVITY_DETAIL_SECTION_LABEL_CLASS =
  'mb-sp-1 text-fs-meta uppercase tracking-ls-caps text-ink-4';
const ACTIVITY_DETAIL_TEXT_CLASS = 'text-fs-sm text-ink-3';
const ACTIVITY_DETAIL_MONO_TEXT_CLASS = 'font-mono text-fs-sm text-ink-1';
const ACTIVITY_DETAIL_META_CLASS = 'mt-sp-1 text-fs-meta text-ink-4';
const ACTIVITY_DETAIL_META_ID_CLASS = 'break-all font-mono';

export function ActivityEventDetail({ event, onClose }: ActivityEventDetailProps) {
  const level = getEventLevel(event);
  const payload = event.payload as Record<string, unknown>;
  const entityLabel = getDisplayLabel(event);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-2 text-ink-1">
      {/* Header */}
      <div className={ACTIVITY_DETAIL_HEADER_CLASS}>
        <h2 className={ACTIVITY_DETAIL_TITLE_CLASS}>Event Detail</h2>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          onClick={onClose}
          aria-label="Close detail panel"
          className="text-ink-3 hover:text-ink-1"
        >
          <X className={ACTIVITY_DETAIL_CLOSE_ICON_CLASS} />
        </Button>
      </div>

      <div className={ACTIVITY_DETAIL_BODY_CLASS}>
        <div className={ACTIVITY_DETAIL_BODY_STACK_CLASS}>
          {/* Event Type */}
          <Section label="Event Type">
            <p className={ACTIVITY_DETAIL_MONO_TEXT_CLASS}>{event.type.replaceAll('.', ' / ')}</p>
          </Section>

          {/* Level */}
          <Section label="Level">
            <Badge variant="outline" size="xs" className={LEVEL_BADGE[level]}>
              {level}
            </Badge>
          </Section>

          {/* Timestamp */}
          <Section label="Timestamp">
            <p className={ACTIVITY_DETAIL_TEXT_CLASS}>{formatFullTimestamp(event.timestamp)}</p>
          </Section>

          {/* Entity */}
          <Section label="Entity">
            <p className={ACTIVITY_DETAIL_TEXT_CLASS}>{entityLabel}</p>
            {event.entityType && (
              <p className={ACTIVITY_DETAIL_META_CLASS}>Type: {event.entityType}</p>
            )}
            {event.entityId && (
              <p className={cn(ACTIVITY_DETAIL_META_CLASS, ACTIVITY_DETAIL_META_ID_CLASS)}>
                ID: {event.entityId}
              </p>
            )}
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
    <div>
      <p className={ACTIVITY_DETAIL_SECTION_LABEL_CLASS}>{label}</p>
      {children}
    </div>
  );
}
